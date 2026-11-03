# Architecture Readiness Review (pre-M1)

- **Date:** 2026-11-02
- **Scope:** All documents in the initial specification commit (`e960424`).
- **Purpose:** Identify contradictions, gaps, and unvalidated assumptions that could affect M1 before implementation begins.
- **Outcome:** M1 can proceed **without Google API access**, provided the decisions in §7 are ratified first. Pure documentation contradictions were corrected in place; each correction is listed in §8 with its reason. No architectural direction was changed.

Severity: **High** = would cause a security defect or rework in M1 if not resolved. **Medium** = must be resolved during M1. **Low** = clarify before the milestone that needs it.

---

## 1. Architectural contradictions

| ID | Severity | Contradiction | Where | Resolution |
| --- | --- | --- | --- | --- |
| C-1 | High | Audit logs are append-only and hash-chained (no `DELETE` for `app_user`), but retention settings include `audit_logs` and purge jobs delete old rows. Deleting the head of a hash chain breaks verification. | DATA_MODEL §3.7, §3.9; SECURITY_MODEL §9 | Decision D-5 (§7): purge runs as a dedicated `audit_maintainer` DB role, deletes only whole contiguous prefixes, and writes a signed **checkpoint** (last deleted `seq` + `hash`) so the remaining chain still verifies. |
| C-2 | High | Data-subject deletion requires removing or pseudonymizing student identifiers, but audit rows are immutable and hashed, so `UPDATE` is impossible without breaking the chain. | PRIVACY §5; DATA_MODEL §3.7 | Decision D-5: audit rows store **only opaque IDs** in hashed columns; human-readable identifiers (emails, IPs, user agents) go in a separate, non-hashed `audit_log_details` table that can be redacted under retention or deletion rules. |
| C-3 | Medium | `commands.status` was described as "a projection of the latest event", but `command_events` belong to `command_targets`, and `commands.status` uses aggregate values (`in_progress`, `completed_with_errors`). | SYSTEM_ARCHITECTURE §10.1 vs DATA_MODEL §3.5 | **Corrected:** `command_targets.status` projects `command_events`; `commands.status` aggregates its targets. |
| C-4 | Medium | The per-target lifecycle diagram includes `pending_approval`/`rejected`, but approvals are modelled per command (`command_approvals.command_id`). | SYSTEM_ARCHITECTURE §10.1; ADR-0006 | **Corrected:** approval states live on `commands`; target lifecycle starts at `queued`. |
| C-5 | Low | Idempotency keys are "stored per organization for 24 h" for the API, while `commands.idempotency_key` is "unique per organization" with no expiry. | SYSTEM_ARCHITECTURE §5.2 vs DATA_MODEL §3.5 | **Corrected:** these are two mechanisms. The API-level replay cache keeps keys for 24 h; command creation keys are permanently unique per organization. |
| C-6 | Medium | Support access is described both as a built-in role `support_delegate` (a membership) and as `support_access_grants` (not a membership). | PRD FR-IAM-4 vs DATA_MODEL §3.1 | Decision D-7: one mechanism only. Recommended: grants evaluated by `authorize()`, with no membership row. Not needed until M5; M1 must not implement `support_delegate`. |
| C-7 | Low | PostgreSQL "≥ 15" is stated, while DATA_MODEL prefers UUIDv7. Native `uuidv7()` is believed to exist only in newer PostgreSQL (18) [Assumption]; on older versions IDs must be generated in the application. | SYSTEM_ARCHITECTURE §6; DATA_MODEL §1 | Decision D-3: pin the PostgreSQL major version to what the chosen managed provider supports, and choose the UUID strategy accordingly. |
| C-8 | Medium | ROADMAP M1 requires IaC for `staging`, but the cloud provider (OPEN_QUESTIONS T-1) is an M0 question that is still open. | ROADMAP M1; OPEN_QUESTIONS T-1 | M1 plan sequences staging last and makes T-1 an explicit M1 entry dependency for that step only. |
| C-9 | Medium | "School-scope filtering ... for sensitive tables, also by RLS using `app.current_school_ids`" doesn't say which tables. | SYSTEM_ARCHITECTURE §8 | M1: school scope is enforced in the service layer only. RLS school scoping is deferred to M2, where device tables first need it (recorded in the M1 plan). |

