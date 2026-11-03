import { applyLocalEnvFiles, getServerEnv } from "@/platform/config/env";
import { logger } from "@/platform/log/logger";

/**
 * Background worker entrypoint (ADR-0002, ADR-0009).
 * Job handlers are added in later M1 steps. This process only validates
 * configuration and records that it started with no registered jobs.
 */
function main(): void {
  applyLocalEnvFiles();
  const env = getServerEnv();
  logger.info("schoolos.worker.started", {
    appEnv: env.appEnv,
    registeredJobs: 0,
  });
}

main();
