/**
 * Next.js server startup hook. Validates environment before handling requests.
 * Does not run in the Edge runtime.
 */
export async function register(): Promise<void> {
  if (process.env["NEXT_RUNTIME"] === "edge") {
    return;
  }
  const { getServerEnv } = await import("@/platform/config/env");
  const { logger } = await import("@/platform/log/logger");
  const env = getServerEnv();
  logger.info("schoolos.web.started", { appEnv: env.appEnv });
}
