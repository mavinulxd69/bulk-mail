import { NextResponse } from "next/server";
import { productionLaunchReady } from "@/lib/security/runtime-config";

export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.NODE_ENV !== "production") {
    const localReady = Boolean(
      process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
      && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
      && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
    );
    return NextResponse.json({
      status: localReady ? "ready" : "not_ready",
      environment: process.env.NODE_ENV,
    }, { status: localReady ? 200 : 503 });
  }
  const result = productionLaunchReady();
  return NextResponse.json({
    status: result.ready ? "ready" : "not_ready",
    environment: process.env.NODE_ENV,
  }, { status: result.ready ? 200 : 503 });
}
