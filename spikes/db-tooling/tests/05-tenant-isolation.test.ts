import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { sql } from "kysely";
import { poolConfig } from "../src/config.ts";
import { createTenantDb, type TenantDb, type Tx } from "../src/db.ts";
import {
  TENANT_TABLES,
  createOrgFixture,
  deleteOrgFixture,
  expectSqlState,
  rolePool,
  type OrgFixture,
} from "./helpers.ts";

const INSUFFICIENT_PRIVILEGE = "42501";
const INVALID_TEXT_REPRESENTATION = "22P02";
const EXPECTED_ROWS: Record<(typeof TENANT_TABLES)[number]["table"], number> = {
  "spike.organizations": 1,
  "spike.schools": 2,
  "spike.school_notes": 2,
  "spike.org_events": 2,
};

let superuser: pg.Pool;
let dbMany: TenantDb;
let dbOne: TenantDb;
let orgA: OrgFixture;
let orgB: OrgFixture;

beforeAll(async () => {
  superuser = rolePool("postgres");
  dbMany = createTenantDb(poolConfig("app_user", { max: 4 }));
  dbOne = createTenantDb(poolConfig("app_user", { max: 1 }));
  orgA = await createOrgFixture(superuser, "A");
  orgB = await createOrgFixture(superuser, "B");
});

afterAll(async () => {
  await deleteOrgFixture(superuser, orgA.orgId);
  await deleteOrgFixture(superuser, orgB.orgId);
  await Promise.all([dbMany.close(), dbOne.close(), superuser.end()]);
});

const ctx = (org: OrgFixture) => ({ orgId: org.orgId, userId: org.userId });

async function tenantKeys(tx: Tx, table: string, key: string): Promise<string[]> {
  const { rows } = await sql<{ k: string }>`select ${sql.ref(key)} as k from ${sql.table(table)}`.execute(tx);
  return rows.map((r) => r.k);
}

/** Total rows visible across every tenant table. Used by real tests and by the negative control. */
async function visibleTenantRows(run: (q: string) => Promise<number>): Promise<number> {
  let total = 0;
  for (const { table } of TENANT_TABLES) {
    total += await run(`select count(*)::int as n from ${table}`);
  }
  return total;
}

async function visibleRowsViaTx(tx: Tx): Promise<number> {
  return visibleTenantRows(async (q) => {
    const { rows } = await sql<{ n: number }>`${sql.raw(q)}`.execute(tx);
    return rows[0]?.n ?? -1;
  });
}

async function backendPid(tx: Tx): Promise<number> {
  const { rows } = await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(tx);
  return rows[0]?.pid ?? -1;
}

async function currentOrgSetting(tx: Tx): Promise<string | null> {
  const { rows } = await sql<{ org: string | null }>`select nullif(current_setting('app.current_org_id', true), '') as org`.execute(tx);
  return rows[0]?.org ?? null;
}

describe("V8.1 / V8.2 each organization sees only its own rows", () => {
  for (const label of ["A", "B"] as const) {
    for (const { table, key } of TENANT_TABLES) {
      it(`org ${label}: ${table}`, async () => {
        const org = label === "A" ? orgA : orgB;
        const keys = await dbMany.withTenant(ctx(org), (tx) => tenantKeys(tx, table, key));
        expect(keys).toHaveLength(EXPECTED_ROWS[table]);
        expect(new Set(keys)).toEqual(new Set([org.orgId]));
      });
    }
  }
});

