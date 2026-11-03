import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { TXPROBE_DB } from "../src/config.ts";
import { provisionLocalPasswords, rolePool, runScript } from "./helpers.ts";

const MIGRATION_VERSIONS = ["20261103000001", "20261103000002", "20261103000003", "20261103000004"];

let superuser: pg.Pool;

beforeAll(() => {
  superuser = rolePool("postgres");
});

afterAll(async () => {
  await superuser.end();
});

async function scalar<T>(pool: pg.Pool, text: string, values: unknown[] = []): Promise<T> {
  const { rows } = await pool.query<{ v: T }>(text, values);
  const row = rows[0];
  if (row === undefined) throw new Error(`no row for: ${text}`);
  return row.v;
}

/** Catalog assertions for every object kind the migrations create (V1). */
async function assertMigratedCatalog(pool: pg.Pool): Promise<void> {
  const { rows: roles } = await pool.query<{
    rolname: string;
    rolsuper: boolean;
    rolbypassrls: boolean;
    rolcreaterole: boolean;
    rolcreatedb: boolean;
    rolcanlogin: boolean;
  }>(
    `select rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolcanlogin
       from pg_roles where rolname in ('app_user', 'app_auth', 'app_org_enumerator') order by rolname`,
  );
  expect(roles).toEqual([
    { rolname: "app_auth", rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false, rolcanlogin: true },
    { rolname: "app_org_enumerator", rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false, rolcanlogin: false },
    { rolname: "app_user", rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false, rolcanlogin: true },
  ]);

  const { rows: schemas } = await pool.query<{ nspname: string; owner: string }>(
    `select nspname, pg_get_userbyid(nspowner) as owner from pg_namespace
      where nspname in ('app', 'spike') order by nspname`,
  );
  expect(schemas).toEqual([
    { nspname: "app", owner: "schoolos_owner" },
    { nspname: "spike", owner: "schoolos_owner" },
  ]);

  const { rows: tables } = await pool.query<{ relname: string; owner: string; rls: boolean; forced: boolean; policies: number }>(
    `select c.relname, pg_get_userbyid(c.relowner) as owner, c.relrowsecurity as rls,
            c.relforcerowsecurity as forced,
            (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'spike' and c.relkind = 'r' order by c.relname`,
  );
  expect(tables).toEqual([
    { relname: "org_events", owner: "schoolos_owner", rls: true, forced: true, policies: 2 },
    { relname: "organizations", owner: "schoolos_owner", rls: true, forced: true, policies: 2 },
    { relname: "school_notes", owner: "schoolos_owner", rls: true, forced: true, policies: 1 },
    { relname: "schools", owner: "schoolos_owner", rls: true, forced: true, policies: 1 },
  ]);

  const definer = await pool.query<{ owner: string; prosecdef: boolean; proconfig: string[] | null; provolatile: string }>(
    `select pg_get_userbyid(proowner) as owner, prosecdef, proconfig, provolatile
       from pg_proc where oid = 'app.list_organization_ids()'::regprocedure`,
  );
  expect(definer.rows).toEqual([
    { owner: "app_org_enumerator", prosecdef: true, proconfig: ["search_path=pg_catalog, pg_temp"], provolatile: "s" },
  ]);

  const { rows: triggers } = await pool.query<{ tgname: string; table: string; fn: string; enabled: string }>(
    `select t.tgname, t.tgrelid::regclass::text as table, t.tgfoid::regproc::text as fn, t.tgenabled as enabled
       from pg_trigger t where not t.tgisinternal and t.tgrelid::regclass::text like 'spike.%' order by t.tgname`,
  );
  expect(triggers).toEqual([
    { tgname: "org_events_append_only", table: "spike.org_events", fn: "app.reject_update", enabled: "O" },
    { tgname: "schools_set_updated_at", table: "spike.schools", fn: "app.set_updated_at", enabled: "O" },
  ]);

  const fk = await pool.query<{ child_cols: string[]; parent: string; parent_cols: string[] }>(
    `select array(select a.attname::text from unnest(c.conkey) with ordinality k(n, o)
                   join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.n order by k.o) as child_cols,
            c.confrelid::regclass::text as parent,
            array(select a.attname::text from unnest(c.confkey) with ordinality k(n, o)
                   join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.n order by k.o) as parent_cols
       from pg_constraint c where c.conname = 'school_notes_school_fk'`,
  );
  expect(fk.rows).toEqual([
    { child_cols: ["organization_id", "school_id"], parent: "spike.schools", parent_cols: ["organization_id", "id"] },
  ]);

  const versions = await pool.query<{ version: string }>("select version from public.schema_migrations order by version");
  expect(versions.rows.map((r) => r.version)).toEqual(MIGRATION_VERSIONS);
}

