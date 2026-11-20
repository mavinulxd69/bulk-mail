// Integration test: runs the REAL import pipeline and page queries through PostgREST + Postgres with row-level security on.
// Skipped unless PGRST_URL and PGRST_JWT_SECRET are set. See README "Testing". Use a local/throwaway database only.
import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgrestClient } from "@supabase/postgrest-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runImport, type ImportInput } from "./import-service";
import { fetchAllContacts } from "./db";
import { contactVariables } from "./fields";
import { analyzeAudience, renderTemplate } from "@/lib/personalize/engine";

const URL_ = process.env.PGRST_URL, SECRET = process.env.PGRST_JWT_SECRET;
const A = "00000000-0000-0000-0000-00000000000a", B = "00000000-0000-0000-0000-00000000000b";
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (claims: object) => { const h = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ ...claims, exp: Math.floor(Date.now() / 1000) + 3600 })}`; return `${h}.${createHmac("sha256", SECRET!).update(h).digest("base64url")}`; };
const client = (claims: object) => new PostgrestClient(URL_!, { headers: { Authorization: `Bearer ${jwt(claims)}` } }) as unknown as SupabaseClient;
const input = (o: Partial<ImportInput>): ImportInput => ({ text: "", source: "integration test", requiredRaw: [], listId: "", newList: "", updateExisting: false, ...o });
const SPEC_CSV = "email,name,boarding_code\nalex@gmail.com,Alex,BD101\njohn@gmail.com,John,BD102\ndavid@gmail.com,David,BD103\n";

describe.skipIf(!URL_ || !SECRET)("contacts against a real database", () => {
  const a = URL_ ? client({ role: "authenticated", sub: A }) : (null as never);
  const b = URL_ ? client({ role: "authenticated", sub: B }) : (null as never);
  const svc = URL_ ? client({ role: "service_role" }) : (null as never);
  const wipe = async () => { for (const u of [A, B]) { await svc.from("contacts").delete().eq("user_id", u); await svc.from("contact_lists").delete().eq("user_id", u); await svc.from("suppressions").delete().eq("user_id", u); } };
  beforeAll(wipe); afterAll(wipe);

  it("imports the spec CSV into a new list with consent recorded", async () => {
    const r = await runImport(a, A, input({ text: SPEC_CSV, newList: "Flight 1", requiredRaw: ["boarding_code"] }));
    expect(r).toMatchObject({ status: "done", summary: { created: 3, invalid: 0, addedToList: 3, listName: "Flight 1" } });
    const { data } = await a.from("contacts").select("email,name,fields,consent_source,consented_at").order("email");
    expect(data).toHaveLength(3);
    expect(data![0]).toMatchObject({ email: "alex@gmail.com", name: "Alex", fields: { boarding_code: "BD101" }, consent_source: "integration test" });
    expect(data![0]!.consented_at).toBeTruthy();
    expect((await a.from("consent_events").select("id", { count: "exact", head: true })).count).toBe(3);
  });

  it("reports invalid, duplicate and missing-required rows and stores none of them", async () => {
    const r = await runImport(a, A, input({ text: "email,name,boarding_code\nnew@x.com,New,BD9\nnew@x.com,Dup,BD8\nbad-address,Bad,BD7\nnocode@x.com,NoCode,\n", requiredRaw: ["boarding_code"] }));
    expect(r).toMatchObject({ status: "done", summary: { created: 1, invalid: 1, duplicatesInFile: 1, missingRequired: 1 } });
    if (r.status === "done") expect(r.issues.map((i) => i.line)).toEqual([3, 4, 5]);
    const { data } = await a.from("contacts").select("email").in("email", ["bad-address", "nocode@x.com"]);
    expect(data).toEqual([]);
  });

  it("skips existing contacts by default and updates them only when asked, keeping the original consent date", async () => {
    const before = (await a.from("contacts").select("consented_at").eq("email", "alex@gmail.com").single()).data!.consented_at;
    const csv = "email,name,boarding_code,company\nalex@gmail.com,Alexander,BD101,Acme\n";
    expect(await runImport(a, A, input({ text: csv }))).toMatchObject({ summary: { created: 0, updated: 0, skippedExisting: 1 } });
    expect(await runImport(a, A, input({ text: csv, updateExisting: true }))).toMatchObject({ summary: { created: 0, updated: 1 } });
    const row = (await a.from("contacts").select("name,fields,consented_at").eq("email", "alex@gmail.com").single()).data!;
    expect(row).toMatchObject({ name: "Alexander", fields: { boarding_code: "BD101", company: "Acme" }, consented_at: before });
  });

  it("works with the exact queries the contacts page runs", async () => {
    const { data: list } = await a.from("contact_lists").select("id,name,contact_list_members(count)").eq("name", "Flight 1").single();
    expect((list as { contact_list_members: { count: number }[] }).contact_list_members[0]!.count).toBe(3);
    const inList = await a.from("contacts").select("id,email,contact_list_members!inner(list_id)", { count: "exact" }).eq("contact_list_members.list_id", (list as { id: string }).id);
    expect(inList.count).toBe(3);
    expect((await a.from("contacts").select("email").or('email.ilike."%ALEX%",name.ilike."%ALEX%"')).data).toEqual([{ email: "alex@gmail.com" }]);
    expect((await a.from("contacts").select("email").or('email.ilike."%john g%",name.ilike."%john g%"')).data).toEqual([]);
    expect((await fetchAllContacts(a, { listId: (list as { id: string }).id })).map((c) => c.email).sort()).toEqual(["alex@gmail.com", "david@gmail.com", "john@gmail.com"]);
  });

  it("flags saved-but-suppressed addresses and blocks recipients with missing data in the personalization check", async () => {
    await svc.from("suppressions").insert({ user_id: A, email: "john@gmail.com", reason: "unsubscribe" });
    expect(await runImport(a, A, input({ text: "john@gmail.com\nfresh@x.com" }))).toMatchObject({ summary: { created: 1, skippedExisting: 1, alreadySuppressed: 1 } });
    const all = await fetchAllContacts(a);
    const audience = all.filter((c) => c.email !== "john@gmail.com").map((c) => ({ id: c.id, data: contactVariables(c) }));
    const tpl = { subject: "Your Boarding Confirmation - {{name}}", html: "<p>{{boarding_code}}</p>" };
    const report = analyzeAudience(tpl, audience);
    // alex, david and new@x.com have a name and a boarding code; fresh@x.com (pasted address only) has neither.
    const fresh = all.find((c) => c.email === "fresh@x.com")!;
    expect(report).toMatchObject({ total: 4, ready: 3, blocked: 1 });
    expect(report.blockedRecipients).toEqual([{ id: fresh.id, missing: ["boarding_code", "name"] }]);
    for (const r of audience) { const out = renderTemplate(tpl, r.data); expect(out.ok).toBe(!report.blockedRecipients.some((x) => x.id === r.id)); }
  });

  it("isolates tenants: B sees nothing of A's, cannot change it, and may import the same addresses separately", async () => {
    expect((await b.from("contacts").select("id", { count: "exact", head: true })).count).toBe(0);
    expect((await b.from("contact_lists").select("id", { count: "exact", head: true })).count).toBe(0);
    expect((await b.from("consent_events").select("id", { count: "exact", head: true })).count).toBe(0);
    const upd = await b.from("contacts").update({ name: "pwned" }).eq("email", "alex@gmail.com").select("id");
    expect(upd.data ?? []).toHaveLength(0);
    expect((await b.from("contacts").delete().eq("email", "alex@gmail.com").select("id")).data ?? []).toHaveLength(0);
    expect((await runImport(b, B, input({ text: SPEC_CSV }))).status).toBe("done");
    expect((await a.from("contacts").select("name").eq("email", "alex@gmail.com").single()).data!.name).toBe("Alexander");
    expect((await a.from("contacts").select("id", { count: "exact", head: true })).count).toBe(5);
    expect((await b.from("contacts").select("id", { count: "exact", head: true })).count).toBe(3);
  });

  it("rejects B using A's list id and A's id for a list B does not own", async () => {
    const { data: aList } = await a.from("contact_lists").select("id").eq("name", "Flight 1").single();
    expect(await runImport(b, B, input({ text: "x@y.com", listId: aList!.id }))).toMatchObject({ status: "error", message: "That list was not found." });
    expect((await b.from("contacts").select("id").eq("email", "x@y.com")).data).toEqual([]);
  });

  it("imports past PostgREST's 1,000-row page size and reads it all back", async () => {
    const rows = Array.from({ length: 1200 }, (_, i) => `bulk${i}@example.com`).join("\n");
    expect(await runImport(a, A, input({ text: rows, newList: "Bulk" }))).toMatchObject({ summary: { created: 1200, addedToList: 1200 } });
    const { data: l } = await a.from("contact_lists").select("id").eq("name", "Bulk").single();
    expect(await fetchAllContacts(a, { listId: l!.id })).toHaveLength(1200);
  }, 60_000);
});
