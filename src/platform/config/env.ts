import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const APP_ENVS = ["local", "test", "dev", "staging", "production"] as const;
export type AppEnv = (typeof APP_ENVS)[number];

export const AUTH_PROVIDERS = ["fake", "supabase"] as const;
export type AuthProviderName = (typeof AUTH_PROVIDERS)[number];

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const NODE_ENVS = ["development", "test", "production"] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];

export type ServerEnv = {
  readonly nodeEnv: NodeEnv;
  readonly appEnv: AppEnv;
  readonly logLevel: LogLevel;
  readonly authProvider: AuthProviderName;
};

export class ConfigurationError extends Error {
  override readonly name = "ConfigurationError";
  constructor(message: string) {
    super(`Invalid configuration: ${message}`);
  }
}

function read(source: NodeJS.ProcessEnv, key: string): string {
  const raw = source[key];
  if (raw === undefined || raw.trim() === "") {
    throw new ConfigurationError(
      `${key} is required. Copy .env.example to .env.local and set ${key} to a documented value.`,
    );
  }
  return raw.trim();
}

function parseUnion<T extends string>(key: string, value: string, allowed: readonly T[]): T {
  const match = allowed.find((item) => item === value);
  if (match === undefined) {
    throw new ConfigurationError(
      `${key} must be one of: ${allowed.join(", ")}. Received ${JSON.stringify(value)}.`,
    );
  }
  return match;
}

/**
 * AUTH_PROVIDER=fake is a local/test stand-in only (TST-8).
 * Next.js sets NODE_ENV=production during `next build`, so the guard is based
 * on APP_ENV, which is the SchoolOS environment rather than the Node process flag.
 */
function assertAuthProviderAllowed(appEnv: AppEnv, authProvider: AuthProviderName): void {
  if (authProvider === "fake" && appEnv !== "local" && appEnv !== "test") {
    throw new ConfigurationError(
      "AUTH_PROVIDER=fake is allowed only when APP_ENV is local or test.",
    );
  }
  if (authProvider === "supabase") {
    throw new ConfigurationError(
      "AUTH_PROVIDER=supabase is reserved for M1 step 3 and is not implemented. Use AUTH_PROVIDER=fake for local and test.",
    );
  }
}

/** Parse a dotenv file body. Does not write to process.env. */
export function parseDotEnv(text: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) {
      continue;
    }
    const stripped = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const eq = stripped.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = stripped.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue;
    }
    let value = stripped.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }
  return parsed;
}

/**
 * Load `.env` then `.env.local` into process.env without overriding values
 * already present. Next.js does this for the web process; the worker does not.
 */
export function applyLocalEnvFiles(cwd: string = process.cwd()): void {
  for (const name of [".env", ".env.local"] as const) {
    const filePath = path.join(cwd, name);
    if (!existsSync(filePath)) {
      continue;
    }
    const parsed = parseDotEnv(readFileSync(filePath, "utf8"));
    for (const [key, value] of Object.entries(parsed)) {
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
}

export function loadServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  const nodeEnv = parseUnion("NODE_ENV", source["NODE_ENV"] ?? "development", NODE_ENVS);
  const appEnv = parseUnion("APP_ENV", read(source, "APP_ENV"), APP_ENVS);
  const logLevel = parseUnion("LOG_LEVEL", source["LOG_LEVEL"] ?? "info", LOG_LEVELS);
  const authProvider = parseUnion("AUTH_PROVIDER", read(source, "AUTH_PROVIDER"), AUTH_PROVIDERS);
  assertAuthProviderAllowed(appEnv, authProvider);

  return { nodeEnv, appEnv, logLevel, authProvider };
}

let cached: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  cached ??= loadServerEnv();
  return cached;
}

/** Test-only: drop the process-wide cache. */
export function resetServerEnvCache(): void {
  cached = undefined;
}