describe("V8.3 requests without tenant context are denied", () => {
  for (const { table, key } of TENANT_TABLES) {
    it(`no context: ${table} returns no rows`, async () => {
      expect(await dbMany.withoutTenantContext((tx) => tenantKeys(tx, table, key))).toEqual([]);
    });
  }

  it("no context, outside any explicit transaction: no rows", async () => {
    const { rows } = await dbMany.pool.query<{ n: number }>("select count(*)::int as n from spike.schools");
    expect(rows[0]?.n).toBe(0);
  });

  it("no context: INSERT is rejected by WITH CHECK", async () => {
    await expectSqlState(
      dbMany.withoutTenantContext((tx) =>
        tx.insertInto("spike.schools").values({ id: randomUUID(), organization_id: orgA.orgId, name: "synthetic" }).execute(),
      ),
      INSUFFICIENT_PRIVILEGE,
    );
  });

  it("no context: UPDATE and DELETE affect no rows", async () => {
    const result = await dbMany.withoutTenantContext(async (tx) => ({
      updated: await tx.updateTable("spike.schools").set({ name: "synthetic overwrite" }).executeTakeFirst(),
      deleted: await tx.deleteFrom("spike.school_notes").executeTakeFirst(),
    }));
    expect(result.updated.numUpdatedRows).toBe(0n);
    expect(result.deleted.numDeletedRows).toBe(0n);
  });

  it("an empty context value is treated as no context", async () => {
    const n = await dbMany.withoutTenantContext(async (tx) => {
      await sql`select set_config('app.current_org_id', '', true)`.execute(tx);
      return visibleRowsViaTx(tx);
    });
    expect(n).toBe(0);
  });

  it("a malformed context value raises an error instead of matching rows", async () => {
    await expectSqlState(
      dbMany.withoutTenantContext(async (tx) => {
        await sql`select set_config('app.current_org_id', 'not-a-uuid', true)`.execute(tx);
        return visibleRowsViaTx(tx);
      }),
      INVALID_TEXT_REPRESENTATION,
    );
  });
});

describe("V8.4 cross-tenant writes are rejected", () => {
  it("org B cannot insert a row carrying org A's organization_id", async () => {
    await expectSqlState(
      dbMany.withTenant(ctx(orgB), (tx) =>
        tx.insertInto("spike.schools").values({ id: randomUUID(), organization_id: orgA.orgId, name: "synthetic" }).execute(),
      ),
      INSUFFICIENT_PRIVILEGE,
    );
  });

  it("org B cannot move its own row into org A", async () => {
    await expectSqlState(
      dbMany.withTenant(ctx(orgB), (tx) =>
        tx.updateTable("spike.schools").set({ organization_id: orgA.orgId }).where("id", "=", orgB.schoolIds[0]).execute(),
      ),
      INSUFFICIENT_PRIVILEGE,
    );
  });

  it("org B's UPDATE and DELETE of org A's rows affect nothing, and A's rows are unchanged", async () => {
    const before = await superuser.query("select id, name from spike.schools where organization_id = $1 order by id", [orgA.orgId]);
    const result = await dbMany.withTenant(ctx(orgB), async (tx) => ({
      updated: await tx.updateTable("spike.schools").set({ name: "synthetic overwrite" }).where("id", "in", orgA.schoolIds).executeTakeFirst(),
      deleted: await tx.deleteFrom("spike.school_notes").where("id", "in", orgA.noteIds).executeTakeFirst(),
    }));
    expect(result.updated.numUpdatedRows).toBe(0n);
    expect(result.deleted.numDeletedRows).toBe(0n);
    const after = await superuser.query("select id, name from spike.schools where organization_id = $1 order by id", [orgA.orgId]);
    expect(after.rows).toEqual(before.rows);
    const notes = await superuser.query("select count(*)::int as n from spike.school_notes where id = any($1)", [orgA.noteIds]);
    expect(notes.rows).toEqual([{ n: 2 }]);
  });
});

