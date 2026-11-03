import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { Kysely, PostgresDialect, sql, type PostgresPool } from "kysely";
import { poolConfig } from "../src/config.ts";
import { createTenantDb, type TenantDb, type Tx } from "../src/db.ts";
import type { DB } from "../src/db-types.ts";
import { createOrgFixture, deleteOrgFixture, rolePool, type OrgFixture } from "./helpers.ts";

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

type SessionProbe = { pid: number; xid: string; org: string | null };

async function sessionProbe(tx: Tx): Promise<SessionProbe> {
  const { rows } = await sql<SessionProbe>`select pg_backend_pid() as pid, pg_current_xact_id()::text as xid,
      nullif(current_setting('app.current_org_id', true), '') as org`.execute(tx);
  const row = rows[0];
  if (row === undefined) throw new Error("no probe row");
  return row;
}

const ctxA = (): { orgId: string; userId: string } => ({ orgId: orgA.orgId, userId: orgA.userId });

describe("V5 Kysely transaction is pinned to one pg connection with transaction-local context", () => {
  it("every raw and builder statement runs on the same backend and in the same transaction", async () => {
    const result = await dbMany.withTenant(ctxA(), async (tx) => {
      const probes: SessionProbe[] = [];
      const builderPids: number[] = [];
      for (let i = 0; i < 5; i++) {
        probes.push(await sessionProbe(tx));
        const row = await tx.selectNoFrom(sql<number>`pg_backend_pid()`.as("pid")).executeTakeFirstOrThrow();
        builderPids.push(row.pid);
        await tx.selectFrom("spike.schools").select("id").execute();
      }
      return { probes, builderPids };
    });
    const pids = new Set([...result.probes.map((p) => p.pid), ...result.builderPids]);
    const xids = new Set(result.probes.map((p) => p.xid));
    expect(pids.size).toBe(1);
    expect(xids.size).toBe(1);
    expect(result.probes.every((p) => p.org === orgA.orgId)).toBe(true);
  });

  it("builder queries on RLS tables return only the tenant's rows", async () => {
    const rows = await dbMany.withTenant(ctxA(), async (tx) => ({
      orgs: await tx.selectFrom("spike.organizations").select("id").execute(),
      schools: await tx.selectFrom("spike.schools").select(["id", "organization_id"]).execute(),
      notes: await tx.selectFrom("spike.school_notes").select(["id", "organization_id"]).execute(),
      events: await tx.selectFrom("spike.org_events").select(["organization_id", "seq"]).execute(),
    }));
    expect(rows.orgs.map((r) => r.id)).toEqual([orgA.orgId]);
    expect(rows.schools.map((r) => r.id).sort()).toEqual([...orgA.schoolIds].sort());
    expect(rows.notes.map((r) => r.id).sort()).toEqual([...orgA.noteIds].sort());
    expect(rows.events).toHaveLength(2);
    for (const r of [...rows.schools, ...rows.notes, ...rows.events]) {
      expect(r.organization_id).toBe(orgA.orgId);
    }
  });

  it("the context is gone after commit on the same connection", async () => {
    const inside = await dbOne.withTenant(ctxA(), sessionProbe);
    const after = await dbOne.withoutTenantContext(async (tx) => ({
      probe: await sessionProbe(tx),
      schools: await tx.selectFrom("spike.schools").select("id").execute(),
    }));
    expect(after.probe.pid).toBe(inside.pid);
    expect(after.probe.org).toBeNull();
    expect(after.schools).toEqual([]);
  });

  it("nested transactions and connection escapes are rejected at compile time and at runtime", async () => {
    await expect(
      // @ts-expect-error Transaction.transaction() is typed as never
      dbMany.withTenant(ctxA(), async (tx) => tx.transaction().execute(async () => 1)),
    ).rejects.toThrow("calling the transaction method for a Transaction is not supported");
    await expect(
      // @ts-expect-error Transaction.startTransaction() is typed as never
      dbMany.withTenant(ctxA(), async (tx) => tx.startTransaction().execute()),
    ).rejects.toThrow("calling the controlled transaction method for a Transaction is not supported");
    await expect(
      // @ts-expect-error Transaction.connection() is typed as never
      dbMany.withTenant(ctxA(), async (tx) => tx.connection().execute(async () => 1)),
    ).rejects.toThrow("calling the connection method for a Transaction is not supported");
  });

  it("a transaction handle used after commit or rollback is rejected", async () => {
    let committed: Tx | undefined;
    await dbOne.withTenant(ctxA(), async (tx) => {
      committed = tx;
    });
    if (committed === undefined) throw new Error("handle not captured");
    await expect(committed.selectFrom("spike.schools").select("id").execute()).rejects.toThrow(
      "Transaction is already committed",
    );

    let rolledBack: Tx | undefined;
    await expect(
      dbOne.withTenant(ctxA(), async (tx) => {
        rolledBack = tx;
        throw new Error("synthetic failure");
      }),
    ).rejects.toThrow("synthetic failure");
    if (rolledBack === undefined) throw new Error("handle not captured");
    await expect(rolledBack.selectFrom("spike.schools").select("id").execute()).rejects.toThrow(
      "Transaction is already rolled back",
    );
  });

  it("a handler error rolls back its writes", async () => {
    const noteId = randomUUID();
    await expect(
      dbMany.withTenant(ctxA(), async (tx) => {
        await tx
          .insertInto("spike.school_notes")
          .values({ id: noteId, organization_id: orgA.orgId, school_id: orgA.schoolIds[0], body: "synthetic rollback" })
          .execute();
        throw new Error("synthetic failure");
      }),
    ).rejects.toThrow("synthetic failure");
    const found = await dbMany.withTenant(ctxA(), (tx) =>
      tx.selectFrom("spike.school_notes").select("id").where("id", "=", noteId).execute(),
    );
    expect(found).toEqual([]);
  });

  it("hazard: a handler that swallows a database error resolves, but its earlier writes are silently rolled back", async () => {
    const noteId = randomUUID();
    const outcome = await dbMany.withTenant(ctxA(), async (tx) => {
      await tx
        .insertInto("spike.school_notes")
        .values({ id: noteId, organization_id: orgA.orgId, school_id: orgA.schoolIds[0], body: "synthetic swallowed" })
        .execute();
      try {
        await sql`select 1 / 0`.execute(tx);
      } catch {
        return "handler swallowed the error";
      }
      return "unreachable";
    });
    expect(outcome).toBe("handler swallowed the error");
    const found = await dbMany.withTenant(ctxA(), (tx) =>
      tx.selectFrom("spike.school_notes").select("id").where("id", "=", noteId).execute(),
    );
    expect(found).toEqual([]);
  });

  it("malformed tenant IDs are refused before any query runs", async () => {
    await expect(dbMany.withTenant({ orgId: "not-a-uuid", userId: orgA.userId }, async () => 1)).rejects.toThrow(
      "orgId must be a lower-case UUID",
    );
  });
});

