# ADR-0021: Tenant-context assertions and destroy-on-uncertain-transaction-end

- **Status:** Accepted
- **Date:** 2026-11-02
- **Deciders:** Founding engineering team
- **Related:** ADR-0003, ADR-0013, ADR-0014; OPEN_QUESTIONS T-23; [`SPIKE_DB_TOOLING_REPORT.md`](../SPIKE_DB_TOOLING_REPORT.md)

## Context

[ADR-0014](0014-database-tooling.md) requires `SET LOCAL` / `set_config(..., true)` inside a Kysely-managed transaction and an aborted-transaction probe (SQLSTATE `25P02`) so a swallowed database error cannot commit as success.

The 2026-11-02 spike could not induce a failed `ROLLBACK` that left the connection alive (T-23). It treated “release the client as broken on wrapper error” and “assert empty tenant context at transaction start” as alternatives.

Stock Kysely 0.29.7 does **not** destroy a pooled client when rollback fails. `TransactionBuilder.execute` always releases the connection in `finally`. `PostgresDriver.releaseConnection` calls `client.release()` with no error argument, so node-postgres returns the client to the pool. The spike wrapper does not implement either safeguard. Do not assume the spike or stock Kysely solves T-23.

A dirty pooled connection can leak leftover session GUC or, worse, an open transaction with another tenant’s uncommitted writes.

## Decision

The `src/platform/db` wrappers (`withTenant` / `withUser` / `withSystem`) implement **both** safeguards, and keep the aborted-transaction probe:

1. **Empty tenant-context assertion before establishing context.** After the transaction begins, and before `set_config` for `app.current_org_id` / `app.current_user_id`, the wrapper asserts those settings are unset or empty. If either is set, the wrapper fails the request and treats the client as broken.
2. **Destroy the pooled connection whenever transaction completion or rollback is uncertain.** On failed `COMMIT`, failed `ROLLBACK`, or any path where the wrapper cannot confirm a clean transaction end, the client is released as broken (`PoolClient.release(true)` or equivalent) so it is not reused. A successful, confirmed `COMMIT` or `ROLLBACK` may return the client to the pool.
3. **Retain the aborted-transaction probe** from ADR-0014 (SQLSTATE `25P02` after the handler returns). That probe addresses swallowed errors, not failed rollback.

Stock Kysely must not be assumed to support (2). The Decision above is the required wrapper contract. It is **not** a claim that Step 2 already implements or has proven these paths. Implementation verification must use the actual installed Kysely and `pg` versions. A custom driver, dialect, or connection-provider change is permitted only if those test results show it is required, and only if that exact implementation is built and covered by the tests below. Do not claim an untested custom wrapper solves T-23. Handlers still receive only a Kysely `Transaction`.

## Alternatives considered

| Option | Pros | Cons |
| --- | --- | --- |
| Empty-context assert only | Catches leftover GUC | Misses an open transaction with leftover writes |
| Destroy-on-uncertain-end only | Prevents re-pooling a half-finished transaction | Misses session-level `SET` that committed “cleanly” |
| Both (chosen) | Complementary failure modes | Requires a Kysely/pg-validated destroy path |
| Assume stock Kysely `release` is enough | No extra code | Proven false against Kysely 0.29.7 `PostgresDriver` |

## Consequences

- Positive: leftover GUC and uncertain transaction end are both denied a return trip through the pool.
- Negative / costs: extra connections may be opened after errors. A custom driver, dialect, or connection provider may be added only if actual test results against the installed stack require it, and only if that exact code is tested.
- Risks and mitigations: a future Kysely release may change release behavior. The Step 2 tests against the installed stack are the proof. An untested custom wrapper is not proof.

## Verification

These are implementation verification requirements for Step 2. They are not evidence that the behavior already exists in the product.

- Retain the empty tenant-context assertion at transaction start (Decision item 1).
- Retain the post-handler aborted-transaction probe and SQLSTATE `25P02` handling (Decision item 3).
- Exercise the **real installed** Kysely transaction-execution and connection-release path (not a stand-in driver).
- Inject a rollback failure at the appropriate driver or `pg` client boundary.
- Verify that the underlying `pg` client is destroyed and is not returned to the pool for reuse.
- Verify that the next checkout cannot observe a prior transaction’s session-level tenant context.
- Do not accept a mock of an untested custom driver, dialect, or connection provider as proof. If a custom implementation is introduced, that exact implementation must be what the tests exercise.
