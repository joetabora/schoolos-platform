import { describe, expect, it } from "vitest";
import { isSensitiveKey, redactFields, redactSensitiveText } from "@/platform/log/logger";

const postgresWithPassword = "postgres://schoolos:test-password@db.example.test:5432/schoolos";
const postgresWithQuery =
  "postgresql://schoolos:test-password@db.example.test:5432/schoolos?sslmode=require";
const postgresNoAuth = "postgresql://db.example.test:5432/schoolos";
const publicUrl = "https://status.example.test/health";

describe("isSensitiveKey", () => {
  it("matches mixed-case and punctuated credential keys", () => {
    expect(isSensitiveKey("DATABASE_URL")).toBe(true);
    expect(isSensitiveKey("databaseUrl")).toBe(true);
    expect(isSensitiveKey("Database-Url")).toBe(true);
    expect(isSensitiveKey("sessionId")).toBe(true);
    expect(isSensitiveKey("SESSION_ID")).toBe(true);
    expect(isSensitiveKey("connectionString")).toBe(true);
    expect(isSensitiveKey("password")).toBe(true);
    expect(isSensitiveKey("api_key")).toBe(true);
  });

  it("does not treat ordinary diagnostic keys as secrets", () => {
    expect(isSensitiveKey("sessionCount")).toBe(false);
    expect(isSensitiveKey("session")).toBe(false);
    expect(isSensitiveKey("userId")).toBe(false);
    expect(isSensitiveKey("statusUrl")).toBe(false);
  });
});

describe("redactSensitiveText", () => {
  it("strips userinfo from PostgreSQL URLs and keeps the host", () => {
    const redacted = redactSensitiveText(`failed ${postgresWithPassword}`);
    expect(redacted).not.toContain("test-password");
    expect(redacted).not.toContain("schoolos:test-password");
    expect(redacted).toContain("db.example.test");
    expect(redacted).toContain("schoolos");
  });

  it("strips credentials from postgresql URLs that include query parameters", () => {
    const redacted = redactSensitiveText(postgresWithQuery);
    expect(redacted).not.toContain("test-password");
    expect(redacted).toContain("sslmode=require");
    expect(redacted).toContain("db.example.test");
  });

  it("leaves PostgreSQL URLs without userinfo and ordinary https URLs intact", () => {
    expect(redactSensitiveText(postgresNoAuth)).toContain("db.example.test");
    expect(redactSensitiveText(`probe ${publicUrl}`)).toContain(publicUrl);
  });

  it("strips password assignments from libpq keyword-value connection strings", () => {
    const kv =
      "host=db.example.test port=5432 dbname=schoolos user=schoolos password=test-password sslmode=require";
    const redacted = redactSensitiveText(`connect ${kv}`);
    expect(redacted).not.toContain("test-password");
    expect(redacted).toContain("password=redacted");
    expect(redacted).toContain("host=db.example.test");
    expect(redacted).toContain("user=schoolos");
    expect(redacted).toContain("sslmode=require");
  });

  it("strips quoted and semicolon-delimited password fields", () => {
    const ado = "Host=db.example.test;Username=schoolos;Password='test-password';Database=schoolos";
    const redacted = redactSensitiveText(ado);
    expect(redacted).not.toContain("test-password");
    expect(redacted).toMatch(/Password=\s*redacted/i);
    expect(redacted).toContain("Host=db.example.test");
    expect(redacted).toContain("Username=schoolos");
  });
});

describe("redactFields", () => {
  it("redacts secret-like keys and nested objects", () => {
    expect(
      redactFields({
        userId: "00000000-0000-4000-8000-000000000001",
        password: "should-not-appear",
        api_key: "abcd",
        nested: { accessToken: "xyz", count: 2 },
      }),
    ).toEqual({
      userId: "00000000-0000-4000-8000-000000000001",
      password: "[redacted]",
      api_key: "[redacted]",
      nested: { accessToken: "[redacted]", count: 2 },
    });
  });

  it("redacts DATABASE_URL and sessionId including mixed case and nesting", () => {
    expect(
      redactFields({
        DATABASE_URL: postgresWithPassword,
        nested: { sessionId: "sess-123", Database_Url: postgresWithQuery },
      }),
    ).toEqual({
      DATABASE_URL: "[redacted]",
      nested: { sessionId: "[redacted]", Database_Url: "[redacted]" },
    });
  });

  it("scans array values for PostgreSQL credentials without dropping other items", () => {
    expect(
      redactFields({
        events: [postgresWithPassword, "device-sync", { note: publicUrl }],
      }),
    ).toEqual({
      events: [redactSensitiveText(postgresWithPassword), "device-sync", { note: publicUrl }],
    });
  });

  it("redacts connection information on Error objects including stack text", () => {
    const error = new Error(`connect failed ${postgresWithPassword}`);
    const redacted = redactFields({ err: error });
    const err = redacted["err"];
    expect(err).toEqual(
      expect.objectContaining({
        name: "Error",
        message: redactSensitiveText(error.message),
      }),
    );
    expect(JSON.stringify(redacted)).not.toContain("test-password");
  });

  it("does not redact the word session or unrelated https URLs", () => {
    expect(
      redactFields({
        sessionCount: 3,
        session: { started: true },
        url: publicUrl,
      }),
    ).toEqual({
      sessionCount: 3,
      session: { started: true },
      url: publicUrl,
    });
  });
});
