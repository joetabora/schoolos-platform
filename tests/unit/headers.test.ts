import { describe, expect, it } from "vitest";
import { getSecurityHeaders } from "@/platform/security/headers";

describe("getSecurityHeaders", () => {
  it("keeps eval out of production CSP", () => {
    const csp = getSecurityHeaders().find((header) => header.key === "Content-Security-Policy");
    expect(csp?.value).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp?.value).not.toContain("unsafe-eval");
    expect(csp?.value).not.toContain("https:");
  });

  it("allows eval only for Next.js development overlays", () => {
    const csp = getSecurityHeaders({ isDevelopment: true }).find(
      (header) => header.key === "Content-Security-Policy",
    );
    expect(csp?.value).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval'");
  });
});
