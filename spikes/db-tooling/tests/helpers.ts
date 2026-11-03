import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { expect } from "vitest";
import { LOCAL_ONLY_PASSWORDS, poolConfig, type SpikeRole } from "../src/config.ts";

export const SPIKE_ROOT = fileURLToPath(new URL("..", import.meta.url));

export function rolePool(role: SpikeRole, options: { database?: string; max?: number } = {}): pg.Pool {
  const pool = new pg.Pool(poolConfig(role, options));
  pool.on("error", (err) => {
    console.error(`idle pg client error (${role}): ${err.message}`);
  });
  return pool;
}

/** Out-of-band password provisioning for login roles created by migrations. */
export async function provisionLocalPasswords(superuser: pg.Pool): Promise<void> {
  for (const role of ["app_user", "app_auth"] as const) {
    await superuser.query(`alter role ${role} password '${LOCAL_ONLY_PASSWORDS[role]}'`);
  }
}

export function sqlState(err: unknown): string | undefined {
  if (typeof err === "object" && err !== null && "code" in err && typeof err.code === "string") {
    return err.code;
  }
  return undefined;
}

/** Asserts that a promise rejects with the given PostgreSQL SQLSTATE. */
export async function expectSqlState(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code });
}

export type OrgFixture = {
  orgId: string;
  userId: string;
  schoolIds: [string, string];
  noteIds: [string, string];
  label: string;
};

/**
 * Inserts one synthetic organization with two schools, two notes, and two
 * events. Runs as the superuser because app_user can't create organizations.
 */
export async function createOrgFixture(superuser: pg.Pool, label: string): Promise<OrgFixture> {
  const orgId = randomUUID();
  const schoolIds: [string, string] = [randomUUID(), randomUUID()];
  const noteIds: [string, string] = [randomUUID(), randomUUID()];
  const suffix = orgId.slice(0, 8);
  await superuser.query("insert into spike.organizations (id, name, slug) values ($1, $2, $3)", [
    orgId,
    `Synthetic Org ${label}`,
    `synthetic-${label.toLowerCase()}-${suffix}`,
  ]);
  for (const [i, schoolId] of schoolIds.entries()) {
    await superuser.query("insert into spike.schools (id, organization_id, name) values ($1, $2, $3)", [
      schoolId,
      orgId,
      `Synthetic School ${label}${i + 1}`,
    ]);
  }
  for (const [i, noteId] of noteIds.entries()) {
    await superuser.query(
      "insert into spike.school_notes (id, organization_id, school_id, body) values ($1, $2, $3, $4)",
      [noteId, orgId, schoolIds[0], `synthetic note ${label}${i + 1}`],
    );
  }
  await superuser.query(
    "insert into spike.org_events (organization_id, seq, action) values ($1, 1, 'created'), ($1, 2, 'updated')",
    [orgId],
  );
  return { orgId, userId: randomUUID(), schoolIds, noteIds, label };
}

export async function deleteOrgFixture(superuser: pg.Pool, orgId: string): Promise<void> {
  await superuser.query("delete from spike.org_events where organization_id = $1", [orgId]);
  await superuser.query("delete from spike.school_notes where organization_id = $1", [orgId]);
  await superuser.query("delete from spike.schools where organization_id = $1", [orgId]);
  await superuser.query("delete from spike.organizations where id = $1", [orgId]);
}

export type CommandResult = { status: number | null; stdout: string; stderr: string };

export function runScript(script: string, args: string[], env: Record<string, string> = {}): CommandResult {
  const result = spawnSync("bash", [script, ...args], {
    cwd: SPIKE_ROOT,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** All tenant tables in the spike schema, with their tenant-key column. */
export const TENANT_TABLES = [
  { table: "spike.organizations", key: "id" },
  { table: "spike.schools", key: "organization_id" },
  { table: "spike.school_notes", key: "organization_id" },
  { table: "spike.org_events", key: "organization_id" },
] as const;
