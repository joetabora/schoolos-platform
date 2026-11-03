import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function lintSnippet(filePath: string, code: string): Promise<ESLint.LintResult[]> {
  const eslint = new ESLint({ cwd: root });
  return eslint.lintText(code, { filePath: path.join(root, filePath) });
}

function restrictedMessages(results: ESLint.LintResult[]): string[] {
  return results.flatMap((result) =>
    result.messages
      .filter((message) => message.ruleId === "no-restricted-imports")
      .map((message) => message.message),
  );
}

async function effectiveRestrictedImports(filePath: string): Promise<unknown> {
  const eslint = new ESLint({ cwd: root });
  const config = await eslint.calculateConfigForFile(path.join(root, filePath));
  const rule = (config as { rules?: Record<string, unknown> }).rules?.["no-restricted-imports"];
  return rule;
}

describe("ESLint import boundaries", () => {
  it("applies package and server-module restrictions to UI files", async () => {
    const rule = await effectiveRestrictedImports("src/components/ui/button.tsx");
    expect(JSON.stringify(rule)).toContain("@/platform/config/env");
    expect(JSON.stringify(rule)).toContain("pg");
    expect(JSON.stringify(rule)).toContain("@supabase/supabase-js");
  });

  it("applies provider restrictions to domain modules", async () => {
    const rule = await effectiveRestrictedImports("src/modules/devices/service.ts");
    expect(JSON.stringify(rule)).toContain("@/providers");
    expect(JSON.stringify(rule)).toContain("pg");
  });

  it("rejects UI imports of server env, logging, db, pg, and supabase", async () => {
    const env = restrictedMessages(
      await lintSnippet(
        "src/components/ui/probe-env.ts",
        `import { getServerEnv } from "@/platform/config/env";\nexport const probe = getServerEnv;\n`,
      ),
    );
    expect(env.some((message) => message.includes("server-only platform modules"))).toBe(true);

    const relativeLog = restrictedMessages(
      await lintSnippet(
        "app/page-probe.ts",
        `import { logger } from "../src/platform/log/logger";\nexport const probe = logger;\n`,
      ),
    );
    expect(relativeLog.some((message) => message.includes("server-only platform modules"))).toBe(
      true,
    );

    const libEnv = restrictedMessages(
      await lintSnippet(
        "src/lib/probe-env.ts",
        `import { getServerEnv } from "@/platform/config/env";\nexport const probe = getServerEnv;\n`,
      ),
    );
    expect(libEnv.some((message) => message.includes("server-only platform modules"))).toBe(true);

    const pg = restrictedMessages(
      await lintSnippet(
        "src/components/ui/probe-pg.ts",
        `import pg from "pg";\nexport const probe = pg;\n`,
      ),
    );
    expect(pg.some((message) => message.includes("src/platform/db"))).toBe(true);

    const supabase = restrictedMessages(
      await lintSnippet(
        "app/layout-probe.ts",
        `import { createClient } from "@supabase/supabase-js";\nexport const probe = createClient;\n`,
      ),
    );
    expect(supabase.some((message) => message.includes("src/platform/auth"))).toBe(true);
  });

  it("rejects domain-module imports of providers, pg, and supabase", async () => {
    const provider = restrictedMessages(
      await lintSnippet(
        "src/modules/organizations/service.ts",
        `import { chromeos } from "@/providers/chromeos";\nexport const probe = chromeos;\n`,
      ),
    );
    expect(provider.some((message) => message.includes("provider adapters"))).toBe(true);

    const pg = restrictedMessages(
      await lintSnippet(
        "src/modules/devices/repository.ts",
        `import { Kysely } from "kysely";\nexport const probe = Kysely;\n`,
      ),
    );
    expect(pg.some((message) => message.includes("src/platform/db"))).toBe(true);
  });

  it("allows pg in src/platform/db and supabase in src/platform/auth", async () => {
    const db = restrictedMessages(
      await lintSnippet(
        "src/platform/db/pool.ts",
        `import pg from "pg";\nimport { Kysely } from "kysely";\nexport const probe = { pg, Kysely };\n`,
      ),
    );
    expect(db).toEqual([]);

    const auth = restrictedMessages(
      await lintSnippet(
        "src/platform/auth/adapter.ts",
        `import { createClient } from "@supabase/supabase-js";\nimport { createServerClient } from "@supabase/ssr";\nexport const probe = { createClient, createServerClient };\n`,
      ),
    );
    expect(auth).toEqual([]);
  });

  it("still forbids supabase inside src/platform/db and pg inside src/platform/auth", async () => {
    const db = restrictedMessages(
      await lintSnippet(
        "src/platform/db/pool.ts",
        `import { createClient } from "@supabase/supabase-js";\nexport const probe = createClient;\n`,
      ),
    );
    expect(db.some((message) => message.includes("src/platform/auth"))).toBe(true);

    const auth = restrictedMessages(
      await lintSnippet(
        "src/platform/auth/adapter.ts",
        `import pg from "pg";\nexport const probe = pg;\n`,
      ),
    );
    expect(auth.some((message) => message.includes("src/platform/db"))).toBe(true);
  });

  it("allows server env imports from API routes, status, worker, and logger", async () => {
    const snippets: Array<[string, string]> = [
      [
        "app/api/v1/health/route.ts",
        `import { getServerEnv } from "@/platform/config/env";\nexport const probe = getServerEnv;\n`,
      ],
      [
        "app/status/page.tsx",
        `import { getServerEnv } from "@/platform/config/env";\nexport const probe = getServerEnv;\n`,
      ],
      [
        "src/worker.ts",
        `import { getServerEnv } from "@/platform/config/env";\nexport const probe = getServerEnv;\n`,
      ],
      [
        "src/platform/log/logger.ts",
        `import { getServerEnv } from "@/platform/config/env";\nexport const probe = getServerEnv;\n`,
      ],
    ];

    for (const [filePath, code] of snippets) {
      const messages = restrictedMessages(await lintSnippet(filePath, code));
      expect(messages, filePath).toEqual([]);
    }
  });
});
