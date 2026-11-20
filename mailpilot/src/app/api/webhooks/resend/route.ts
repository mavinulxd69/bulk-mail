import { NextResponse } from "next/server";
import { admin } from "@/lib/supabase/admin";
import { HANDLED_RESEND_EVENTS, parseResendEvent, verifySvix } from "@/lib/queue/webhook";
import { checkIncomingRequestLimit } from "@/lib/security/rate-limit";
import { recordAbuseEvent } from "@/lib/security/abuse";

export const dynamic = "force-dynamic";

// Resend delivery events. Signature-verified; stored first, then applied, so an event that arrives before our own "accepted" write isn't lost.
export async function POST(req: Request) {
  const limited = await checkIncomingRequestLimit("webhook.resend", req.headers, undefined, 1000);
  if (!limited.allowed) {
    if (limited.thresholdCrossed) await recordAbuseEvent("rate_limit.webhook.resend", limited.ip, { bucket: limited.bucket });
    return NextResponse.json({ error: "too many requests" }, { status: 429, headers: { "Retry-After": String(limited.retryAfter) } });
  }
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "RESEND_WEBHOOK_SECRET is not configured" }, { status: 503 });
  const raw = await req.text();
  const id = req.headers.get("svix-id");
  if (!verifySvix({ id, timestamp: req.headers.get("svix-timestamp"), signature: req.headers.get("svix-signature") }, raw, secret))
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  let body: unknown; try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  const ev = parseResendEvent(body);
  if (!ev || !HANDLED_RESEND_EVENTS.has(ev.type)) return NextResponse.json({ ok: true, ignored: true }); // opens/clicks etc. are deliberately not tracked

  const db = admin();
  const ins = await db.from("provider_events").insert({ provider: "resend", provider_event_id: id!, provider_message_id: ev.messageId, type: ev.type, payload: body }).select("id").single();
  if (ins.error) {
    if (ins.error.code === "23505") return NextResponse.json({ ok: true, duplicate: true }); // Svix retries: already stored
    console.error("[webhook] store failed", ins.error.message);
    return NextResponse.json({ error: "store failed" }, { status: 500 }); // non-2xx makes Resend retry
  }
  const applied = await db.rpc("apply_provider_event", { p_event: ins.data.id });
  if (applied.error) { console.error("[webhook] apply failed", applied.error.message); return NextResponse.json({ error: "apply failed" }, { status: 500 }); }
  return NextResponse.json({ ok: true, result: applied.data });
}
