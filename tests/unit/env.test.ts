import { afterEach, describe, expect, it } from "vitest";
import {
  ConfigurationError,
  loadServerEnv,
  parseDotEnv,
  resetServerEnvCache,
} from "@/platform/config/env";

afterEach(() => {
  resetServerEnvCache();
});

const localSource: NodeJS.ProcessEnv = {
  NODE_ENV: "development",
  APP_ENV: "local",
  LOG_LEVEL: "info",
  AUTH_PROVIDER: "fake",
};

describe("loadServerEnv", () => {
  it("loads a valid local configuration", () => {
    expect(loadServerEnv(localSource)).toEqual({
      nodeEnv: "development",
      appEnv: "local",
      logLevel: "info",
      authProvider: "fake",
    });
  });

  it("requires APP_ENV", () => {
    expect(() => loadServerEnv({ ...localSource, APP_ENV: undefined })).toThrow(ConfigurationError);
    expect(() => loadServerEnv({ ...localSource, APP_ENV: undefined })).toThrow(
      /APP_ENV is required/,
    );
  });

  it("requires AUTH_PROVIDER", () => {
    expect(() => loadServerEnv({ ...localSource, AUTH_PROVIDER: undefined })).toThrow(
      /AUTH_PROVIDER is required/,
    );
  });

  it("rejects unknown APP_ENV values with the allowed list", () => {
    expect(() => loadServerEnv({ ...localSource, APP_ENV: "prod" })).toThrow(
      /APP_ENV must be one of: local, test, dev, staging, production/,
    );
  });

  it("rejects AUTH_PROVIDER=fake outside local and test", () => {
    expect(() => loadServerEnv({ ...localSource, APP_ENV: "dev" })).toThrow(
      /AUTH_PROVIDER=fake is allowed only when APP_ENV is local or test/,
    );
    expect(() => loadServerEnv({ ...localSource, APP_ENV: "staging" })).toThrow(
      /AUTH_PROVIDER=fake is allowed only when APP_ENV is local or test/,
    );
    expect(() => loadServerEnv({ ...localSource, APP_ENV: "production" })).toThrow(
      /AUTH_PROVIDER=fake is allowed only when APP_ENV is local or test/,
    );
  });

  it("allows AUTH_PROVIDER=fake in test", () => {
    expect(loadServerEnv({ ...localSource, APP_ENV: "test", NODE_ENV: "test" }).authProvider).toBe(
      "fake",
    );
  });

  it("rejects AUTH_PROVIDER=supabase until step 3", () => {
    expect(() =>
      loadServerEnv({ ...localSource, APP_ENV: "local", AUTH_PROVIDER: "supabase" }),
    ).toThrow(/not implemented/);
  });

  it("parses dotenv files without interpolating or executing values", () => {
    expect(
      parseDotEnv(`
# APP_ENV=production
APP_ENV=local
export AUTH_PROVIDER=fake
LOG_LEVEL="info"
`),
    ).toEqual({
      APP_ENV: "local",
      AUTH_PROVIDER: "fake",
      LOG_LEVEL: "info",
    });
  });

  it("does not include secret values in error messages", () => {
    try {
      loadServerEnv({ ...localSource, APP_ENV: "staging", DATABASE_URL: "postgres://secret" });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      expect(String(error)).not.toContain("postgres://");
      expect(String(error)).not.toContain("secret");
    }
  });
});
