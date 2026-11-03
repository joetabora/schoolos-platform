# ADR-0008: REST API first; separate device communication layer later

- **Status:** Proposed
- **Date:** 2026-11-02
- **Related:** SYSTEM_ARCHITECTURE §5.2, §5.3; OPEN_QUESTIONS T-7

## Context

The MVP has only staff browser clients and server-to-Google calls. Native agents and the extension come later and need device authentication and low-latency command delivery.

## Decision

- Expose a versioned JSON REST API at `/api/v1` with OpenAPI documentation, idempotency keys on mutations, cursor pagination, and a consistent error format.
- Do not add GraphQL or gRPC for staff clients in MVP.
- Introduce a **separate device gateway** (own ingress, own auth path, mTLS/signed tokens) when the extension or agent ships. Transport chosen by a later ADR.

## Consequences

- Staff and device traffic are isolated at the network and auth level.
- The same REST API can be offered to district integrations later.

## Verification

Revisit when device clients are introduced (M6/M7).
