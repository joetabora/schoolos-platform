# ADR-0020: Application UUIDv7 via Node.js `crypto.randomUUIDv7`

- **Status:** Accepted
- **Date:** 2026-11-02
- **Deciders:** Founding engineering team
- **Related:** ADR-0012, ADR-0013; OPEN_QUESTIONS T-19; DATA_MODEL §1

## Context

[ADR-0013](0013-database-hosting-postgres-version-uuid-pooling.md) requires RFC 9562 UUIDv7 identifiers generated in the application and deferred the implementation choice to M1 step 2 (T-19). The database-tooling spike used `crypto.randomUUID` (v4) and did not select a generator.

The application already pins Node.js 26.13.0 and `@types/node` 26.6.5. Node.js documents `crypto.randomUUIDv7` as an RFC 9562 version 7 generator since v26.1.0. Adding an npm UUID package would be a new supply-chain dependency for a platform API we already ship.

## Decision

Generate UUIDv7 with Node.js `crypto.randomUUIDv7()` from `node:crypto`.

- Call it only through a centralized SchoolOS helper in `src/platform`. Application modules, routes, and tests do not import `randomUUIDv7` directly.
- Do not add a UUID npm dependency (`uuid`, `uuidv7`, or similar).
- Do not use PostgreSQL `uuidv7()` for application-written rows (ADR-0013). `gen_random_uuid()` (v4) remains a SQL-only maintenance fallback.

## Alternatives considered

| Option | Pros | Cons |
| --- | --- | --- |
| Node `crypto.randomUUIDv7` (chosen) | RFC 9562 in the pinned runtime; types already present; zero new packages | Not strictly monotonic within a millisecond; requires Node ≥ 26.1.0 |
| `uuid` (uuidjs) v14 | RFC 9562 `v7()`; ESM; optional same-ms `seq` | Extra dependency we do not need on Node 26 |
| PostgreSQL `uuidv7()` | No app helper | Rejected by ADR-0013; ties writes to PostgreSQL 18+ |

## Consequences

- Positive: no new dependency; one audited call site; matches the Node 26 / TypeScript 6 stack.
- Negative / costs: identifiers are time-sortable but not guaranteed strictly increasing within the same millisecond (documented Node behavior). That is acceptable for primary keys.
- Risks and mitigations: dropping below Node 26.1.0 would remove the API. `engines`, `.nvmrc`, and `.node-version` already pin 26.13.0.

## Verification

Unit tests of the helper: output matches a UUID shape, version nibble is `7`, and distinct calls produce distinct values. No `uuid` package appears in `package.json` or the lockfile.
