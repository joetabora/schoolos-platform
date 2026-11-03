# ADR-0015: Organization is explicit in URL paths; membership and permissions verified per request

- **Status:** Accepted
- **Date:** 2026-11-02
- **Deciders:** Founding engineering team
- **Related:** FR-ORG-3, ADR-0003, ARCHITECTURE_READINESS_REVIEW D-6, S-7, S-13

## Context

Users can belong to multiple organizations (FR-ORG-3). Keeping an implicit "current organization" in session state invites confused-deputy bugs (a request acting on the wrong tenant) and makes links ambiguous.

## Decision

- The organization is **explicit in every org-scoped URL**:
  - UI: `/o/{orgSlug}/...`
  - API: `/api/v1/orgs/{orgId}/...`
- No "current organization" is stored in the session, cookies, or the browser for authorization purposes. A "last used org" preference may only affect which page the user lands on.
- On **every** request the server:
  1. authenticates the SchoolOS session (ADR-0016);
  2. resolves the organization from the path;
  3. loads the user's **active** membership for that organization from the database;
  4. evaluates `authorize()` for the route's declared permission and any school scope;
  5. opens `withTenant({ orgId, userId })` for all queries.
- Roles and permissions are never read from tokens or client-supplied data. Membership changes take effect on the next request.
- If the user has no active membership in the requested org, or the resource belongs to another org, the response is `404` (review S-13).
- Resource IDs in the path are always also checked against the org in the path (by RLS and by the repository query).

## Consequences

- One extra membership lookup per request. It's indexed by `(organization_id, user_id)` and acceptable at MVP scale.
- URLs are shareable and unambiguous within an organization.

## Verification

Route-isolation harness (review TST-2): every org-scoped route is called with another org's `orgId` and with resource IDs from another org, and must return `404` with no foreign data.
