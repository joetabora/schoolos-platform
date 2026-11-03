# Spike report: database tooling (ADR-0014)

- **Status:** Complete. All 12 validation rows passed. ADR-0014 was **Accepted** on 2026-11-02 with the amended transaction-wrapper architecture.
- **Date:** 2026-11-02
- **Branch:** `spike/db-tooling` (throwaway; not merged)
- **Integration (2026-11-02):** Merged into `chore/integrate-db-tooling-spike` as commit `30932d5`. The historical "not merged" line above is the status when this report was written.
- **Decision under test:** [ADR-0014](DECISIONS/0014-database-tooling.md), dbmate + Kysely + node-postgres
- **Plan reference:** [M1_IMPLEMENTATION_PLAN.md](M1_IMPLEMENTATION_PLAN.md) step 0a
- **Code:** [`spikes/db-tooling/`](../spikes/db-tooling/)
- **Data:** synthetic only (`Synthetic Org A`, random UUIDs). No AWS or paid cloud resources were used.

## 1. Consolidated validation matrix

ADR-0014 lists seven spike items (A1–A7). The step 0a brief lists seven checks (B1–B7). They overlap but aren't identical: ADR-0014 adds rollback (A1) and migration transaction semantics (A2); the brief adds schemas and composite foreign keys (B1), strictness (B5), the full pooled-isolation list (B6), and explicit owner/superuser/`BYPASSRLS` behaviour (B7). The matrix keeps every distinct requirement. Every row passed; ADR-0014 was Accepted.

