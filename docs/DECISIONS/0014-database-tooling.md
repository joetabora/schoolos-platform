# ADR-0014: Database tooling — dbmate, Kysely, node-postgres

- **Status:** Proposed. Spike completed 2026-11-02 and all checks passed ([report](../SPIKE_DB_TOOLING_REPORT.md)); acceptance, with the rule amendment proposed below, is pending owner review.
- **Date:** 2026-11-02
- **Deciders:** Founding engineering team
- **Related:** ADR-0003, ADR-0013; ARCHITECTURE_READINESS_REVIEW D-4; OPEN_QUESTIONS T-13

## Context

We need plain, reviewable SQL migrations (RLS policies, functions, triggers, grants), typed queries in TypeScript, and strict control over connections and transactions so tenant context can't be bypassed.

## Decision (proposed)

| Concern | Tool | Role |
| --- | --- | --- |
| Migrations | **dbmate** | Ordered plain `.sql` migration files with up/down sections, run by CI/CD as the `schoolos_owner` role |
| Typed queries | **Kysely** | Typed query builder for application CRUD |
| Driver, pool, transactions | **node-postgres (`pg`)** | The only connection and transaction layer (ADR-0013) |

Rules (these hold whatever the spike outcome):
- **Direct SQL** is used for RLS policies, grants, functions, triggers, advisory locks, audit chain operations, and anything security-sensitive. These live in migrations or in reviewed SQL in `src/platform/db` and `src/platform/audit`, not hidden behind a builder.
- **Every tenant query runs inside the explicit tenant transaction wrapper** (`withTenant`, `withUser`, `withSystem`). Kysely instances are only constructed inside those wrappers, bound to the transaction's single `pg` client.
- **Transaction-local settings only** (`SET LOCAL` / `set_config(name, value, true)`). Session-level `SET` is banned by lint and review.
- **Application modules never create database connections.** Only `src/platform/db` imports `pg` or creates Kysely instances (enforced by lint import rules).
- No ORM that manages schema, migrations, or RLS implicitly.

## Compatibility spike (time-boxed: 2 working days)

Run in a throwaway branch against Docker `postgres:18.6`. Every item must pass for this ADR to be Accepted:

1. dbmate applies and rolls back migrations on PostgreSQL 18, including `CREATE ROLE`, `CREATE POLICY`, `ALTER TABLE ... FORCE ROW LEVEL SECURITY`, `SECURITY DEFINER` functions, and triggers.
2. dbmate's migration-transaction behaviour is understood and documented (which statements must run outside a transaction, if any).
3. dbmate can be installed reproducibly in CI and the container build at a pinned version (installation method recorded).
4. A Kysely instance bound to one `pg` client inside `BEGIN … SET LOCAL … COMMIT` runs all queries on that client, so RLS sees the tenant settings (verified by an RLS-protected table returning only the tenant's rows).
5. Kysely raw `sql` fragments work for advisory locks (`pg_advisory_xact_lock`) and `set_config(..., true)`.
6. A typed-schema approach for Kysely is chosen (generated from the database or hand-maintained) and kept in sync by a CI check.
7. Concurrency check: interleaved transactions for two tenants on one `pg.Pool` never cross-read (an early version of review TST-3).

If any item fails, record the failure here and propose an alternative in a superseding ADR before M1 step 2.

## Alternatives considered

| Option | Pros | Cons |
| --- | --- | --- |
| Prisma / Drizzle migrations | Integrated | Schema-DSL-first; RLS, grants, and functions are second-class or hidden |
| Raw `pg` only | Maximum control | No compile-time query typing |
| node-pg-migrate / graphile-migrate | JS-native | dbmate's plain SQL files are easiest to review for security |

## Consequences

- Two tools to learn (dbmate, Kysely), both thin.
- Database types must be kept in sync with migrations (spike item 6).

## Verification

Spike results are recorded in this ADR, which then moves to Accepted or is superseded.

### Spike results (2026-11-02, branch `spike/db-tooling`)

Full evidence, versions, and reproduction steps: [`SPIKE_DB_TOOLING_REPORT.md`](../SPIKE_DB_TOOLING_REPORT.md). Environment: Docker `postgres:18.6` (digest-pinned), Node.js 26.13.0, pnpm 12.16.1, dbmate 2.37.0, Kysely 0.29.7, `pg` 8.23.1, kysely-codegen 0.20.0, TypeScript 7.0.2. 105 tests passed from a clean state.

| Item | Result | Summary |
| --- | --- | --- |
| 1 | Pass | dbmate (as non-superuser `schoolos_owner`) applied and rolled back roles, schemas, policies, `FORCE RLS`, `SECURITY DEFINER`, triggers, composite FKs |
| 2 | Pass | Each migration runs in one transaction by default, atomically including `CREATE ROLE`. `transaction:false` is needed for `CREATE INDEX CONCURRENTLY`, and that statement must be alone in its file (a multi-statement file still runs as one implicit transaction) |
| 3 | Pass | npm package with per-platform binaries, pinned by the lockfile; clean `--frozen-lockfile` installs on `linux/arm64` and `linux/amd64` containers |
| 4 | Pass | One backend PID and transaction ID for every statement; RLS returns only the tenant's rows |
| 5 | Pass | `sql` fragments run `pg_advisory_xact_lock` and `set_config(..., true)` on the transaction's connection |
| 6 | Pass | Types generated by kysely-codegen; `--verify` fails on drift; strict TypeScript, no `any` |
| 7 | Pass | Deterministic interleaving plus 400 concurrent transactions for two tenants on one pool: no cross-reads; negative control detects a session-level leak |

**Finding that affects the rules above:** binding a per-transaction Kysely instance to a raw `pg` client (as worded under "Rules") lets a nested `transaction()` commit the outer transaction early and lets an escaped handle read another tenant's rows after the client is reused. Kysely's own `Transaction` prevents both.

**Proposed amendment (not yet applied):** replace "Kysely instances are only constructed inside those wrappers, bound to the transaction's single `pg` client" with: "`src/platform/db` holds the only `pg.Pool` and the only `Kysely` instance. The wrappers open a Kysely-managed transaction (`db.transaction().execute`), set context with `set_config(..., true)` as the first statement, and pass handlers only the `Transaction` object. Handlers never receive the pool, the root `Kysely` instance, or a raw `pg` client."
