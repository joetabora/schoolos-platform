# ADR-0004: Supabase Auth behind an internal interface; SchoolOS owns authorization

- **Status:** Proposed
- **Date:** 2026-11-02
- **Related:** SYSTEM_ARCHITECTURE §7, OPEN_QUESTIONS T-2, T-3

## Context

We need staff authentication with MFA quickly, without building password storage ourselves, and without locking the product into one vendor.

## Decision

- Use Supabase Auth initially for staff identity (sessions, MFA, optional OIDC).
- Access it only through an internal `AuthProvider` interface (`verifySession`, `getUser`, `revokeSessions`).
- Store users, memberships, roles, and permissions in SchoolOS tables. Do not store authorization data in IdP metadata.
- Do not use Supabase's client-side data access APIs; all data access goes through our server and our authorization layer.
- Store IdP subject as `users.auth_subject` to allow migration.

## Alternatives considered

| Option | Pros | Cons |
| --- | --- | --- |
| Build our own auth | Full control | High risk, slow |
| Other managed IdPs (Auth0, Clerk, WorkOS, Cognito) | Mature enterprise SSO in some | Cost/lock-in profiles differ; evaluate in M0 |
| Supabase Auth behind interface (chosen) | Fast start, OIDC/MFA support, replaceable | Confirm hosting/data-residency/sub-processor fit (T-2) |

## Consequences

- Swapping IdPs requires implementing the interface and a user migration, not a rewrite of authorization.
- District SSO (SAML/OIDC) needs may favour another provider later; the interface accommodates that.

## Verification

No module outside `src/platform/auth` imports the Supabase SDK (lint rule).
