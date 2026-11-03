export type ResponseHeader = {
  readonly key: string;
  readonly value: string;
};

type SecurityHeaderOptions = {
  readonly isDevelopment?: boolean;
};

/**
 * Baseline HTTP security headers for the staff application.
 * CSP is conservative: no third-party scripts. Tighten further in later steps
 * once auth cookies and WebSocket/device channels exist.
 *
 * `unsafe-eval` is added only in development because React's Next.js overlay
 * reconstructs stacks with eval(). Production CSP never includes it.
 */
export function getSecurityHeaders(options: SecurityHeaderOptions = {}): readonly ResponseHeader[] {
  const scriptSrc = options.isDevelopment
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : "script-src 'self' 'unsafe-inline'";

  return [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-DNS-Prefetch-Control", value: "off" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    },
    {
      key: "Content-Security-Policy",
      value: [
        "default-src 'self'",
        scriptSrc,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self'",
        "connect-src 'self'",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join("; "),
    },
  ];
}

export const securityHeaders: readonly ResponseHeader[] = getSecurityHeaders();