| ID | Requirement | Sources | Pass criterion | Fail criterion |
| --- | --- | --- | --- | --- |
| V1 | dbmate applies migrations containing roles, schemas, RLS policies, `FORCE ROW LEVEL SECURITY`, `SECURITY DEFINER` functions, triggers, composite tenant FKs | A1, B1 | `dbmate migrate` as non-superuser `schoolos_owner` exits 0 and catalog queries confirm each object with the intended attributes | Any migration fails, or any object is missing or has different attributes |
| V2 | dbmate rolls back every migration and re-applies cleanly | A1 | Rolling back one at a time reaches zero applied versions, catalog shows no spike objects or roles, and re-applying succeeds | Any rollback fails or leaves objects behind |
| V3 | dbmate migration-transaction behaviour is understood and documented | A2 | Observed: (a) a migration that fails part-way leaves no objects (including roles) and no version row; (b) `CREATE INDEX CONCURRENTLY` fails in a default migration and succeeds with `transaction:false` | Observed behaviour differs from the documented behaviour, or partial state is left behind |
| V4 | Reproducible installation from the committed lockfile at pinned versions, in CI-like containers | A3, B2 | `pnpm install --frozen-lockfile` succeeds in clean `linux/arm64` and `linux/amd64` containers built from a digest-pinned Node.js 26.13.0 image; `dbmate --version` reports 2.37.0; lockfile unchanged | Install fails, resolves different versions, or modifies the lockfile |
| V5 | Kysely runs every query of a tenant transaction on one `pg` connection, with transaction-local tenant context visible to RLS | A4, B3 | Inside the wrapper every statement reports the same backend PID and transaction ID; builder queries on RLS tables return only the tenant's rows; nested transactions, use after completion, and handler errors are rejected or rolled back | Any statement runs on another connection or outside the transaction, or a guard doesn't hold |
| V6 | Raw SQL (`sql` template) runs advisory locks and `set_config(..., true)` on the same transaction connection | A5, B4 | `pg_advisory_xact_lock` is held by the transaction's backend and released at commit; a second connection can't take it meanwhile; values set with `set_config(..., true)` are visible to later builder queries and gone after commit; locked sequence allocation under concurrency produces no duplicates | Lock taken on another connection, not released, or setting persists past the transaction |
| V7 | Typed schema kept in sync with the database by a CI check, without weakening TypeScript strictness | A6, B5 | Types generated from the database by `kysely-codegen`; `--verify` passes when in sync and **fails** after a schema change; `tsc` passes with `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`; type-level negative tests fail to compile as expected; no `any` or unsafe casts | Drift not detected, strict flags must be relaxed, or `any`/casts are needed |
| V8 | Two-tenant isolation on one shared `pg.Pool` | A7, B6 | All of V8.1–V8.8 pass | Any cross-tenant read or write, or any leaked context |
| V8.1 | Org A sees only A's rows | B6 | Every tenant table returns only A's rows under A's context | Any B row visible |
| V8.2 | Org B sees only B's rows | B6 | Same for B | Any A row visible |
| V8.3 | No tenant context is denied | B6 | Without context: `SELECT` returns 0 rows, `INSERT` fails RLS `WITH CHECK`, `UPDATE`/`DELETE` affect 0 rows; an empty value is treated as no context; a malformed value raises an error | Any row visible or written |
| V8.4 | Cross-tenant writes are rejected | B6 | Under B's context: inserting with A's `organization_id` fails; updating/deleting A's rows affects 0 rows and A's rows are unchanged | Any A row modified |
| V8.5 | Rollback doesn't leak context | B6 | After `ROLLBACK` (and `ROLLBACK TO SAVEPOINT`) on the same connection, the setting is empty; the next borrower of the connection sees no context | Setting survives rollback |
| V8.6 | Connection reuse doesn't retain the previous tenant's context | B6 | With `max: 1`, the same backend PID serves A, then B, then no-context, and each sees only its own rows (or none) | Any later transaction sees an earlier tenant's context |
| V8.7 | Concurrent requests can't cross tenant boundaries | A7, B6 | A deterministic interleaving and 400 randomized concurrent transactions for two orgs: zero cross-reads or cross-writes; multiple backends used; backends reused across both orgs; all idle connections have no context afterwards | Any cross-read or leaked context |
| V8.8 | The isolation tests can detect a leak (negative control) | B6 (test quality) | A deliberately wrong session-level `set_config(..., false)` is detected as a leak by the same assertions | Leak not detected (tests too weak) |
| V9 | Application-role privileges are least-privilege | B7 | `app_user` is not superuser, has no `BYPASSRLS`/`CREATEROLE`/`CREATEDB`, owns nothing, can't `SET ROLE` to privileged roles, can't alter/disable RLS or drop policies, can't create objects (including temp tables), can't read `schema_migrations`; `row_security = off` raises an error instead of bypassing; `schoolos_owner` can't create `SUPERUSER` or `BYPASSRLS` roles | Any privileged capability present |
| V10 | RLS, `FORCE RLS`, and bypass behaviour are as intended | B7 | Every table in the tenant schema has RLS enabled and forced with at least one policy; the table owner gets 0 rows under `FORCE`; controls show that an `ENABLE`-only table, a superuser, and a `BYPASSRLS` role all bypass RLS (which is why `app_user` must never have them) | A non-bypass role sees rows it shouldn't, or `FORCE` doesn't apply to the owner |
| V11 | `SECURITY DEFINER` functions behave as intended | B7 | `app.list_organization_ids()` returns only IDs of all orgs to `app_user` without tenant context; owner is a `NOLOGIN` role without `BYPASSRLS`; `search_path` pinned; `EXECUTE` revoked from `PUBLIC` (another role is denied); control shows that a definer owned by the `FORCE`-RLS table owner returns nothing | Function leaks more than IDs, is callable by other roles, or has an unpinned `search_path` |
| V12 | Triggers and composite FKs behave as intended | B1, B7 | `updated_at` trigger works under RLS as `app_user`; append-only trigger blocks `UPDATE` even for the owner; `app_user` has no `UPDATE`/`DELETE` privilege on append-only rows; composite FK rejects a cross-tenant parent reference; control shows that a single-column FK would accept it | Any of these behaves differently |

Note on V12: under `FORCE` RLS with policies scoped `TO app_user`, the table owner's `UPDATE` matches no rows, so the trigger never fires for it. The append-only trigger was therefore exercised as the superuser (which bypasses RLS) to prove it blocks even the most privileged role.

## 2. Environment and exact versions