## 2. Missing security requirements

These are not contradictions but gaps that M1 must close. Each is assigned to the M1 plan.

| ID | Gap | M1 requirement |
| --- | --- | --- |
| S-1 | **Pre-tenant bootstrap queries.** RLS keyed only on `app.current_org_id` blocks "list my organizations" and "resolve my membership", which must run before an org is selected. | Add RLS policies on `memberships`/`organizations` allowing rows where `user_id = app.current_user_id`, read-only, columns limited by views. |
| S-2 | **Global tables under RLS.** `users`, `permissions`, and built-in `roles` (`organization_id IS NULL`) have no defined policy. | `users`: visible only to self or to members sharing the current org. `permissions`: read-only to all. `roles`: `organization_id IS NULL OR organization_id = current org`. |
| S-3 | **Worker and system jobs tenant context.** Jobs have no user; schedulers need to enumerate orgs. | `withSystemContext(orgId, jobName)` sets org context plus `actor_type=system`. Org enumeration goes through a single narrow `SECURITY DEFINER` function returning IDs only. |
| S-4 | **Invitation security.** Not specified. | Random 256-bit token, stored hashed, 72 h expiry, single use, bound to invited email, re-invite revokes the prior token, accept requires an authenticated user whose verified email matches. |
| S-5 | **Account recovery and MFA reset.** A social-engineering path to account takeover. | MFA reset only by an org owner or admin of every org the user belongs to, or by a documented platform support procedure with identity verification. Always audited and notified. |
| S-6 | **Last-owner protection.** An org could lose all owners. | Cannot remove, demote, or suspend the last active `org_owner`. |
| S-7 | **Session revocation on membership change.** | Removing or suspending a membership or changing its role takes effect on the next request (authorization reads memberships per request; no cached role claims in tokens). |
| S-8 | **Rate limiting.** Only login is mentioned. | Per-IP and per-user limits on auth, invitation, and all mutating endpoints. In-memory or Postgres-backed in M1, per ADR-0009. |
| S-9 | **HTTP security headers and CORS.** | CSP (no `unsafe-inline` scripts where feasible), HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `frame-ancestors 'none'`. No CORS for `/api/v1` except same-origin in M1. |
| S-10 | **CSRF.** "CSRF protection" with no mechanism specified. | `SameSite=Lax` cookies plus an `Origin`/`Host` check on every mutating request, plus a double-submit token for form posts. |
| S-11 | **Input validation standard.** | Every route has a request schema; unknown fields are rejected; validation errors never echo raw input into logs. |
| S-12 | **Audit failure semantics.** If the audit insert fails, must the action fail? Denied attempts happen in transactions that roll back. | Successful actions: the audit row is in the **same transaction** (fail closed). Denied or errored actions: written in a **separate** short transaction after rollback. |
| S-13 | **Error disclosure.** | Cross-tenant or unauthorized resource access returns `404`, not `403`, to avoid confirming existence. |
| S-14 | **Supabase data API exposure.** If the database is hosted on Supabase, its auto-generated data API could expose tables [Assumption: depends on project config]. | Decision D-2: either host PostgreSQL outside Supabase, or disable or lock down the data API and verify with a test that unauthenticated requests return nothing. |
| S-15 | **Logging redaction test.** | Automated test asserting known PII and secret patterns never appear in captured logs. |

## 3. Unresolved dependencies affecting M1

| ID | Dependency | Blocks | Proposed handling |
| --- | --- | --- | --- |
| DEP-1 | Cloud provider (T-1) | Staging IaC, secrets manager choice | Build everything else first; staging is the last M1 step. |
| DEP-2 | IdP final choice and Supabase hosting fit (T-2) | Auth implementation | Implement the `AuthProvider` interface plus a test-only fake first; Supabase adapter second. |
| DEP-3 | Staff sign-in methods (T-3) | Auth UX | M1: email + password + TOTP MFA. Google/SAML SSO deferred. |
| DEP-4 | Connection pooler compatible with `SET LOCAL` (T-5) | Production DB topology | M1 local and dev use direct connections; a concurrency leak test must pass against the chosen pooler before staging sign-off. |
| DEP-5 | Next.js hosting model (T-6) | Staging deploy | Containerized deployment keeps worker and web symmetric; decide with T-1. |
| DEP-6 | Migration tool and DB access library | All schema work | Decision D-4 (§7). |
| DEP-7 | Supabase capabilities assumed in docs: TOTP MFA with an assurance-level claim, reauthentication for step-up, configurable session lifetimes | MFA and step-up design | All [Assumption]. Verify against Supabase docs and a local instance in M1 step 1. If unavailable, enforce idle/absolute timeouts and step-up in our own session layer. |