describe("V6 raw SQL interoperability on the transaction connection", () => {
  const lockKey = (orgId: string) => sql<string>`hashtextextended(${orgId}, 0)`;

  it("pg_advisory_xact_lock is held by the transaction's backend and released at commit", async () => {
    const otherSession = async (): Promise<boolean> => {
      const { rows } = await superuser.query<{ got: boolean }>(
        "select pg_try_advisory_xact_lock(hashtextextended($1, 0)) as got",
        [orgA.orgId],
      );
      return rows[0]?.got ?? false;
    };

    const during = await dbMany.withTenant(ctxA(), async (tx) => {
      await sql`select pg_advisory_xact_lock(${lockKey(orgA.orgId)})`.execute(tx);
      const { pid } = await sessionProbe(tx);
      const { rows } = await sql<{ holder: number }>`select pid as holder from pg_locks
          where locktype = 'advisory' and granted and pid = ${pid}`.execute(tx);
      return { pid, holders: rows.map((r) => r.holder), otherCouldLock: await otherSession() };
    });
    expect(during.holders).toEqual([during.pid]);
    expect(during.otherCouldLock).toBe(false);
    expect(await otherSession()).toBe(true);
  });

  it("set_config(..., true) through raw SQL is visible to builder queries in the same transaction, then gone", async () => {
    const pid = await dbOne.withoutTenantContext(async (tx) => {
      const before = await tx.selectFrom("spike.schools").select("id").execute();
      expect(before).toEqual([]);
      await sql`select set_config('app.current_org_id', ${orgB.orgId}, true)`.execute(tx);
      const after = await tx.selectFrom("spike.schools").select("organization_id").execute();
      expect(after.length).toBe(2);
      expect(after.every((r) => r.organization_id === orgB.orgId)).toBe(true);
      return (await sessionProbe(tx)).pid;
    });
    const next = await dbOne.withoutTenantContext(async (tx) => ({
      probe: await sessionProbe(tx),
      schools: await tx.selectFrom("spike.schools").select("id").execute(),
    }));
    expect(next.probe.pid).toBe(pid);
    expect(next.probe.org).toBeNull();
    expect(next.schools).toEqual([]);
  });
});