describe("V1 dbmate applies roles, schemas, RLS, FORCE RLS, SECURITY DEFINER, triggers, composite FKs", () => {
  it("migrated catalog contains every object with the intended attributes", async () => {
    await assertMigratedCatalog(superuser);
  });

  it("migrations ran as the non-superuser schoolos_owner", async () => {
    const owner = await superuser.query<{ rolsuper: boolean; rolbypassrls: boolean; rolcreaterole: boolean; rolcreatedb: boolean }>(
      "select rolsuper, rolbypassrls, rolcreaterole, rolcreatedb from pg_roles where rolname = 'schoolos_owner'",
    );
    expect(owner.rows).toEqual([{ rolsuper: false, rolbypassrls: false, rolcreaterole: true, rolcreatedb: false }]);
  });

  it("status reports every migration applied", () => {
    const status = runScript("scripts/dbmate.sh", ["status"]);
    expect(status.status).toBe(0);
    expect(status.stdout).toContain("Applied: 4");
    expect(status.stdout).toContain("Pending: 0");
  });
});

describe("V2 dbmate rolls back every migration and re-applies", () => {
  it("rolls back one at a time to zero, leaves no objects or roles, then re-applies", async () => {
    for (const version of [...MIGRATION_VERSIONS].reverse()) {
      const result = runScript("scripts/dbmate.sh", ["rollback"]);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain(`Rolled back: ${version}`);
    }

    const status = runScript("scripts/dbmate.sh", ["status"]);
    expect(status.stdout).toContain("Applied: 0");

    expect(await scalar<number>(superuser, "select count(*)::int as v from public.schema_migrations")).toBe(0);
    expect(
      await scalar<number>(
        superuser,
        "select count(*)::int as v from pg_roles where rolname in ('app_user', 'app_auth', 'app_org_enumerator')",
      ),
    ).toBe(0);
    expect(
      await scalar<number>(superuser, "select count(*)::int as v from pg_namespace where nspname in ('app', 'spike')"),
    ).toBe(0);

    const reapply = runScript("scripts/dbmate.sh", ["migrate"]);
    expect(reapply.status, reapply.stderr).toBe(0);
    await provisionLocalPasswords(superuser);
    await assertMigratedCatalog(superuser);
  });
});

describe("V3 dbmate migration-transaction behaviour", () => {
  async function freshProbeDatabase(): Promise<void> {
    await superuser.query(`drop database if exists ${TXPROBE_DB}`);
    await superuser.query(`create database ${TXPROBE_DB} owner schoolos_owner`);
    await superuser.query(`revoke all on database ${TXPROBE_DB} from public`);
  }

  async function probeState(): Promise<{ relations: string[]; versions: string[]; probeRole: number }> {
    const probe = rolePool("postgres", { database: TXPROBE_DB, max: 1 });
    try {
      const relations = await probe.query<{ relname: string }>(
        "select relname from pg_class where relname like 'probe%' order by relname",
      );
      const versions = await probe.query<{ version: string }>("select version from public.schema_migrations order by version");
      const role = await probe.query<{ n: number }>("select count(*)::int as n from pg_roles where rolname = 'spike_txprobe_role'");
      return {
        relations: relations.rows.map((r) => r.relname),
        versions: versions.rows.map((r) => r.version),
        probeRole: role.rows[0]?.n ?? -1,
      };
    } finally {
      await probe.end();
    }
  }

  function migrateProbe(fixture: string) {
    return runScript("scripts/dbmate.sh", ["migrate"], {
      SPIKE_DB: TXPROBE_DB,
      SPIKE_MIGRATIONS_DIR: `tests/fixtures/txprobe/${fixture}`,
    });
  }

  it("a failing migration is atomic: no table, no role, no version row", async () => {
    await freshProbeDatabase();
    const result = migrateProbe("partial-failure");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("division by zero (22012)");
    expect(await probeState()).toEqual({ relations: [], versions: [], probeRole: 0 });
  });

  it("CREATE INDEX CONCURRENTLY fails in a default (transactional) migration", async () => {
    await freshProbeDatabase();
    const result = migrateProbe("cic-default");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("cannot run inside a transaction block (25001)");
    expect(await probeState()).toEqual({ relations: ["probe_cic"], versions: ["20260101000001"], probeRole: 0 });
  });

  it("CREATE INDEX CONCURRENTLY succeeds alone in a transaction:false migration", async () => {
    await freshProbeDatabase();
    const result = migrateProbe("cic-no-transaction");
    expect(result.status, result.stderr).toBe(0);
    expect(await probeState()).toEqual({
      relations: ["probe_cic", "probe_cic_idx"],
      versions: ["20260101000001", "20260101000002"],
      probeRole: 0,
    });
  });

  it("transaction:false with several statements still runs as one implicit transaction", async () => {
    await freshProbeDatabase();
    const result = migrateProbe("no-transaction-multi");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("division by zero (22012)");
    expect(await probeState()).toEqual({ relations: ["probe_cic"], versions: ["20260101000001"], probeRole: 0 });
  });

  it("so CREATE INDEX CONCURRENTLY must be the only statement in a transaction:false migration", async () => {
    await freshProbeDatabase();
    const result = migrateProbe("no-transaction-cic-multi");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("cannot run inside a transaction block (25001)");
    expect(await probeState()).toEqual({ relations: ["probe_cic"], versions: ["20260101000001"], probeRole: 0 });
  });
});
