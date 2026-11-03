import { describe, expect, it } from "vitest";
import { healthPayload } from "@/platform/http/health";

describe("healthPayload", () => {
  it("returns a static ok payload with no environment details", () => {
    expect(healthPayload()).toEqual({ status: "ok", service: "schoolos-web" });
    expect(JSON.stringify(healthPayload())).not.toMatch(/AUTH_PROVIDER|password|secret/i);
  });
});
