import type { PoolConfig } from "pg";

// Local-only placeholder credentials for the disposable spike container.
// They protect nothing and must never be reused elsewhere.
export const LOCAL_ONLY_PASSWORDS = {
  postgres: "spike-local-only-superuser",
  schoolos_owner: "spike-local-only-owner",
  app_user: "spike-local-only-app-user",
  app_auth: "spike-local-only-app-auth",
} as const;

export type SpikeRole = keyof typeof LOCAL_ONLY_PASSWORDS;

export const PG_HOST = "127.0.0.1";
export const PG_PORT = Number(process.env["SPIKE_PG_PORT"] ?? "54329");
export const SPIKE_DB = "schoolos_spike";
export const TXPROBE_DB = "schoolos_spike_txprobe";

export function poolConfig(
  role: SpikeRole,
  options: { database?: string; max?: number } = {},
): PoolConfig {
  return {
    host: PG_HOST,
    port: PG_PORT,
    database: options.database ?? SPIKE_DB,
    user: role,
    password: LOCAL_ONLY_PASSWORDS[role],
    max: options.max ?? 4,
    application_name: `spike-${role}`,
  };
}
