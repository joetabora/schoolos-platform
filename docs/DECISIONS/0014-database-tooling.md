# ADR-0014: Database tooling — dbmate, Kysely, node-postgres

- **Status:** Proposed. Becomes Accepted only after the compatibility spike below passes.
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
