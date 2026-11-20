import { NextResponse } from "next/server";
import { productionLaunchReady } from "@/lib/security/runtime-config";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = productionLaunchReady();
  return NextResponse.json({
    status: result.ready ? "ready" : "not_ready",
    environment: process.env.NODE_ENV,
  }, { status: result.ready ? 200 : 503 });
}
