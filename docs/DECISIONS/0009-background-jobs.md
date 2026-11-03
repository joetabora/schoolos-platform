# ADR-0009: PostgreSQL-backed job queue first; Redis when needed

- **Status:** Proposed
- **Date:** 2026-11-02
- **Related:** SYSTEM_ARCHITECTURE §14, OPEN_QUESTIONS T-4

## Context

We need background jobs (sync, command dispatch, status polling, retention purges, drift checks). Adding Redis on day one adds an extra stateful service to secure, back up, and monitor.

## Decision

- Use a PostgreSQL-backed job queue for MVP (library choice in M1; candidates include pg-boss and graphile-worker, to be evaluated, not assumed).
- Enqueue jobs in the same transaction as the domain write (e.g. command creation), which avoids lost or phantom jobs.
- Introduce Redis only when a concrete trigger occurs:
  - queue throughput or latency exceeds what Postgres handles comfortably;
  - distributed rate limiting across many instances;
  - pub/sub for live UI updates at scale.

## Consequences

- Positive: one stateful dependency; transactional enqueue.
- Negative: queue load on primary database; must monitor.

## Verification

Monitor queue depth, job latency, and DB load; trigger documented above prompts a new ADR.
