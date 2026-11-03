import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { createOrgFixture, deleteOrgFixture, expectSqlState, rolePool, type OrgFixture } from "./helpers.ts";

const INSUFFICIENT_PRIVILEGE = "42501";
const FOREIGN_KEY_VIOLATION = "23503";

let superuser: pg.Pool;
let owner: pg.Pool;
let appUser: pg.Pool;
let orgA: OrgFixture;
let orgB: OrgFixture;

beforeAll(async () => {
  superuser = rolePool("postgres");
  owner = rolePool("schoolos_owner");
  appUser = rolePool("app_user");
  orgA = await createOrgFixture(superuser, "A");
  orgB = await createOrgFixture(superuser, "B");
});

afterAll(async () => {
  await deleteOrgFixture(superuser, orgA.orgId);
  await deleteOrgFixture(superuser, orgB.orgId);
  await Promise.all([superuser.end(), owner.end(), appUser.end()]);
});

/** Runs fn in a transaction (optionally with tenant context) and always rolls back. */
async function probe<T>(pool: pg.Pool, orgId: string | null, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    if (orgId !== null) {
      await client.query("select set_config('app.current_org_id', $1, true)", [orgId]);
    }
    return await fn(client);
  } finally {
    await client.query("rollback").catch(() => undefined);
    client.release();
  }
}

async function count(client: pg.PoolClient | pg.Pool, text: string, values: unknown[] = []): Promise<number> {
  const { rows } = await client.query<{ n: number }>(`select count(*)::int as n from (${text}) as q`, values);
  return rows[0]?.n ?? -1;
}

const fixtureSchools = (): string[] => [orgA.orgId, orgB.orgId];

describe("V10 RLS coverage and FORCE behaviour", () => {
  it("every table in app and spike schemas has RLS enabled and forced with at least one policy", async () => {
    const { rows } = await superuser.query<{ table: string }>(
      `select c.oid::regclass::text as table
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname in ('app', 'spike') and c.relkind in ('r', 'p')
          and (not c.relrowsecurity or not c.relforcerowsecurity
               or not exists (select 1 from pg_policy p where p.polrelid = c.oid))`,
    );
    expect(rows).toEqual([]);
  });

  it("the table owner sees no rows under FORCE RLS (no context)", async () => {
    expect(await count(owner, "select * from spike.schools where organization_id = any($1)", [fixtureSchools()])).toBe(0);
  });

  it("the table owner sees no rows under FORCE RLS even with tenant context (policies are TO app_user)", async () => {
    const n = await probe(owner, orgA.orgId, (c) => count(c, "select * from spike.schools"));
    expect(n).toBe(0);
  });

  it("control: on an ENABLE-only table the owner bypasses RLS; FORCE removes the bypass", async () => {
    await probe(superuser, null, async (c) => {
      await c.query("create table spike.probe_enable_only (organization_id uuid not null)");
      await c.query("alter table spike.probe_enable_only owner to schoolos_owner");
      await c.query("alter table spike.probe_enable_only enable row level security");
      await c.query(
        "create policy t on spike.probe_enable_only to app_user using (organization_id = (select app.current_org_id()))",
      );
      await c.query("insert into spike.probe_enable_only values ($1), ($2)", [orgA.orgId, orgB.orgId]);

      await c.query("set local role schoolos_owner");
      expect(await count(c, "select * from spike.probe_enable_only")).toBe(2);

      await c.query("reset role");
      await c.query("alter table spike.probe_enable_only force row level security");
      await c.query("set local role schoolos_owner");
      expect(await count(c, "select * from spike.probe_enable_only")).toBe(0);
    });
  });

  it("control: a superuser bypasses even FORCE RLS (app must never connect as superuser)", async () => {
    expect(await count(superuser, "select * from spike.schools where organization_id = any($1)", [fixtureSchools()])).toBe(4);
  });

  it("control: a BYPASSRLS role bypasses FORCE RLS; the same role without it sees nothing", async () => {
    await probe(superuser, null, async (c) => {
      await c.query("create role spike_probe_bypass nologin bypassrls");
      await c.query("create role spike_probe_plain nologin");
      await c.query("grant usage on schema spike to spike_probe_bypass, spike_probe_plain");
      await c.query("grant select on spike.schools to spike_probe_bypass, spike_probe_plain");
      await c.query("set local role spike_probe_bypass");
      expect(await count(c, "select * from spike.schools where organization_id = any($1)", [fixtureSchools()])).toBe(4);
      await c.query("reset role");
      await c.query("set local role spike_probe_plain");
      expect(await count(c, "select * from spike.schools where organization_id = any($1)", [fixtureSchools()])).toBe(0);
    });
  });
});

