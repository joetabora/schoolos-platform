# M1 Implementation Plan: Platform Skeleton

- **Status:** Proposed. Ratify the decisions in §2 before the step that depends on each.
- **Milestone:** M1 ([`ROADMAP.md`](ROADMAP.md#m1-platform-skeleton))
- **Inputs:** [`ARCHITECTURE_READINESS_REVIEW.md`](ARCHITECTURE_READINESS_REVIEW.md), [`SYSTEM_ARCHITECTURE.md`](SYSTEM_ARCHITECTURE.md), [`DATA_MODEL.md`](DATA_MODEL.md), [`SECURITY_MODEL.md`](SECURITY_MODEL.md)
- **Google dependency:** **None.** M1 contains no provider code, no device tables, and no Google credentials. It can be completed in full before the M0 Google spike finishes.

## 1. Goal and scope

Deliver a secure, tested, multi-tenant foundation that every later milestone builds on: staff can be invited into an organization, sign in with MFA, see only their organization's data, manage members within their permissions, and every security-relevant action is recorded in a verifiable audit log.

### In scope
1. Application foundation (Next.js, TypeScript, worker entrypoint, tooling, CI)
2. Authentication (`AuthProvider` interface, Supabase adapter, test-only fake, MFA, sessions, step-up)
3. Organizations, schools, users, memberships, invitations
4. Role-based access control with school scopes
5. PostgreSQL schema and migrations for the above
6. Row-level security on every tenant table
7. Hash-chained audit logging with verification
8. Automated tenant-isolation test harness
9. `local`, `dev`, and `staging` environments

### Out of scope (do not build in M1)
- Integrations, devices, policies, commands, security events (M2–M5)
- Support access grants and the `platform_ops` role (M5; review D-7, DB-9)
- Self-service org sign-up and billing. Orgs are created by an operator CLI script in M1.
- SSO (Google/SAML) for staff (review DEP-3)
- Custom roles (schema allows them; no UI or API)
- RLS-level school scoping (service layer only in M1; review C-9)
- Redis (ADR-0009)

## 2. Decisions to ratify (as ADRs) before dependent steps

Details and rationale are in the readiness review, §7.

| Decision | Recommendation | ADR to write | Blocks step |
| --- | --- | --- | --- |
| D-1 Tooling | pnpm, active Node LTS, single package | ADR-0012 | 1 |
| D-2 Database hosting vs Supabase | Our own managed Postgres; Supabase for Auth only | ADR-0013 | 2 |
| D-3 Postgres version and UUIDs | Match managed provider; app-generated UUIDv7 if no native function | in ADR-0013 | 2 |
| D-4 Migrations and DB access | Plain SQL migrations + typed thin query layer, after a time-boxed spike | ADR-0014 | 2 |
| D-6 Active-org resolution | Org in URL path; membership checked per request | ADR-0015 | 4 |
| D-8 Session model | Depends on Supabase verification (T-12) | ADR-0016 | 3 |
| D-5 Audit design | Hashed core row with opaque IDs, redactable details, prefix purge with checkpoints | ADR-0017 | 6 |

## 3. Workstreams

### 3.1 Application foundation

**Repository layout (target):**

```
app/                       Next.js App Router (UI routes under /o/[orgSlug]/..., API under /api/v1/...)
src/
  platform/
    config/                typed env loading and validation (fail fast on startup)
    db/                    pool, withTenant/withUser/withSystem transaction wrappers
    auth/                  AuthProvider interface, supabase adapter, test fake
    authz/                 permission catalog, role matrix, authorize()
    audit/                 writeAudit(), chain verification
    http/                  route wrapper: auth -> org resolution -> authz -> validation -> handler -> error mapping
    log/                   structured logger with redaction
    security/              headers, CSRF/origin checks, rate limiting
  modules/
    organizations/         service + repository + ports
    schools/
    members/               memberships, invitations
  jobs/                    worker job definitions (M1: audit chain verification)
  worker.ts                worker entrypoint
db/
  migrations/              ordered SQL files
  README.md                migration conventions (incl. enum/check pattern, review DB-8)
scripts/
  create-organization.ts   operator CLI (audited; runs against a target env)
tests/
  unit/  integration/  isolation/  e2e/
```

**Tooling requirements:**
- TypeScript `strict`, no `any` in `src/platform/**` without a justification comment.
- ESLint import-boundary rules: `src/modules/**` cannot import `src/providers/**` (ADR-0005); only `src/platform/auth/**` may import the Supabase SDK (ADR-0004); only `src/platform/db/**` may open DB connections.
- Formatter, type check, lint, and tests run in CI on every PR.
- Dependency vulnerability scan and secret scan in CI.
- `.env.example` documents every variable; real `.env*` files are git-ignored (already configured).
- Startup config validation refuses to boot if, for example, `AUTH_PROVIDER=fake` is set with `NODE_ENV=production` or the environment is staging (TST-8).

**Route wrapper (single path for every API route):**

```ts
// Illustrative shape only.
export const GET = route({
  permission: "member.read",          // required; CI fails if missing (TST-2)
  scope: "organization",              // "organization" | "user" (pre-tenant) | "public"
  query: ListMembersQuery,            // schema; unknown fields rejected (S-11)
  handler: async (ctx, input) => members.list(ctx, input),
});
```

The wrapper verifies the session, resolves `orgId` from the path, loads the membership, runs `authorize()`, opens the tenant transaction, invokes the handler, writes audit on success inside the transaction, writes audit on denial/error in a separate transaction (S-12), and maps errors (unauthorized cross-org → `404`, S-13).

### 3.2 Authentication

- `AuthProvider` interface (ADR-0004): `verifySession(req)`, `getUser(subject)`, `revokeSessions(subject)`, `startMfaEnrollment`, `verifyMfa`, `reauthenticate` (shapes finalized after T-12).
- **Supabase adapter** is the only production implementation.
- **Fake adapter** exists only for unit/integration tests and local development; refused at startup outside those environments (TST-8).
- **User provisioning:** on first successful sign-in, create a `users` row keyed by `auth_subject` (lower-cased email stored, refreshed each login; review DB-7). A user with no memberships sees only the "no organizations" page.
- **MFA:** TOTP. Required before any org-scoped request for roles flagged `mfa_required` (all M1 admin roles). Enforced server-side by the route wrapper, not only in the UI.
- **Sessions:** HTTP-only, `Secure`, `SameSite=Lax`. Idle 30 min, absolute 12 h. If the IdP can't enforce both (A-3), keep a SchoolOS session record (`user_sessions`) with `last_seen_at`, `authenticated_at`, `step_up_at`, `revoked_at` (D-8).
- **Step-up:** required (≤ 5 min) for role changes, member removal, and audit export in M1.
- **Account recovery / MFA reset:** requires an org owner or admin action plus an audit entry and an email notification to the user; never self-service by email alone (S-5).
- **Rate limiting** on sign-in, MFA verification, invitation acceptance (S-8).

### 3.3 Organizations, schools, memberships, invitations

- **Create organization:** operator CLI only. Creates the org, default `organization_settings`, and an invitation for the first `org_owner`. Audited as a platform event (`platform_audit_logs`, review DB-4).
- **Active organization:** explicit in every URL (`/o/{orgSlug}`, `/api/v1/orgs/{orgId}`), D-6. Switching orgs is navigation, not session state.
- **Schools:** create, rename, archive (no hard delete).
- **Invitations (S-4):** 256-bit random token, stored as a hash, 72 h expiry, single use, bound to an email address, re-invite revokes the previous token, acceptance requires a signed-in user with a matching verified email. Inviter can't grant a role with permissions they don't hold (SECURITY_MODEL T4).
- **Membership changes:** change role, set school scopes, suspend, remove. Last active `org_owner` can't be removed, demoted, or suspended (S-6). Changes take effect on the next request, because roles are read from the database per request rather than cached in tokens (S-7).
- **Users in multiple orgs:** supported. `GET /api/v1/me/organizations` lists them via the pre-tenant bootstrap policy (S-1).

### 3.4 Role-based access control

**M1 permission catalog** (seeded by migration, global, read-only):

`org.read`, `org.update`, `school.read`, `school.manage`, `member.read`, `member.invite`, `member.manage`, `role.read`, `audit.read`, `audit.export`

**M1 role matrix** (built-in roles; `organization_id IS NULL`):

| Permission | org_owner | org_admin | school_admin | technician | security_analyst | auditor | teacher |
| --- | --- | --- | --- | --- | --- | --- | --- |
| org.read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| org.update | ✓ | ✓ | | | | | |
| school.read | ✓ | ✓ | ✓ (scoped) | ✓ (scoped) | ✓ | ✓ | |
| school.manage | ✓ | ✓ | | | | | |
| member.read | ✓ | ✓ | ✓ (scoped) | | ✓ | ✓ | |
| member.invite | ✓ | ✓ | ✓ (scoped, lower roles only) | | | | |
| member.manage | ✓ | ✓ | | | | | |
| role.read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| audit.read | ✓ | ✓ | | | ✓ | ✓ | |
| audit.export | ✓ | | | | ✓ | ✓ | |

Rules:
- `org_owner` is the only role that can grant or revoke `org_owner`.
- No one can grant permissions they don't hold.
- School-scoped roles (`school_admin`, `technician`) must have at least one school scope; org-wide roles must have none.
- `authorize(ctx, permission, resource?)` is the only check function. It returns a typed decision with a reason, used both for enforcement and for audit of denials.
- The matrix lives in one TypeScript module **and** in seeded rows; a test asserts they are identical (TST-4).

This matrix is a proposal for review. Changing it later is a normal migration plus an audit-visible change.

### 3.5 PostgreSQL schema (M1 tables)

From [`DATA_MODEL.md`](DATA_MODEL.md) §3.1, plus gaps from review DB-5:

| Table | Tenant-scoped | Notes |
| --- | --- | --- |
| `organizations` | by `id` | `status`, `is_demo`, `slug` |
| `organization_settings` | yes | session timeouts within platform bounds, MFA policy |
| `schools` | yes | |
| `users` | global | `auth_subject` unique, `email` lower-cased unique |
| `user_sessions` | global (per user) | only if D-8 requires it |
| `memberships` | yes | simple FK to `roles` + same-org-or-built-in check (DB-1) |
| `membership_school_scopes` | yes | composite tenant FKs |
| `permissions` | global, read-only | seeded |
| `roles` | built-in (NULL org) or tenant | M1 seeds built-ins only |
| `role_permissions` | follows `roles` | seeded |
| `invitations` | yes | `token_hash`, `email`, `role_id`, `school_ids`, `expires_at`, `accepted_at`, `revoked_at` |
| `api_idempotency_keys` | yes | key, request hash, response, `expires_at` (24 h) |
| `audit_logs` | yes | hashed core row, opaque IDs only (D-5) |
| `audit_log_details` | yes | redactable human-readable details (emails, IP, user agent) |
| `audit_checkpoints` | yes | written by purge; anchors the remaining chain |
| `platform_audit_logs` | platform only | not visible to `app_user` tenant queries |
| job queue tables | n/a | created by the chosen queue library (ADR-0009, T-4) |

Conventions: UUIDv7 IDs (D-3), `created_at`/`updated_at` with trigger (DB-6), `text` + `check` for statuses (DB-8), `ON DELETE RESTRICT` by default (DB-10), every tenant index leads with `organization_id` (DB-2).

**Database roles:** `schoolos_owner` (migrations), `app_user` (runtime, no `BYPASSRLS`, not owner), `audit_maintainer` (retention purge only; not used in M1 runtime but created and tested), `app_worker` if the worker needs narrower grants than `app_user`.

### 3.6 Row-level security

**Context functions** (in an `app` schema, `STABLE`):

```sql
-- Illustrative. Final SQL is written and reviewed in step 2.
create function app.current_org_id() returns uuid language sql stable
  as $$ select nullif(current_setting('app.current_org_id', true), '')::uuid $$;
create function app.current_user_id() returns uuid language sql stable
  as $$ select nullif(current_setting('app.current_user_id', true), '')::uuid $$;
```

**Policy patterns:**

| Table class | Policy |
| --- | --- |
| Standard tenant tables | `using / with check (organization_id = (select app.current_org_id()))` |
| `organizations` | `using (id = (select app.current_org_id()))`; plus bootstrap `select` where a membership exists for `app.current_user_id()` (S-1) |
| `memberships` | tenant policy; plus bootstrap `select` where `user_id = (select app.current_user_id())` (S-1) |
| `users` | `select` self, or users with a membership in the current org (S-2); `update` self only for profile fields |
| `roles`, `role_permissions` | `select` where `organization_id is null or organization_id = current org` (S-2) |
| `permissions` | `select` for all; no writes |
| `audit_logs`, `audit_log_details` | tenant `select`/`insert` only for `app_user`; no `update`/`delete` grants |
| `platform_audit_logs` | no access for `app_user` |

All tenant tables use `enable` **and** `force row level security`. Missing context matches no rows (fail closed).

**Transaction wrappers** (the only way to query):
- `withTenant({ orgId, userId }, fn)`: `BEGIN; SET LOCAL app.current_org_id; SET LOCAL app.current_user_id; fn; COMMIT`
- `withUser({ userId }, fn)`: pre-tenant bootstrap queries only
- `withSystem({ orgId, job }, fn)`: worker jobs; sets `actor_type=system` for audit (S-3)
- Org enumeration for schedulers goes through one `SECURITY DEFINER` function returning IDs only, owned by a restricted role (S-3)
- Session-level `SET` is banned by lint and code review (ADR-0003)

### 3.7 Audit logging (D-5)

- **Events in M1:** sign-in success/failure, MFA enroll/verify/reset, session revoked, org created/updated, school created/updated/archived, invitation created/revoked/accepted/expired, membership role/scope changed, suspended, removed, permission denied on sensitive actions, audit viewed in bulk, audit exported, chain verification result.
- **Core row (hashed):** `organization_id`, `seq`, `occurred_at`, `actor_type`, `actor_id` (opaque), `action`, `target_type`, `target_id`, `outcome`, `correlation_id`, `details_id`, `prev_hash`, `hash`.
- **Details row (not hashed, redactable):** email, IP, user agent, human-readable metadata. Retention and data-subject deletion redact here without touching the chain (C-2).
- **Write path:** `writeAudit(tx, event)` takes a per-org advisory lock, reads the last `seq`/`hash`, and inserts. Called at the end of the domain transaction for successes; in a separate transaction for denials and errors (S-12).
- **Canonicalization:** a documented, versioned canonical serialization (field order, timestamp format, null handling) with `hash_version` stored per row.
- **Verification job:** worker job re-computes the chain from the latest checkpoint daily (and on demand in tests), writes the result to `platform_audit_logs`, and alerts on mismatch.
- **Purge (C-1):** implemented and tested in M1 but scheduled only from M5; deletes only contiguous prefixes older than retention, writes `audit_checkpoints` first.
- **API:** `GET /api/v1/orgs/{orgId}/audit-logs` (filters, cursor pagination), `GET .../audit-logs/export` (CSV, step-up, itself audited).

### 3.8 API surface (M1)

| Method and path | Permission | Scope |
| --- | --- | --- |
| `GET /api/v1/health` | none (no data) | public |
| `GET /api/v1/me` | authenticated | user |
| `GET /api/v1/me/organizations` | authenticated | user |
| `GET /api/v1/orgs/{orgId}` | `org.read` | org |
| `PATCH /api/v1/orgs/{orgId}` | `org.update` | org |
| `GET /api/v1/orgs/{orgId}/schools` | `school.read` | org (scoped) |
| `POST /api/v1/orgs/{orgId}/schools` | `school.manage` | org |
| `PATCH /api/v1/orgs/{orgId}/schools/{schoolId}` | `school.manage` | org |
| `GET /api/v1/orgs/{orgId}/members` | `member.read` | org (scoped) |
| `PATCH /api/v1/orgs/{orgId}/members/{membershipId}` | `member.manage` + step-up | org |
| `DELETE /api/v1/orgs/{orgId}/members/{membershipId}` | `member.manage` + step-up | org |
| `GET /api/v1/orgs/{orgId}/invitations` | `member.invite` | org |
| `POST /api/v1/orgs/{orgId}/invitations` | `member.invite` | org |
| `DELETE /api/v1/orgs/{orgId}/invitations/{invitationId}` | `member.invite` | org |
| `POST /api/v1/invitations/accept` | authenticated, email match | user |
| `GET /api/v1/orgs/{orgId}/roles` | `role.read` | org |
| `GET /api/v1/orgs/{orgId}/audit-logs` | `audit.read` | org |
| `GET /api/v1/orgs/{orgId}/audit-logs/export` | `audit.export` + step-up | org |

The OpenAPI document is generated from route schemas and committed; CI fails if it's stale.

**Minimal UI:** sign-in and MFA enrollment, org picker, org overview, schools, members and invitations, audit log viewer. Demo orgs (`is_demo`) show the "Simulated data" banner from day one (ADR-0010), even though M1 has no device data.

### 3.9 Automated tenant-isolation tests

Run against real PostgreSQL in Docker, same major version as production (TST-7).

| Suite | What it proves |
| --- | --- |
| **RLS coverage** (TST-1) | Every table in app schemas has RLS enabled and forced, with at least one policy, except an explicit allow-list (`permissions`). |
| **Table isolation** | For every tenant table: as Org A insert; as Org B `select`/`update`/`delete` affects 0 rows; `insert` with Org A's `organization_id` under Org B context fails `with check`. |
| **No-context** | Every tenant table returns 0 rows with no `app.current_org_id`. |
| **Composite FK** | Child rows can't reference another org's parent. |
| **Route isolation** (TST-2) | For every registered route: Org A user calling with Org B's `orgId` or a resource ID from Org B gets `404`; no Org B data appears in any response body. A route missing from the harness fails CI. |
| **Permission matrix** (TST-4) | Each role × permission × endpoint returns allowed or denied as the matrix specifies; code matrix equals seeded rows. |
| **School scope** | `school_admin` scoped to School 1 can't read members scoped only to School 2. |
| **Pool leakage** (TST-3) | Hundreds of interleaved concurrent transactions for two orgs on a shared pool never cross-read. Repeated against the chosen production pooler before staging sign-off (A-4). |
| **Audit integrity** (TST-5) | `update`/`delete` as `app_user` fail; tampering with any hashed field is detected; purge + checkpoint still verifies. |
| **Escalation** | Inviter can't grant higher permissions; last owner can't be removed; self-approval paths don't exist. |
| **Auth gating** | MFA-required roles get `403` on org routes until MFA is verified; fake auth refused outside test/local (TST-8). |
| **Hygiene** (TST-9) | Security headers present; log capture contains no seeded PII or secrets. |
| **E2E smoke** (TST-10) | Invite → sign up → MFA → land in org → attempt cross-org URL → `404`. |

Test data is synthetic only. Factories generate obviously fake names and emails on a reserved domain (e.g. `example.test`).

### 3.10 Environments

| Environment | Database | Auth | Purpose | Data |
| --- | --- | --- | --- | --- |
| `local` | Docker Compose Postgres (pinned major version) | Fake adapter or local Supabase stack (decided in step 3) | Development | Synthetic |
| `test` (CI) | Ephemeral Docker Postgres per job | Fake adapter + Supabase adapter contract tests (against local stack) | Automated tests | Synthetic |
| `dev` | Managed Postgres in the company cloud account | Supabase project `schoolos-dev` | Shared integration | Synthetic |
| `staging` | Managed Postgres, production-like config (TLS, backups, private network) | Supabase project `schoolos-staging` | Pre-production | Synthetic |

- `dev` and `staging` are in company-owned accounts, separate from each other and from any developer's home server (ADR-0011). No customer data in either.
- Infrastructure as code for `dev` and `staging` (tool chosen with T-1).
- Secrets come from the cloud provider's secrets manager; nothing in the repo or CI logs.
- CI/CD: PRs run type check, lint, unit, integration, isolation, E2E, secret scan, dependency scan, and the migration test (TST-6). Merges to `main` deploy to `dev` automatically. `staging` deploys need manual approval.
- Migrations run in the pipeline as `schoolos_owner`. The app never runs migrations at startup.
- Observability baseline: structured logs with `correlation_id` and `organization_id`, redaction (S-15), error tracking configured to exclude request bodies.

## 4. Implementation sequence

Each step is one or a few reviewable PRs, with an exit check. Don't start a step until its blocking decisions are ratified.

| Step | Work | Blocking decisions | Exit check |
| --- | --- | --- | --- |
| **0** | Write ADR-0012 to ADR-0017 (Proposed), time-boxed spikes for D-4 (migration/query tool) and T-12 (Supabase capabilities, local stack) | — | ADRs reviewed; spike findings recorded |
| **1** | Foundation: Next.js + TS strict, lint with import boundaries, formatter, test runner, Docker Compose Postgres, config validation, logger with redaction, CI pipeline (type, lint, unit, secret scan, dependency scan) | D-1 | CI green on an empty app; `/api/v1/health` returns 200 |
| **2** | Database baseline: DB roles, `app` schema and context functions, migration tooling, `withTenant`/`withUser`/`withSystem`, the RLS coverage test (TST-1), no-context test, migration test (TST-6) | D-2, D-3, D-4 | Coverage test fails on a deliberately unprotected table and passes once RLS is added |
| **3** | Identity: `users`, `AuthProvider`, fake adapter + startup guard (TST-8), Supabase adapter, sign-in, MFA, session model, step-up, rate limiting, security headers, CSRF/origin check | D-8 | Sign-in + MFA works locally; auth gating tests pass |
| **4** | Tenancy core: `organizations`, `organization_settings`, `schools`, operator CLI, route wrapper with org resolution, `/me`, `/me/organizations`, org and school endpoints, route-isolation harness (TST-2) | D-6 | Table + route isolation suites pass for these tables and routes |
| **5** | RBAC: `permissions`, `roles`, `role_permissions` seeds, `memberships`, `membership_school_scopes`, `authorize()`, permission matrix tests (TST-4), school-scope tests | — | Matrix tests pass; route harness covers every route |
| **6** | Audit: `audit_logs`, `audit_log_details`, `audit_checkpoints`, `platform_audit_logs`, `writeAudit`, wiring into the route wrapper and steps 3–5 actions, verification job in the worker, audit read/export endpoints, integrity tests (TST-5) | D-5 | Every M1 action produces an audit row; tamper test detects changes; chain verifies after purge test |
| **7** | Members and invitations: invitation lifecycle, accept flow, role/scope change, suspend/remove, last-owner and escalation protections, API idempotency cache | — | Escalation and invitation tests pass |
| **8** | Minimal UI and E2E: sign-in, MFA, org picker, schools, members/invitations, audit viewer, demo banner; E2E smoke (TST-10); OpenAPI generation | — | E2E green in CI |
| **9** | Hardening: pool-leak concurrency test (TST-3), audit throughput check (A-6, target 50 audited writes/s per org), log redaction test, header test, threat-model review of the M1 surface | — | All suites green; threat-model review recorded |
| **10** | Environments: IaC for `dev` and `staging`, secrets manager, pipeline deploys, TST-3 against the real pooler, staging smoke | T-1, T-6 | Staging deployed by pipeline only; isolation suite passes against staging DB |

Steps 1–9 can be completed entirely on `local` + CI. Only step 10 depends on the cloud provider decision.

## 5. M1 definition of done

All of the following must be met (they extend the M1 criteria in ROADMAP):

- [ ] ADR-0012 to ADR-0017 accepted.
- [ ] Every tenant table has forced RLS (TST-1 green).
- [ ] Cross-tenant table and route suites pass for every table and route (TST-2 green).
- [ ] No-context queries return zero rows.
- [ ] Audit `update`/`delete` blocked for `app_user`; chain verification and tamper detection pass.
- [ ] Permission matrix tests pass; code and seed matrices match.
- [ ] MFA enforced server-side for admin roles; fake auth can't run outside test/local.
- [ ] Pool-leak test passes against the production pooler.
- [ ] Staging deployed via pipeline, not manually; no secrets in repo or logs.
- [ ] Threat model reviewed for the M1 surface; readiness review items marked "M1" closed or re-scoped with a documented reason.
- [ ] Coverage ≥ 80% for `src/platform/authz`, `src/platform/db`, `src/platform/audit` (NFR-11).
- [ ] Docs updated where implementation diverged from design (with ADRs where required).

## 6. M1 risks

| Risk | Mitigation |
| --- | --- |
| Supabase lacks a capability we assumed (MFA level, step-up, timeouts) | Step 0 spike; fallback to a SchoolOS session layer (D-8) |
| Query library makes it easy to bypass `withTenant` | Lint rule: no DB client imports outside `src/platform/db`; code review checklist |
| RLS performance surprises | `STABLE` context functions, leading `organization_id` indexes, `EXPLAIN` checks in step 9 |
| Audit lock contention | Throughput check in step 9; revisit design if below target |
| Cloud provider decision slips | Steps 1–9 don't depend on it |
| Scope creep into M2 (devices, Google) | Out-of-scope list in §1; reviewers reject provider code in M1 PRs |
