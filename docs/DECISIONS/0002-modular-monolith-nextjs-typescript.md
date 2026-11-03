# ADR-0002: Modular monolith with TypeScript and Next.js

- **Status:** Proposed
- **Date:** 2026-11-02
- **Related:** SYSTEM_ARCHITECTURE §1, §5

## Context

A small team must deliver a secure multi-tenant MVP. Microservices add network boundaries, distributed transactions, and operational burden without benefit at MVP scale (NFR-5: 50 orgs, 250k devices).

## Decision

Build one TypeScript codebase:
- a Next.js application serving the staff UI and `/api/v1` REST API;
- a worker entrypoint from the same codebase for background jobs.

Enforce module boundaries in code (directory structure, import lint rules, `ports` interfaces), not via separate services.

## Alternatives considered

| Option | Pros | Cons |
| --- | --- | --- |
| Microservices from day one | Independent scaling/deploys | High complexity, slower delivery, more security surface |
| Separate SPA + separate API service | Clear split | Two deployables, duplicated types/auth logic |
| Monolith (chosen) | Simple, typed end-to-end, one deploy | Requires discipline to keep modules decoupled |

## Consequences

- Positive: faster iteration; shared types; single authorization path.
- Negative: long-running work must not run in request handlers (handled by the worker).
- Risk: framework coupling to Next.js. Mitigation: domain modules are plain TypeScript with no Next.js imports.

## Verification

Revisit when a module needs independent scaling, a separate security boundary (expected: device gateway in M6/M7), or team size makes a single deployable a bottleneck.