describe("V8.5 rollback does not leak tenant context", () => {
  let raw: pg.Pool;

  beforeAll(() => {
    raw = rolePool("app_user", { max: 1 });
  });

  afterAll(async () => {
    await raw.end();
  });

  async function rawSetting(client: pg.PoolClient): Promise<string> {
    const { rows } = await client.query<{ v: string | null }>("select current_setting('app.current_org_id', true) as v");
    return rows[0]?.v ?? "";
  }

  it("ROLLBACK discards set_config(..., true)", async () => {
    const client = await raw.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('app.current_org_id', $1, true)", [orgA.orgId]);
      expect(await rawSetting(client)).toBe(orgA.orgId);
      await client.query("rollback");
      expect(await rawSetting(client)).toBe("");
    } finally {
      client.release();
    }
  });

  it("ROLLBACK after a failed statement discards the context", async () => {
    const client = await raw.connect();
    try {
      await client.query("begin");
      await client.query("set local app.current_org_id = '" + orgA.orgId + "'");
      await expect(client.query("select 1 / 0")).rejects.toMatchObject({ code: "22012" });
      await client.query("rollback");
      expect(await rawSetting(client)).toBe("");
    } finally {
      client.release();
    }
  });

  it("ROLLBACK TO SAVEPOINT discards a context set after the savepoint", async () => {
    const client = await raw.connect();
    try {
      await client.query("begin");
      await client.query("savepoint s1");
      await client.query("select set_config('app.current_org_id', $1, true)", [orgA.orgId]);
      await client.query("rollback to savepoint s1");
      expect(await rawSetting(client)).toBe("");
      await client.query("commit");
    } finally {
      client.release();
    }
  });

  it("after a handler error, the next borrower of the same connection has no context", async () => {
    let failedPid = -1;
    await expect(
      dbOne.withTenant(ctx(orgA), async (tx) => {
        failedPid = await backendPid(tx);
        throw new Error("synthetic failure");
      }),
    ).rejects.toThrow("synthetic failure");
    const next = await dbOne.withoutTenantContext(async (tx) => ({
      pid: await backendPid(tx),
      org: await currentOrgSetting(tx),
      rows: await visibleRowsViaTx(tx),
    }));
    expect(next).toEqual({ pid: failedPid, org: null, rows: 0 });
  });

  it("after an RLS violation, the next borrower of the same connection has no context", async () => {
    await expectSqlState(
      dbOne.withTenant(ctx(orgB), (tx) =>
        tx.insertInto("spike.schools").values({ id: randomUUID(), organization_id: orgA.orgId, name: "synthetic" }).execute(),
      ),
      INSUFFICIENT_PRIVILEGE,
    );
    const next = await dbOne.withoutTenantContext(async (tx) => ({ org: await currentOrgSetting(tx), rows: await visibleRowsViaTx(tx) }));
    expect(next).toEqual({ org: null, rows: 0 });
  });
});

describe("V8.6 a reused pooled connection does not retain the previous tenant's context", () => {
  it("one connection serves A, B, no-context, then A, and each sees only its own rows", async () => {
    const observe = (tx: Tx) =>
      Promise.all([backendPid(tx), currentOrgSetting(tx), tenantKeys(tx, "spike.schools", "organization_id")]);
    const a1 = await dbOne.withTenant(ctx(orgA), observe);
    const b = await dbOne.withTenant(ctx(orgB), observe);
    const none = await dbOne.withoutTenantContext(observe);
    const a2 = await dbOne.withTenant(ctx(orgA), observe);

    expect(new Set([a1[0], b[0], none[0], a2[0]]).size).toBe(1);
    expect(a1.slice(1)).toEqual([orgA.orgId, [orgA.orgId, orgA.orgId]]);
    expect(b.slice(1)).toEqual([orgB.orgId, [orgB.orgId, orgB.orgId]]);
    expect(none.slice(1)).toEqual([null, []]);
    expect(a2.slice(1)).toEqual([orgA.orgId, [orgA.orgId, orgA.orgId]]);
  });
});

describe("V8.8 negative control: the same assertions detect a session-level leak", () => {
  let raw: pg.Pool;

  beforeAll(() => {
    raw = rolePool("app_user", { max: 1 });
  });

  afterAll(async () => {
    await raw.end();
  });

  async function visibleRowsViaClient(client: pg.PoolClient): Promise<number> {
    return visibleTenantRows(async (q) => {
      const { rows } = await client.query<{ n: number }>(q);
      return rows[0]?.n ?? -1;
    });
  }

  const wrongContextSetters: Array<[string, (client: pg.PoolClient, orgId: string) => Promise<unknown>]> = [
    ["set_config(..., false)", (client, orgId) => client.query("select set_config('app.current_org_id', $1, false)", [orgId])],
    ["session-level SET", (client, orgId) => client.query(`set app.current_org_id = '${orgId}'`)],
  ];

  for (const [name, setWrongly] of wrongContextSetters) {
    it(`a deliberately wrong ${name} leaks to the next borrower and is detected`, async () => {
      const first = await raw.connect();
      let leakingPid = -1;
      try {
        leakingPid = (await first.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]?.pid ?? -1;
        await first.query("begin");
        await setWrongly(first, orgA.orgId);
        await first.query("commit");
      } finally {
        first.release();
      }

      const next = await raw.connect();
      try {
        const pid = (await next.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]?.pid ?? -2;
        expect(pid).toBe(leakingPid);
        const leaked = await visibleRowsViaClient(next);
        expect(leaked).toBe(EXPECTED_ROWS["spike.organizations"] + 2 + 2 + 2);
      } finally {
        next.release(true);
      }
    });
  }
});