## 4. Database design weaknesses

| ID | Weakness | Recommendation |
| --- | --- | --- |
| DB-1 | Composite FK `(organization_id, role_id)` can't reference built-in roles whose `organization_id` is NULL. | Use a simple FK for `memberships.role_id`, plus a check (trigger) that the role is built-in or belongs to the same org. |
| DB-2 | RLS predicate `current_setting(...)::uuid` evaluated per row can hurt performance. | Wrap it in a `STABLE` function or write `organization_id = (select app.current_org_id())` so the planner evaluates it once. Every index on tenant tables leads with `organization_id`. |
| DB-3 | The audit hash chain serialized by a per-org advisory lock makes audited writes in an org sequential. | Acceptable for MVP volume; monitor lock wait time. Keep the audit insert at the end of the transaction to minimize lock hold time. |
| DB-4 | `audit_logs.organization_id` may be NULL for platform events, but the chain is defined per org. | Separate `platform_audit_logs` table with its own chain, not visible to tenant roles. |
| DB-5 | Missing tables required by documented features: invitations, API idempotency cache, organization settings (session timeouts, approval policies), audit checkpoints. | Add `invitations`, `api_idempotency_keys`, `organization_settings`, `audit_checkpoints` in M1. Approval policies wait for M3. |
| DB-6 | No `updated_at` maintenance mechanism. | Trigger per mutable table, or set explicitly in repository functions (pick one; prefer trigger). |
| DB-7 | `users.email` uniqueness and case sensitivity are undefined. Emails can change at the IdP. | `auth_subject` is the identity key. `email` is stored lower-cased and unique, and refreshed on login. |
| DB-8 | Status `text` + `check` constraints need a migration discipline for adding values. | Document the pattern (drop/re-add constraint in one migration) in the migration README. |
| DB-9 | `platform_ops` role says "separate explicit policies" with no definition. | Out of scope for M1. Do not create the role until a concrete operator use case exists (M5). |
| DB-10 | Soft lifecycle vs FK behaviour on deletion is undefined. | Default `ON DELETE RESTRICT`; purge and deletion jobs delete children explicitly in dependency order. |

## 5. Missing test requirements

| ID | Missing test | M1 requirement |
| --- | --- | --- |
| TST-1 | Automatic coverage that **every** table in tenant schemas has RLS enabled and forced. | CI query against `pg_class`/`pg_policies` fails if any table lacks RLS or a policy (allow-list for truly global tables). |
| TST-2 | Automatic coverage that **every** API route declares a permission and is exercised by the cross-tenant harness. | Route registry + test that enumerates routes. A route missing from the harness fails CI. |
| TST-3 | Concurrency test for tenant-context leakage through pooled connections. | Parallel requests for two orgs over a shared pool; assert no cross-reads. |
| TST-4 | Permission matrix tests (role × permission). | Table-driven unit tests generated from the matrix. |
| TST-5 | Audit chain verification, including tampering detection and checkpoint handling. | Unit + integration tests. |
| TST-6 | Migration tests: apply all migrations to an empty database, and repeat to confirm idempotent tooling. | CI job. |
| TST-7 | Tests run against **real PostgreSQL**, not mocks or SQLite. | Docker-based Postgres in CI, same major version as production. |
| TST-8 | Fake auth provider cannot be enabled outside test/local. | Startup check + test. |
| TST-9 | Log redaction (S-15) and security headers (S-9). | Automated tests. |
| TST-10 | End-to-end smoke: sign up via invitation, MFA enroll, switch orgs, denied cross-org access. | Browser E2E in CI against local stack. |

## 6. Assumptions needing validation