| Component | Version / reference |
| --- | --- |
| Host | macOS 27.0 (26A5425a), Apple silicon `arm64` |
| Container engine | Colima 0.10.3 (lima 2.2.1, macOS Virtualization.Framework); Docker client 28.3.2, Docker Engine 29.5.2 (`linux/arm64`). Docker Desktop 4.43.2 failed to start on this host and was not used (§5). |
| PostgreSQL | `postgres:18.6@sha256:3a4264520e121176619f54ff867d12774bc81e95e7b84db58d63bccdb6144b81` (index digest); server reports `PostgreSQL 18.6 (Debian 18.6-1.pgdg13+2) on aarch64-unknown-linux-gnu`; `PGDATA=/var/lib/postgresql/18/docker` on tmpfs |
| Install-check image | `node:26.13.0-trixie-slim@sha256:e4db4c914bf8ad241bd24804fc25d272d89bad97e68cdc8a1414862790a02c39` (index digest), built for `linux/arm64` and `linux/amd64` |
| Node.js | 26.13.0 ("Lithium" LTS), pinned in `.nvmrc` and `engines` |
| pnpm | 12.16.1, pinned in `packageManager` and `engines`; `engine-strict=true`; `minimumReleaseAge: 10080` (7 days) |
| dbmate | 2.37.0 (npm package with per-platform binaries, e.g. `@dbmate/darwin-arm64`, `@dbmate/linux-x64`) |
| Kysely | 0.29.7 |
| node-postgres (`pg`) | 8.23.1 |
| kysely-codegen | 0.20.0 |
| TypeScript | 7.0.2 |
| vitest / vite | 5.0.5 / 8.3.5 |
| `@types/node` / `@types/pg` | 26.6.5 / 8.23.1 |

All direct dependencies are exact versions in `package.json`; the full graph is in the committed `pnpm-lock.yaml`. Two newer releases were deliberately not used because they were less than 7 days old: kysely 0.29.8 (2026-11-01) and vitest 5.1.0 (2026-11-02). With the release-age policy on, pnpm also refuses a lockfile that contains too-new entries (observed), which guards against a lockfile committed with the policy bypassed.

## 3. How to reproduce

```sh
git switch spike/db-tooling
cd spikes/db-tooling
nvm use                         # Node.js 26.13.0
npm install --global pnpm@12.16.1
pnpm install --frozen-lockfile
pnpm spike                      # fresh DB, strict typecheck, drift check, tests, arm64+amd64 install builds
```

`pnpm spike` runs `scripts/run-spike.sh`: destroy and recreate the container, run `bootstrap/bootstrap.sql` as the superuser, `dbmate migrate` as `schoolos_owner`, `tsc --noEmit`, `kysely-codegen --verify`, `vitest run`, and `scripts/install-check.sh`. `SKIP_INSTALL_CHECK=1` skips the container builds. Clean up with `docker compose down --volumes`.

### Role layout used

| Role | Created by | Attributes | Purpose in spike |
| --- | --- | --- | --- |
| `postgres` | image | superuser | Bootstrap and test fixtures only; demonstrates bypass |
| `schoolos_owner` | bootstrap | `LOGIN CREATEROLE`, no `SUPERUSER`/`BYPASSRLS`/`CREATEDB`; owns the database and all objects | Runs dbmate and kysely-codegen |
| `app_user` | migration | `LOGIN NOINHERIT`, nothing else; owns nothing | Runtime tenant queries |
| `app_auth` | migration | `LOGIN NOINHERIT` | Stand-in for another runtime role; no tenant access |
| `app_org_enumerator` | migration | `NOLOGIN`; `SELECT (id)` on organizations only | Owns the `SECURITY DEFINER` function |

Login passwords are set out-of-band (bootstrap and test setup), never in migrations. Database-level `CONNECT` and `TEMP` are revoked from `PUBLIC`; `public` schema access is revoked from `PUBLIC`.

## 4. Results

Final clean-state run after acceptance: `scripts/run-spike.sh` exit 0. 7 test files, **107 tests passed, 0 failed, 0 skipped**. Two tests were added for the accepted wrapper (handle reuse across tenants; swallowed errors in a no-context transaction). The original 105 still pass. The suite also passed twice more with shuffled file order (seeds 11 and 2026) without a reset, so results don't depend on test order.