describe("V11 SECURITY DEFINER org enumeration", () => {
  it("returns every organization ID to app_user without tenant context", async () => {
    const ids = await probe(appUser, null, async (c) => {
      const { rows } = await c.query<{ id: string }>("select id from app.list_organization_ids() as id");
      return rows.map((r) => r.id);
    });
    expect(ids).toEqual(expect.arrayContaining([orgA.orgId, orgB.orgId]));
  });

  it("while a direct read of organizations without context returns nothing", async () => {
    expect(await probe(appUser, null, (c) => count(c, "select * from spike.organizations"))).toBe(0);
  });

  it("returns IDs only (signature is SETOF uuid)", async () => {
    const { rows } = await superuser.query<{ result: string }>(
      "select pg_get_function_result('app.list_organization_ids()'::regprocedure) as result",
    );
    expect(rows).toEqual([{ result: "SETOF uuid" }]);
  });

  it("its owner can read only the id column, not names or slugs", async () => {
    await probe(superuser, null, async (c) => {
      await c.query("set local role app_org_enumerator");
      expect(await count(c, "select id from spike.organizations where id = any($1)", [fixtureSchools()])).toBe(2);
      await expectSqlState(c.query("select name from spike.organizations"), INSUFFICIENT_PRIVILEGE);
    });
  });

  it("its owner can't log in and has no BYPASSRLS", async () => {
    const { rows } = await superuser.query(
      "select rolcanlogin, rolbypassrls, rolsuper from pg_roles where rolname = 'app_org_enumerator'",
    );
    expect(rows).toEqual([{ rolcanlogin: false, rolbypassrls: false, rolsuper: false }]);
  });

  it("EXECUTE is not granted to PUBLIC", async () => {
    const { rows } = await superuser.query<{ public_exec: boolean }>(
      `select exists (
         select 1 from pg_proc p, aclexplode(p.proacl) a
          where p.oid = 'app.list_organization_ids()'::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE'
       ) as public_exec`,
    );
    expect(rows).toEqual([{ public_exec: false }]);
  });

  it("control: the same definer owned by the FORCE-RLS table owner returns nothing", async () => {
    await probe(superuser, null, async (c) => {
      await c.query(
        `create function app.probe_owner_definer() returns setof uuid language sql stable security definer
           set search_path = pg_catalog, pg_temp as $$ select id from spike.organizations $$`,
      );
      await c.query("alter function app.probe_owner_definer() owner to schoolos_owner");
      await c.query("grant execute on function app.probe_owner_definer() to app_user");
      await c.query("set local role app_user");
      expect(await count(c, "select * from app.probe_owner_definer()")).toBe(0);
    });
  });
});

describe("V12 triggers and composite tenant FKs", () => {
  it("updated_at trigger fires for app_user under RLS", async () => {
    const result = await probe(appUser, orgA.orgId, async (c) => {
      const before = await c.query<{ updated_at: Date }>("select updated_at from spike.schools where id = $1", [orgA.schoolIds[0]]);
      const after = await c.query<{ updated_at: Date }>(
        "update spike.schools set name = name || ' (renamed)' where id = $1 returning updated_at",
        [orgA.schoolIds[0]],
      );
      return { before: before.rows[0]?.updated_at, after: after.rows[0]?.updated_at };
    });
    if (!(result.before instanceof Date) || !(result.after instanceof Date)) {
      throw new Error("expected updated_at timestamps");
    }
    expect(result.after.getTime()).toBeGreaterThan(result.before.getTime());
  });

  it("append-only trigger rejects UPDATE even for a superuser", async () => {
    await expect(
      probe(superuser, null, (c) => c.query("update spike.org_events set action = 'probe' where organization_id = $1", [orgA.orgId])),
    ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE, message: "table spike.org_events is append-only" });
  });

  it("app_user is refused UPDATE and DELETE on append-only rows by privilege", async () => {
    await expect(
      probe(appUser, orgA.orgId, (c) => c.query("update spike.org_events set action = 'probe'")),
    ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE, message: "permission denied for table org_events" });
    await expect(probe(appUser, orgA.orgId, (c) => c.query("delete from spike.org_events"))).rejects.toMatchObject({
      code: INSUFFICIENT_PRIVILEGE,
      message: "permission denied for table org_events",
    });
  });

  it("composite FK accepts a same-tenant parent", async () => {
    const inserted = await probe(appUser, orgA.orgId, async (c) => {
      const r = await c.query(
        "insert into spike.school_notes (id, organization_id, school_id, body) values ($1, $2, $3, 'synthetic')",
        [randomUUID(), orgA.orgId, orgA.schoolIds[1]],
      );
      return r.rowCount;
    });
    expect(inserted).toBe(1);
  });

  it("composite FK rejects a cross-tenant parent (org B row pointing at org A's school)", async () => {
    await expectSqlState(
      probe(appUser, orgB.orgId, (c) =>
        c.query("insert into spike.school_notes (id, organization_id, school_id, body) values ($1, $2, $3, 'synthetic')", [
          randomUUID(),
          orgB.orgId,
          orgA.schoolIds[0],
        ]),
      ),
      FOREIGN_KEY_VIOLATION,
    );
  });

  it("control: a single-column FK accepts the same cross-tenant reference", async () => {
    await probe(superuser, null, async (c) => {
      await c.query(
        `create table spike.probe_simple_fk (
           id uuid primary key, organization_id uuid not null,
           school_id uuid not null references spike.schools (id))`,
      );
      await c.query("alter table spike.probe_simple_fk enable row level security");
      await c.query("alter table spike.probe_simple_fk force row level security");
      await c.query(
        `create policy t on spike.probe_simple_fk to app_user
           using (organization_id = (select app.current_org_id()))
           with check (organization_id = (select app.current_org_id()))`,
      );
      await c.query("grant select, insert on spike.probe_simple_fk to app_user");
      await c.query("set local role app_user");
      await c.query("select set_config('app.current_org_id', $1, true)", [orgB.orgId]);
      const r = await c.query("insert into spike.probe_simple_fk values ($1, $2, $3)", [
        randomUUID(),
        orgB.orgId,
        orgA.schoolIds[0],
      ]);
      expect(r.rowCount).toBe(1);
    });
  });
});