| ID | Assumption | Source doc | Validate by |
| --- | --- | --- | --- |
| A-1 | Supabase Auth supports TOTP MFA with an assurance-level claim usable server-side. | ADR-0004, SECURITY_MODEL §5 | Supabase docs + local test, M1 step 1 |
| A-2 | Supabase supports reauthentication suitable for a ≤ 5-minute step-up window. | SECURITY_MODEL §5 | Same as A-1. Fallback: our own step-up (password + TOTP re-prompt) |
| A-3 | Supabase session lifetime and inactivity timeouts are configurable on our plan. | SECURITY_MODEL §5 | Same. Fallback: enforce in our session layer |
| A-4 | The chosen connection pooler preserves `SET LOCAL` semantics in transaction mode. | ADR-0003 | TST-3 against the real pooler |
| A-5 | Native `uuidv7()` is available on the chosen PostgreSQL version. | DATA_MODEL §1 | Provider docs, D-3 |
| A-6 | Hash-chained audit with advisory locks meets MVP throughput. | DATA_MODEL §3.7 | Load test in M1 (target: 50 audited writes/s per org) |
| A-7 | Postgres-backed job queue is adequate for M1 (only the audit verification job). | ADR-0009 | Trivially true for M1; revisit at M2 |
| A-8 | All Google-related assumptions in CHROMEOS_INTEGRATION. | — | Not needed for M1; M0 spike |

## 7. Decisions required before M1 coding

Each becomes an ADR (Proposed → Accepted) before the step that depends on it.

| ID | Decision | Recommendation | Needed by M1 step |
| --- | --- | --- | --- |
| D-1 | Package manager, Node.js version, monorepo or single package | pnpm, active Node LTS, single package with `src/` modules (no monorepo tooling until the Go agent arrives) | 1 |
| D-2 | Where PostgreSQL runs relative to Supabase Auth | Managed Postgres in our cloud account, Supabase used for Auth only. This avoids the S-14 exposure and keeps ADR-0004's lock-in boundary clean. If the DB is co-hosted on Supabase, the data API must be disabled and tested. | 2 |
| D-3 | PostgreSQL major version and UUID strategy | Match the managed provider; app-generated UUIDv7 if native support is absent | 2 |
| D-4 | Migration tool and DB access library | Plain SQL migration files, reviewed like code, plus a typed query builder or thin SQL layer that **only** runs inside the tenant transaction wrapper. Evaluate 2–3 options in a time-boxed spike; no ORM that hides SQL or manages RLS implicitly. | 2 |
| D-5 | Audit log design under retention and deletion (fixes C-1, C-2, DB-4) | Hashed core row with opaque IDs only; separate redactable `audit_log_details`; prefix-only purge by `audit_maintainer` with `audit_checkpoints`; separate `platform_audit_logs`. | 5 |
| D-6 | Active-organization resolution (FR-ORG-3) | Org ID in the path: UI `/o/{orgSlug}/...`, API `/api/v1/orgs/{orgId}/...`. Membership verified per request. No implicit "current org" stored in the session. | 4 |
| D-7 | Support access mechanism (C-6) | Grants via `authorize()`, no membership. Implementation deferred to M5. | — (M5) |
| D-8 | Session model | IdP session plus a SchoolOS-side session record (for idle/absolute timeouts, step-up timestamp, forced revocation) if A-1 to A-3 fail | 3 |

## 8. Corrections applied in this change

Only pure contradictions were corrected. Direction and decisions are unchanged.

| File | Change | Reason |
| --- | --- | --- |
| `docs/SYSTEM_ARCHITECTURE.md` §5.2 | Clarified the API idempotency cache (24 h) vs permanent command idempotency key | C-5 |
| `docs/SYSTEM_ARCHITECTURE.md` §10.1 | Split lifecycle into command-level approval states and target-level execution states; clarified projections | C-3, C-4 |
| `docs/DECISIONS/0006-command-lifecycle.md` | Same clarification (ADR still Proposed, so editing is allowed) | C-3, C-4 |
| `docs/DATA_MODEL.md` §3.5 | `commands.status` values aligned with the command-level lifecycle (`approved` replaces `queued`) | C-3, C-4 |
| `docs/ROADMAP.md` M1 | Linked the M1 plan; noted the staging dependency on T-1 | C-8 |
| `docs/OPEN_QUESTIONS.md` | Added T-11 to T-15 from this review | §3, §6 |
| `docs/PRODUCT_REQUIREMENTS.md` FR-IAM-4 | Marked `support_delegate` as pending D-7 | C-6 |
