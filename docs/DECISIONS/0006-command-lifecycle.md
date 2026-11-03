# ADR-0006: Auditable command lifecycle with append-only events

- **Status:** Proposed
- **Date:** 2026-11-02
- **Related:** SYSTEM_ARCHITECTURE §10, DATA_MODEL §3.5, SECURITY_MODEL §6

## Context

Remote commands (reboot, wipe, powerwash, disable, remote access) are high-impact. Districts must be able to see who requested what, who approved it, what was sent, and what actually happened. Providers report asynchronous states (Google: `PENDING`, `SENT_TO_CLIENT`, `ACKED_BY_CLIENT`, `EXECUTED_BY_CLIENT`, `EXPIRED`, `CANCELLED`).

## Decision

- Persist every command **before** dispatch, with requester, reason, targets, parameters, approval policy snapshot, expiry, and idempotency key.
- Model per-device execution as `command_targets` with a SchoolOS lifecycle (`requested → pending_approval → queued → dispatching → dispatched → acknowledged → succeeded | failed | expired | cancelled | rejected | unknown`).
- Record every transition in append-only `command_events` with actor type and raw provider state.
- Dispatch and polling happen in worker jobs, never in request handlers.
- Include an explicit `unknown` terminal state rather than inferring outcomes.
- High-impact commands require approval per org policy; requester cannot self-approve.

## Consequences

- Positive: complete audit trail; consistent UX across Google and native agent; safe retries.
- Negative: more tables and states to test.

## Verification

Tests for every allowed and disallowed transition; tests that the UI/API never return `succeeded` without a provider or agent confirmation event.