/**
 * ADR-0014's literal wording: a Kysely instance constructed per transaction,
 * bound to the transaction's single raw pg client. Tested for comparison.
 */
describe("Comparison: per-transaction Kysely bound to a raw pg client (ADR-0014 wording)", () => {
  let rawPool: pg.Pool;

  beforeAll(() => {
    rawPool = rolePool("app_user", { max: 1 });
  });

  afterAll(async () => {
    await rawPool.end();
  });

  function singleClientPool(client: pg.PoolClient): PostgresPool {
    return {
      options: {},
      connect: async () => ({
        query: client.query.bind(client),
        release: () => undefined,
      }),
      end: async () => undefined,
    };
  }

  async function withTenantBoundClient<T>(orgId: string, fn: (db: Kysely<DB>) => Promise<T>): Promise<T> {
    const client = await rawPool.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('app.current_org_id', $1, true)", [orgId]);
      const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool: singleClientPool(client) }) });
      const result = await fn(db);
      await client.query("commit");
      return result;
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  }

  it("runs on one connection and RLS sees the context (meets ADR-0014 item 4 as written)", async () => {
    const rows = await withTenantBoundClient(orgA.orgId, (db) =>
      db.selectFrom("spike.schools").select("organization_id").execute(),
    );
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.organization_id === orgA.orgId)).toBe(true);
  });

  it("hazard: a nested db.transaction() commits the outer transaction and drops the tenant context", async () => {
    const observed = await withTenantBoundClient(orgA.orgId, async (db) => {
      await db.transaction().execute(async (inner) => inner.selectFrom("spike.schools").select("id").execute());
      const { rows } = await sql<{ org: string | null }>`select nullif(current_setting('app.current_org_id', true), '') as org`.execute(db);
      return rows[0]?.org ?? null;
    });
    expect(observed).toBeNull();
  });

  it("hazard: an escaped handle reads another tenant's rows once the client is reused", async () => {
    let leaked: Kysely<DB> | undefined;
    await withTenantBoundClient(orgA.orgId, async (db) => {
      leaked = db;
    });
    const handle = leaked;
    if (handle === undefined) throw new Error("handle not captured");
    const seenThroughLeakedHandle = await withTenantBoundClient(orgB.orgId, () =>
      handle.selectFrom("spike.schools").select("organization_id").execute(),
    );
    expect(seenThroughLeakedHandle.length).toBe(2);
    expect(seenThroughLeakedHandle.every((r) => r.organization_id === orgB.orgId)).toBe(true);
  });
});
