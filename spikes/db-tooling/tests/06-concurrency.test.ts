import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { sql } from "kysely";
import { poolConfig } from "../src/config.ts";
import { createTenantDb, type TenantDb, type Tx } from "../src/db.ts";
import { createOrgFixture, deleteOrgFixture, rolePool, sqlState, type OrgFixture } from "./helpers.ts";

const POOL_SIZE = 8;
const STRESS_TRANSACTIONS = 400;

let superuser: pg.Pool;
let db: TenantDb;
let orgA: OrgFixture;
let orgB: OrgFixture;

beforeAll(async () => {
  superuser = rolePool("postgres");
  db = createTenantDb(poolConfig("app_user", { max: POOL_SIZE }));
  orgA = await createOrgFixture(superuser, "A");
  orgB = await createOrgFixture(superuser, "B");
});

afterAll(async () => {
  await deleteOrgFixture(superuser, orgA.orgId);
  await deleteOrgFixture(superuser, orgB.orgId);
  await Promise.all([db.close(), superuser.end()]);
});

const ctx = (org: OrgFixture) => ({ orgId: org.orgId, userId: org.userId });

function barrier(parties: number): () => Promise<void> {
  let arrived = 0;
  let release: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  return async () => {
    arrived += 1;
    if (arrived === parties) release();
    await opened;
  };
}

type Observation = { pid: number; org: string | null; schoolOrgs: string[]; noteOrgs: string[] };

async function observe(tx: Tx): Promise<Observation> {
  const { rows } = await sql<{ pid: number; org: string | null }>`select pg_backend_pid() as pid,
      nullif(current_setting('app.current_org_id', true), '') as org`.execute(tx);
  const head = rows[0];
  if (head === undefined) throw new Error("no probe row");
  const schools = await tx.selectFrom("spike.schools").select("organization_id").execute();
  const notes = await tx.selectFrom("spike.school_notes").select("organization_id").execute();
  return { ...head, schoolOrgs: schools.map((r) => r.organization_id), noteOrgs: notes.map((r) => r.organization_id) };
}

