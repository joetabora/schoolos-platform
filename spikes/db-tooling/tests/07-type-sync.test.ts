import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { SPIKE_ROOT, rolePool, runScript } from "./helpers.ts";

let owner: pg.Pool;

beforeAll(() => {
  owner = rolePool("schoolos_owner");
});

afterAll(async () => {
  await owner.query("alter table spike.schools drop column if exists drift_probe");
  await owner.end();
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === "fixtures" ? [] : sourceFiles(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

describe("V7 type synchronization", () => {
  it("generated types match the migrated database", () => {
    const result = runScript("scripts/codegen.sh", ["--verify"]);
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });

  it("detects drift when the database changes, and passes again once reverted", async () => {
    await owner.query("alter table spike.schools add column drift_probe text");
    try {
      const drifted = runScript("scripts/codegen.sh", ["--verify"]);
      expect(drifted.status).not.toBe(0);
      expect(drifted.stdout + drifted.stderr).toContain("drift_probe");
    } finally {
      await owner.query("alter table spike.schools drop column drift_probe");
    }
    const reverted = runScript("scripts/codegen.sh", ["--verify"]);
    expect(reverted.status, reverted.stdout + reverted.stderr).toBe(0);
  });

  it("generated types contain no `any`", () => {
    const generated = readFileSync(join(SPIKE_ROOT, "src/db-types.ts"), "utf8");
    expect(generated).not.toMatch(/\bany\b/);
  });

  it("sources use no `any`, unsafe double casts, or suppressed type errors", () => {
    const offenders: string[] = [];
    const banned = [/:\s*any\b/, /\bas any\b/, /<any>/, /as unknown as/, /@ts-ignore/, /@ts-nocheck/];
    for (const file of [...sourceFiles(join(SPIKE_ROOT, "src")), ...sourceFiles(join(SPIKE_ROOT, "tests"))]) {
      const text = readFileSync(file, "utf8");
      for (const pattern of banned) {
        if (pattern.test(text) && !file.endsWith("07-type-sync.test.ts")) offenders.push(`${relative(SPIKE_ROOT, file)}: ${pattern}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("tsconfig keeps strict settings on", () => {
    const tsconfig: unknown = JSON.parse(readFileSync(join(SPIKE_ROOT, "tsconfig.json"), "utf8"));
    expect(tsconfig).toMatchObject({
      compilerOptions: {
        strict: true,
        noUncheckedIndexedAccess: true,
        exactOptionalPropertyTypes: true,
        noImplicitOverride: true,
        useUnknownInCatchVariables: true,
        skipLibCheck: false,
      },
    });
  });

  it("tsc passes in strict mode, including the expected-error type tests", () => {
    const result = spawnSync(join(SPIKE_ROOT, "node_modules/.bin/tsc"), ["--noEmit", "-p", "tsconfig.json"], {
      cwd: SPIKE_ROOT,
      encoding: "utf8",
    });
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });
});