| ID | Result | Evidence (test file) |
| --- | --- | --- |
| V1 | **Pass** | `01-migrations`: catalog shows the 3 roles with exact attributes, `app`/`spike` schemas owned by `schoolos_owner`, 4 tables with RLS enabled and forced and the expected policy counts, definer function owned by `app_org_enumerator` with `search_path=pg_catalog, pg_temp`, both triggers enabled, composite FK `(organization_id, school_id) → schools(organization_id, id)`, 4 versions recorded. All applied by the non-superuser `schoolos_owner`. |
| V2 | **Pass** | `01-migrations`: four `rollback`s in reverse order, `Applied: 0`, no roles/schemas/versions left, re-apply succeeds and catalog matches again. |
| V3 | **Pass** | `01-migrations` with probes in `tests/fixtures/txprobe/`: default migrations are atomic, including `CREATE ROLE` (role, table, and version row all absent after `division by zero`). `CREATE INDEX CONCURRENTLY` fails with `25001` in a default migration and succeeds alone with `transaction:false`. A `transaction:false` file with several statements still ran as one implicit transaction (no partial state), so `CREATE INDEX CONCURRENTLY` must be the only statement in its file (otherwise `25001`). |
| V4 | **Pass** | `scripts/install-check.sh`: `pnpm install --frozen-lockfile` in clean `linux/arm64` and `linux/amd64` containers; lockfile byte-identical afterwards (`cmp`); dbmate 2.37.0, TypeScript 7.0.2, kysely 0.29.7, pg 8.23.1, kysely-codegen 0.20.0, vitest 5.0.5, Node v26.13.0; strict `tsc` also passed inside both containers. |
| V5 | **Pass** | `04-kysely-transactions`: one backend PID and one `pg_current_xact_id()` across mixed raw/builder statements; builder queries return only the tenant's rows; nested `transaction()` rejected at compile time and runtime; a handle used after commit/rollback throws and cannot read another tenant after reuse; swallowed database errors fail with `TransactionAbortedError` and roll back earlier writes; malformed IDs refused before any query. |
| V6 | **Pass** | `04-kysely-transactions`, `06-concurrency`: advisory lock held only by the transaction's backend (in `pg_locks`), another session's `pg_try_advisory_xact_lock` returns false until commit; raw `set_config(..., true)` changes what builder queries see in the same transaction and is gone afterwards; 40 concurrent locked appends get contiguous unique `seq`; control without the lock produces `23505` collisions. |
| V7 | **Pass** | `07-type-sync`: `kysely-codegen --verify` passes in sync, **fails** (mentioning `drift_probe`) after `ALTER TABLE ... ADD COLUMN`, passes after revert; generated file has no `any`; sources contain no `any`, `as unknown as`, `@ts-ignore`; strict flags asserted; `tsc` passes including `tests/types/kysely-types.typecheck.ts`, whose 7 `@ts-expect-error` lines must stay errors (TS 7.0.2 enforces unused directives, TS2578, confirmed with a probe). |
| V8.1 / V8.2 | **Pass** | `05-tenant-isolation`: under each org's context, each of the 4 tables returns exactly that org's rows (8 tests). |
| V8.3 | **Pass** | `05-tenant-isolation`: no context returns 0 rows on all 4 tables, inside and outside explicit transactions; `INSERT` fails `42501`; `UPDATE`/`DELETE` affect 0 rows; `''` acts as no context; `'not-a-uuid'` raises `22P02`. |
| V8.4 | **Pass** | `05-tenant-isolation`: B inserting with A's `organization_id` fails `42501`; B moving its own row to A fails `42501` (`WITH CHECK` on update); B's update/delete of A's IDs affect 0 rows and A's rows are byte-identical afterwards (verified as superuser). |
| V8.5 | **Pass** | `05-tenant-isolation`: setting empty after `ROLLBACK`, after a failed statement + `ROLLBACK`, and after `ROLLBACK TO SAVEPOINT`; after a handler error and after an RLS violation, the next borrower of the same connection (same PID) has no context and sees 0 rows. |
| V8.6 | **Pass** | `05-tenant-isolation`: one PID served A → B → none → A; each saw only its own rows (none for no-context). |
| V8.7 | **Pass** | `06-concurrency`: lock-step interleaving of A and B on two backends (open, read, write, re-read) with zero cross-visibility; 400 concurrent transactions on a pool of 8 (10% throw after writing, 5% attempt a cross-tenant insert) with zero violations, multiple backends used, backends shared by both orgs, exactly the committed rows persisted with the right org, and every idle connection afterwards has an empty setting and sees 0 rows. |
| V8.8 | **Pass** | `05-tenant-isolation`: deliberately wrong `set_config(..., false)` and session-level `SET` both leak to the next borrower of the same backend, and the same row-count assertion detects all 7 leaked rows. The isolation assertions can fail. |
| V9 | **Pass** | `02-role-privileges` (26 tests): `app_user` has no privileged attributes, owns nothing, belongs to no role; `SET ROLE` to owner/enumerator, granting itself `BYPASSRLS`, disabling RLS, removing `FORCE`, dropping or creating policies, creating tables (in `spike`, `app`, `public`, temp), creating functions, taking ownership of the definer, reading `schema_migrations`, `TRUNCATE`, `UPDATE`/`DELETE` of append-only rows, and writing organizations all fail `42501`; `row_security = off` raises `42501`; re-granting yields no privilege; `app_auth` can't read tenant tables or execute the definer; `schoolos_owner` can't create `SUPERUSER`/`BYPASSRLS` roles or grant `BYPASSRLS`, and holds only `ADMIN` (no `INHERIT`, no `SET`) on the roles it created. |
| V10 | **Pass** | `03-rls-definer-triggers`: catalog-wide coverage check (no table in `app`/`spike` lacks enabled+forced RLS and a policy); owner sees 0 rows with and without context; controls: owner sees 2 rows on an `ENABLE`-only table and 0 once `FORCE` is added; superuser sees all 4 fixture schools; a `BYPASSRLS` role sees all 4 while the same role without it sees 0. |
| V11 | **Pass** | `03-rls-definer-triggers`: `app_user` gets both org IDs from `app.list_organization_ids()` while a direct read returns 0 rows; signature `SETOF uuid`; owner can read `id` but `name` fails `42501`; owner `NOLOGIN`, no `BYPASSRLS`; no `PUBLIC` `EXECUTE`; control: the same definer owned by the table owner returns 0 rows. |
| V12 | **Pass** | `03-rls-definer-triggers`: `updated_at` advances under RLS as `app_user`; append-only trigger rejects superuser `UPDATE` with `table spike.org_events is append-only`; `app_user` `UPDATE`/`DELETE` rejected by privilege; composite FK accepts a same-tenant parent and rejects org B → org A's school with `23503`; control: a single-column FK accepted the same cross-tenant reference. |

