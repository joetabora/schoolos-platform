# ADR-0019: Support access via temporary explicit grants evaluated by authorize()

- **Status:** Accepted. Implementation deferred to M5.
- **Date:** 2026-11-02
- **Deciders:** Founding engineering team
- **Related:** PRODUCT_REQUIREMENTS J5, FR-IAM-4; DATA_MODEL `support_access_grants`; SECURITY_MODEL T11; ARCHITECTURE_READINESS_REVIEW C-6, D-7

## Context

The specification described support access both as a `support_delegate` role (a membership) and as `support_access_grants`. A standing membership for SchoolOS staff would give silent, persistent access to customer data.

## Decision

- SchoolOS support access is granted only through **temporary, explicit `support_access_grants`** created by an authorized customer admin, with scope (`read_only` / `read_write`), reason, ticket reference, start, and expiry.
- **No permanent support membership** and no `support_delegate` role.
- `authorize()` evaluates active grants alongside memberships. Grants are checked on every request, and expiry or revocation takes effect immediately.
- Every request made under a grant is audited with actor type `support` and is visible to the organization.
- Support users must meet the same MFA and session requirements as privileged roles (ADR-0016).
- **Not implemented in M1.** M1 must not create a support role or any bypass path.

## Consequences

- `authorize()` must be designed in M1 to accept a second source of authority later without restructuring.

## Verification

M5 tests: no access without an active grant; expired and revoked grants deny on the next request; all support actions are audited and visible to the customer.
