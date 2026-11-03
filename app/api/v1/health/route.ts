import { NextResponse } from "next/server";
import { getServerEnv } from "@/platform/config/env";
import { healthPayload } from "@/platform/http/health";

export const dynamic = "force-dynamic";

export function GET(): NextResponse {
  getServerEnv();
  return NextResponse.json(healthPayload());
}