### Recorded hazards (tests that document unsafe patterns, all passing as expected)

| Test | What it shows | Consequence for M1 |
| --- | --- | --- |
| Per-transaction Kysely over a raw `pg` client (ADR-0014's wording) | Meets item 4 as written, but a nested `db.transaction()` issues `BEGIN`/`COMMIT` on the same client, **commits the outer transaction early and drops the tenant context**; and a handle kept after completion **read org B's rows** once the pooled client was reused for B | Don't build the wrapper this way; use Kysely's own `Transaction` (see §7) |
| Swallowed database error inside `withTenant` | PostgreSQL turns `COMMIT` of an aborted transaction into a silent `ROLLBACK`. The wrapper now probes after the handler returns and fails with `TransactionAbortedError` (SQLSTATE `25P02`) so the request cannot succeed | Required by the accepted ADR; tests in `04-kysely-transactions.test.ts` |
| Raw `set_config` inside a tenant transaction | Any code with SQL access inside the transaction can switch the tenant context | Only `src/platform/db` may set `app.*` settings (lint + review); RLS protects against missing filters, not against arbitrary SQL execution |

## 5. Failures encountered and how they were resolved

| # | Failure | Resolution | Weakened anything? |
| --- | --- | --- | --- |
| 1 | Docker Desktop 4.43.2 wouldn't start on macOS 27.0 (`com.docker.backend: unmarshaling start request: unexpected EOF`, failing since 2026-09-08) | Owner approved Colima 0.10.3 as the Docker engine. Docker Desktop was quit, not uninstalled or modified. | No |
| 2 | pnpm 12's default release-age policy auto-excluded vitest 5.1.0 (published hours earlier) | Set `minimumReleaseAge: 10080` explicitly with no exclusions; pinned vitest 5.0.5, kysely 0.29.7, `@types/node` 26.6.5; rebuilt the lockfile with `pnpm clean --lockfile` | No (stricter) |
| 3 | Migration 4 failed: `permission denied for function list_organization_ids (42501)`. After `ALTER FUNCTION ... OWNER TO app_org_enumerator`, `schoolos_owner` can no longer grant `EXECUTE`. dbmate rolled the migration back completely. | Grant `EXECUTE` before the ownership transfer (ACL entries survive the transfer) | No |
| 4 | Test expected `GRANT` without grant option to raise an error; PostgreSQL only warns (`no privileges were granted`) | Test now asserts the security effect: `has_table_privilege('app_auth', ...)` is false and the warning is emitted | No (the test was wrong, not the privilege model) |
| 5 | `tsc` rejected calls to `tx.transaction()`, `tx.startTransaction()`, `tx.connection()` inside the wrapper (typed `never`) | Marked with `@ts-expect-error`, so the test now asserts both the compile-time and runtime guard | No (stronger) |
| 6 | Two `as { code?: unknown }` casts in test code | Replaced with a `sqlState()` type guard | No |

No test was skipped, relaxed, or marked passed without running.

## 6. Remaining risks and limitations

1. **Not tested on RDS (T-21).** RDS's master user is `rds_superuser`, not a true superuser; whether it (or other RDS-managed roles) bypasses RLS is **[Unknown]**. The plan already requires TST-3 against `pg.Pool` → RDS in staging (ADR-0013); add the V9/V10 role checks there. Do not treat Docker superuser results as RDS validation.
2. **TLS not exercised (T-22).** The spike used `sslmode=disable` on localhost. RDS requires TLS; dbmate and `pg` TLS settings must be verified in step 10.
3. **Roles are cluster-wide (T-24).** Migrations that create roles fail if two databases in the same cluster both run them (e.g. per-worker test databases in CI). Use one database per cluster in CI, or move role creation to a bootstrap step if parallel databases are needed.
4. **`schoolos_owner` needs `CREATEROLE`** for role migrations. On PostgreSQL 16+ it gets only `ADMIN` on roles it creates and can't grant `SUPERUSER`/`BYPASSRLS` (verified), but it remains a powerful role: it must not be used at runtime and its credentials belong only to the migration task.
5. **Ownership transfer pattern is fiddly.** Moving a `SECURITY DEFINER` function to a `NOLOGIN` owner needed a temporary `SET` membership, temporary `CREATE` on the schema, `EXECUTE` granted beforehand, and a temporary `INHERIT` membership for the down migration. Document it in `db/README.md` in step 2.
6. **Rollback-failure path untested (T-23).** If `ROLLBACK` itself failed without the connection dying, Kysely would release the connection back to the pool. This could not be induced. Option for M1: release the client as broken on any wrapper error, or assert an empty context at transaction start.
7. **Kysely's control connection.** For query cancellation via abort signals, Kysely can open a separate connection with the pool's credentials (`controlClient`, read from source; not exercised). It runs only `pg_cancel_backend`/`pg_terminate_backend`. Don't pass abort signals into tenant transactions without review.
8. **Status columns type as `string`.** `text` + `check` (DB-8) generates `string`, not a literal union. Use kysely-codegen `--overrides` or a typed constant set in step 2.
9. **Types are generated as the owner.** Codegen must introspect as `schoolos_owner` (column visibility follows privileges). CI needs a migrated database to run `--verify`.
10. **No schema dump.** dbmate's `schema.sql` dump needs a local `pg_dump` 18, which isn't installed; the spike used `--no-dump-schema`. Decide in step 2 whether to commit a dump (generated via the container).
11. **Concurrent migration runs.** dbmate 2.37.0 offers `--migration-lock` (PostgreSQL session advisory lock, needs a direct connection). Enable it in the pipeline migration task.
12. **UUIDs.** Fixtures used v4 (`crypto.randomUUID`). The UUIDv7 library (T-19) is still open.
13. **Scale and performance.** 400 transactions on a pool of 8 is a correctness test, not load. `EXPLAIN` checks of the `(select app.current_org_id())` predicate remain step 9 work.
14. **Fresh toolchain.** TypeScript 7 and pnpm 12 are recent majors. Both worked here; watch for ecosystem gaps in step 1 (ESLint and Next.js integration weren't part of this spike).
15. **Local placeholder passwords** are committed in the spike for the disposable container. They protect nothing, are labelled local-only, and must not be reused.

## 7. Recommendation

**Accepted 2026-11-02** with the amended wrapper. All 12 validation rows pass, including the negative controls.

Accepted wording:

> `src/platform/db` holds the only `pg.Pool` and the only `Kysely` instance. `withTenant`/`withUser`/`withSystem` open a Kysely-managed transaction (`db.transaction().execute`), set context with `set_config(..., true)` as the first statement, and pass handlers only the `Transaction` object. Handlers never receive the pool, the root `Kysely` instance, or a raw `pg` client. Nested transactions and post-completion handle use are rejected. If a database operation fails, the wrapper fails the request even if the handler caught the original exception. Tenant context is transaction-local; missing context denies access.

The spike wrapper implements the aborted-transaction probe. Handle-lifetime and swallowed-error tests live in `tests/04-kysely-transactions.test.ts`.

Remaining unvalidated environmental risks (do not treat as proven): AWS RDS role/RLS behaviour, production TLS, failed-rollback dirty pooled connections, cluster-wide role migration collisions in CI. Tracked as T-21–T-24.
