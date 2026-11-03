# ADR-0003: PostgreSQL shared-schema multi-tenancy with RLS

- **Status:** Proposed
- **Date:** 2026-11-02
- **Related:** DATA_MODEL §4, SECURITY_MODEL T1/T2

## Context

Multi-tenancy is required from day one. Cross-tenant exposure is the highest-impact failure mode. Application-layer checks alone are vulnerable to a single missed filter.

## Decision

- Single PostgreSQL database, shared schema, `organization_id` on every tenant-scoped table.
- RLS **enabled and forced** on all tenant-scoped tables; policies compare to `current_setting('app.current_org_id', true)`.
- Tenant context set with `SET LOCAL` inside each transaction; session-level `SET` forbidden.
- Application runs as a non-owner role without `BYPASSRLS`.
- Composite `(organization_id, id)` foreign keys to prevent cross-tenant references.
- Application-layer authorization remains mandatory; RLS is a second, independent layer.

## Alternatives considered

| Option | Pros | Cons |
| --- | --- | --- |
| Database per tenant | Strongest isolation | Operational cost, migrations across many DBs, poor fit for small team |
| Schema per tenant | Good isolation | Migration complexity, connection/catalog bloat |
| Shared schema without RLS | Simplest | One missed `WHERE` = breach |
| Shared schema with RLS (chosen) | Strong isolation with low ops cost | Requires careful pooling and testing |

## Consequences

- Connection pooler must support transaction-mode semantics with `SET LOCAL` (OPEN_QUESTIONS T-5).
- Every new table needs an RLS policy and isolation tests; CI check enforces that RLS is enabled on tenant tables.
- Supports moving a large customer to a dedicated database later with the same schema.

## Verification

Isolation test suite (DATA_MODEL §4.3) runs in CI; any failure blocks merge.
