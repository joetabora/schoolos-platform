import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { expectSqlState, rolePool } from "./helpers.ts";

const INSUFFICIENT_PRIVILEGE = "42501";

let appUser: pg.Pool;
let appAuth: pg.Pool;
let owner: pg.Pool;

beforeAll(() => {
  appUser = rolePool("app_user");
  appAuth = rolePool("app_auth");
  owner = rolePool("schoolos_owner");
});

afterAll(async () => {
  await Promise.all([appUser.end(), appAuth.end(), owner.end()]);
});

/** Runs statements in a transaction that is always rolled back. */
async function inRolledBackTx(pool: pg.Pool, statements: string[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    for (const statement of statements) {
      await client.query(statement);
    }
  } finally {
    await client.query("rollback").catch(() => undefined);
    client.release();
  }
}

describe("V9 app_user has no privileged attributes", () => {
  it("is not superuser and has no BYPASSRLS, CREATEROLE, CREATEDB, or replication", async () => {
    const { rows } = await appUser.query(
      `select rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication, rolinherit
         from pg_roles where rolname = current_user`,
    );
    expect(rows).toEqual([
      { rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false, rolreplication: false, rolinherit: false },
    ]);
  });

  it("owns no schemas, relations, or functions", async () => {
    const { rows } = await appUser.query<{ n: number }>(
      `select (select count(*) from pg_namespace where nspowner = 'app_user'::regrole)
            + (select count(*) from pg_class where relowner = 'app_user'::regrole)
            + (select count(*) from pg_proc where proowner = 'app_user'::regrole) as n`,
    );
    expect(Number(rows[0]?.n)).toBe(0);
  });

  it("is not a member of any role", async () => {
    const { rows } = await appUser.query<{ n: number }>(
      "select count(*)::int as n from pg_auth_members where member = 'app_user'::regrole",
    );
    expect(rows[0]?.n).toBe(0);
  });

  it("cannot SET ROLE to the owner or the enumerator role", async () => {
    await expectSqlState(inRolledBackTx(appUser, ["set local role schoolos_owner"]), INSUFFICIENT_PRIVILEGE);
    await expectSqlState(inRolledBackTx(appUser, ["set local role app_org_enumerator"]), INSUFFICIENT_PRIVILEGE);
  });

  it("cannot grant itself BYPASSRLS", async () => {
    await expectSqlState(inRolledBackTx(appUser, ["alter role app_user bypassrls"]), INSUFFICIENT_PRIVILEGE);
  });
});

describe("V9 app_user cannot weaken RLS or change the schema", () => {
  const cases: Array<[string, string]> = [
    ["disable RLS", "alter table spike.schools disable row level security"],
    ["remove FORCE RLS", "alter table spike.schools no force row level security"],
    ["drop a policy", "drop policy schools_tenant on spike.schools"],
    ["create a permissive policy", "create policy sneaky on spike.schools for select to app_user using (true)"],
    ["create a table in spike", "create table spike.probe (id int)"],
    ["create a table in app", "create table app.probe (id int)"],
    ["create a table in public", "create table public.probe (id int)"],
    ["create a temp table", "create temp table probe (id int)"],
    ["create a function", "create function app.probe() returns int language sql as 'select 1'"],
    ["take over the definer function", "alter function app.list_organization_ids() owner to app_user"],
    ["read dbmate's schema_migrations", "select * from public.schema_migrations"],
    ["truncate a tenant table", "truncate spike.school_notes"],
    ["update append-only rows", "update spike.org_events set action = 'probe'"],
    ["delete append-only rows", "delete from spike.org_events"],
    ["write organizations", "insert into spike.organizations (id, name, slug) values (gen_random_uuid(), 'x', 'x')"],
  ];

  for (const [name, statement] of cases) {
    it(`cannot ${name}`, async () => {
      await expectSqlState(inRolledBackTx(appUser, [statement]), INSUFFICIENT_PRIVILEGE);
    });
  }

  it("cannot re-grant its privileges (PostgreSQL warns rather than errors; nothing is granted)", async () => {
    const client = await appUser.connect();
    const notices: string[] = [];
    client.on("notice", (notice) => notices.push(notice.message ?? ""));
    try {
      await client.query("begin");
      await client.query("grant select on spike.schools to app_auth");
      const { rows } = await client.query<{ granted: boolean }>(
        "select has_table_privilege('app_auth', 'spike.schools', 'select') as granted",
      );
      expect(rows).toEqual([{ granted: false }]);
      expect(notices).toContain('no privileges were granted for "schools"');
    } finally {
      await client.query("rollback");
      client.release();
    }
  });

  it("row_security = off raises an error instead of bypassing RLS", async () => {
    await expectSqlState(
      inRolledBackTx(appUser, ["set local row_security = off", "select * from spike.schools"]),
      INSUFFICIENT_PRIVILEGE,
    );
  });
});

describe("V9 other roles", () => {
  it("app_auth cannot read tenant tables", async () => {
    await expectSqlState(appAuth.query("select * from spike.schools"), INSUFFICIENT_PRIVILEGE);
  });

  it("app_auth cannot execute the SECURITY DEFINER enumeration function", async () => {
    await expectSqlState(appAuth.query("select * from app.list_organization_ids()"), INSUFFICIENT_PRIVILEGE);
  });

  it("schoolos_owner (CREATEROLE) cannot create SUPERUSER or BYPASSRLS roles", async () => {
    await expectSqlState(inRolledBackTx(owner, ["create role spike_probe_super superuser"]), INSUFFICIENT_PRIVILEGE);
    await expectSqlState(inRolledBackTx(owner, ["create role spike_probe_bypass bypassrls"]), INSUFFICIENT_PRIVILEGE);
    await expectSqlState(inRolledBackTx(owner, ["alter role app_user bypassrls"]), INSUFFICIENT_PRIVILEGE);
  });

  it("schoolos_owner holds only ADMIN (no INHERIT, no SET) on the roles it created", async () => {
    const { rows } = await owner.query(
      `select r.rolname, m.admin_option, m.inherit_option, m.set_option
         from pg_auth_members m join pg_roles r on r.oid = m.roleid
        where m.member = 'schoolos_owner'::regrole order by r.rolname`,
    );
    expect(rows).toEqual([
      { rolname: "app_auth", admin_option: true, inherit_option: false, set_option: false },
      { rolname: "app_org_enumerator", admin_option: true, inherit_option: false, set_option: false },
      { rolname: "app_user", admin_option: true, inherit_option: false, set_option: false },
    ]);
  });
});