describe("V8.7 concurrent requests cannot cross tenant boundaries", () => {
  it("deterministic interleaving: two tenants open, read, write, and re-read in lock-step", async () => {
    const steps = [barrier(2), barrier(2), barrier(2)] as const;
    const run = (org: OrgFixture) =>
      db.withTenant(ctx(org), async (tx) => {
        await steps[0]();
        const first = await observe(tx);
        await steps[1]();
        await tx
          .insertInto("spike.school_notes")
          .values({ id: randomUUID(), organization_id: org.orgId, school_id: org.schoolIds[1], body: "synthetic interleave" })
          .execute();
        await steps[2]();
        const second = await observe(tx);
        return { first, second };
      });

    const [a, b] = await Promise.all([run(orgA), run(orgB)]);
    expect(a.first.pid).not.toBe(b.first.pid);
    for (const [org, result] of [
      [orgA, a],
      [orgB, b],
    ] as const) {
      for (const o of [result.first, result.second]) {
        expect(o.org).toBe(org.orgId);
        expect(new Set([...o.schoolOrgs, ...o.noteOrgs])).toEqual(new Set([org.orgId]));
      }
      expect(result.second.noteOrgs.length).toBe(result.first.noteOrgs.length + 1);
    }
  });

  it(`randomized: ${STRESS_TRANSACTIONS} concurrent transactions on a pool of ${POOL_SIZE}`, async () => {
    type Outcome = { org: string; pid: number; noteId: string; kind: "commit" | "throw" | "rls-violation"; violations: string[] };

    const task = async (i: number): Promise<Outcome> => {
      const org = i % 2 === 0 ? orgA : orgB;
      const other = org === orgA ? orgB : orgA;
      const noteId = randomUUID();
      const kind: Outcome["kind"] = i % 10 === 3 ? "throw" : i % 20 === 7 ? "rls-violation" : "commit";
      const violations: string[] = [];
      let pid = -1;
      try {
        await db.withTenant(ctx(org), async (tx) => {
          const before = await observe(tx);
          pid = before.pid;
          await sql`select pg_sleep(${(i % 4) / 1000})`.execute(tx);
          await tx
            .insertInto("spike.school_notes")
            .values({ id: noteId, organization_id: org.orgId, school_id: org.schoolIds[0], body: "synthetic stress" })
            .execute();
          if (kind === "rls-violation") {
            await tx
              .insertInto("spike.school_notes")
              .values({ id: randomUUID(), organization_id: other.orgId, school_id: other.schoolIds[0], body: "synthetic cross" })
              .execute();
          }
          const after = await observe(tx);
          for (const o of [before, after]) {
            if (o.pid !== pid) violations.push(`pid changed ${pid} -> ${o.pid}`);
            if (o.org !== org.orgId) violations.push(`context ${String(o.org)}`);
            for (const seen of [...o.schoolOrgs, ...o.noteOrgs]) {
              if (seen !== org.orgId) violations.push(`saw row of ${seen}`);
            }
          }
          if (kind === "throw") throw new Error("synthetic failure");
        });
      } catch (err) {
        const expected =
          (kind === "throw" && err instanceof Error && err.message === "synthetic failure") ||
          (kind === "rls-violation" && sqlState(err) === "42501");
        if (!expected) violations.push(`unexpected error: ${String(err)}`);
      }
      return { org: org.orgId, pid, noteId, kind, violations };
    };

    const outcomes = await Promise.all(Array.from({ length: STRESS_TRANSACTIONS }, (_, i) => task(i)));

    expect(outcomes.flatMap((o) => o.violations)).toEqual([]);

    const pidsByOrg = new Map<string, Set<number>>();
    for (const o of outcomes) {
      const set = pidsByOrg.get(o.org) ?? new Set<number>();
      set.add(o.pid);
      pidsByOrg.set(o.org, set);
    }
    const pidsA = pidsByOrg.get(orgA.orgId) ?? new Set<number>();
    const pidsB = pidsByOrg.get(orgB.orgId) ?? new Set<number>();
    const shared = [...pidsA].filter((pid) => pidsB.has(pid));
    expect(new Set([...pidsA, ...pidsB]).size).toBeGreaterThan(1);
    expect(shared.length).toBeGreaterThan(0);

    const committed = outcomes.filter((o) => o.kind === "commit").map((o) => o.noteId);
    const discarded = outcomes.filter((o) => o.kind !== "commit").map((o) => o.noteId);
    const present = await superuser.query<{ id: string; organization_id: string }>(
      "select id, organization_id from spike.school_notes where id = any($1)",
      [[...committed, ...discarded]],
    );
    expect(present.rows.map((r) => r.id).sort()).toEqual([...committed].sort());
    const expectedOrg = new Map(outcomes.map((o) => [o.noteId, o.org]));
    for (const row of present.rows) {
      expect(row.organization_id).toBe(expectedOrg.get(row.id));
    }

    const idle: pg.PoolClient[] = [];
    try {
      for (let i = 0; i < POOL_SIZE; i++) idle.push(await db.pool.connect());
      for (const client of idle) {
        const { rows } = await client.query<{ org: string; n: number }>(
          `select current_setting('app.current_org_id', true) as org,
                  (select count(*)::int from spike.schools) + (select count(*)::int from spike.school_notes) as n`,
        );
        expect(rows).toEqual([{ org: expect.toBeOneOf(["", null]), n: 0 }]);
      }
    } finally {
      for (const client of idle) client.release();
    }
  });
});

describe("V6 advisory-lock sequence allocation under concurrency", () => {
  async function appendEvent(org: OrgFixture, withLock: boolean, delaySeconds: number): Promise<string> {
    return db.withTenant(ctx(org), async (tx) => {
      if (withLock) {
        await sql`select pg_advisory_xact_lock(hashtextextended(${org.orgId}, 0))`.execute(tx);
      }
      const { next } = await tx
        .selectFrom("spike.org_events")
        .select(sql<string>`coalesce(max(seq), 0) + 1`.as("next"))
        .executeTakeFirstOrThrow();
      await sql`select pg_sleep(${delaySeconds})`.execute(tx);
      await tx.insertInto("spike.org_events").values({ organization_id: org.orgId, seq: next, action: "probe" }).execute();
      return next;
    });
  }

  it("with pg_advisory_xact_lock, 40 concurrent appends get unique contiguous sequence numbers", async () => {
    const start = await superuser.query<{ max: string }>("select max(seq)::text as max from spike.org_events where organization_id = $1", [orgA.orgId]);
    const base = Number(start.rows[0]?.max ?? "0");
    const seqs = await Promise.all(Array.from({ length: 40 }, () => appendEvent(orgA, true, 0.002)));
    expect(seqs.map(Number).sort((x, y) => x - y)).toEqual(Array.from({ length: 40 }, (_, i) => base + i + 1));
  });

  it("control: without the lock, concurrent appends collide on the primary key", async () => {
    const results = await Promise.allSettled(Array.from({ length: POOL_SIZE }, () => appendEvent(orgB, false, 0.05)));
    const collisions = results.filter((r) => r.status === "rejected" && sqlState(r.reason) === "23505");
    expect(collisions.length).toBeGreaterThan(0);
  });
});
