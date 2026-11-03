# ADR-0016: Session model — Supabase Auth for identity and TOTP, SchoolOS-authoritative server-side sessions

- **Status:** Proposed. Requirements in "Fixed requirements" are binding now. The Supabase integration flow becomes Accepted only after the spike below passes.
- **Date:** 2026-11-02
- **Deciders:** Founding engineering team
- **Related:** ADR-0004, ADR-0013, ADR-0015; SECURITY_MODEL §5; ARCHITECTURE_READINESS_REVIEW D-8, A-1–A-3, S-5, S-10; OPEN_QUESTIONS T-12

## Context

We need staff authentication with TOTP MFA, but session lifetime, inactivity timeout, step-up, and revocation must not depend on Supabase plan-level settings. Authentication tokens must not be exposed to browser JavaScript.

Verified from Supabase documentation (2026-11-02):
- Supabase Auth supports TOTP MFA. Access tokens carry an `aal` claim (`aal1`/`aal2`) and an `amr` array of `{method, timestamp}` entries, most recent first, including `totp`. <https://supabase.com/docs/guides/auth/auth-mfa>
- Access-token claims include `iss` (`https://<project-ref>.supabase.co/auth/v1`), `aud` (`authenticated`), `exp`, `iat`, `sub`, `role`, `aal`, `session_id`. <https://supabase.com/docs/guides/auth/jwt-fields>
- Asymmetric signing keys (ES256 recommended, RS256 available) are published at `https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json`. HS256 shared secrets are "not recommended for production". <https://supabase.com/docs/guides/auth/signing-keys>
- After a factor is unenrolled, `aal` drops from `aal2` to `aal1` only after token refresh (auth-mfa docs).

## Fixed requirements (binding now)

1. **Supabase Auth authenticates identity** (email + password) **and TOTP MFA**. SchoolOS owns everything else.
2. **SchoolOS keeps the authoritative session record** (`user_sessions`) and enforces, independently of Supabase:
   - **idle timeout 30 minutes**;
   - **absolute lifetime 12 hours**;
   - organizations may configure **stricter** (shorter) values only, applied when that org's routes are accessed;
   - **revocation** (sign-out, forced sign-out by an admin, password or MFA reset, user suspension, incident response).
3. **TOTP MFA is required for privileged organization roles:** `org_owner`, `org_admin`, `school_admin`, `technician`, `security_analyst`. It is configurable to required for `auditor`. Enforced server-side before any org-scoped request.
4. **Fresh MFA for sensitive administrative operations:** a successful TOTP verification within the last **5 minutes** is required for role or scope changes, member removal, MFA reset of another user, audit or data export, integration management, approving destructive commands, and starting remote access.
5. **Never trust client-side role claims.** The Supabase `role` claim (`authenticated`), `app_metadata`, and `user_metadata` are never used for SchoolOS authorization. Authorization comes from SchoolOS tables per request (ADR-0015).
6. **Server-side JWT verification** whenever SchoolOS receives a Supabase token:
   - signature verified against the project JWKS, with an allow-list of asymmetric algorithms (`ES256`, `RS256`). `HS256` and `none` are rejected;
   - `kid` must be present in the JWKS; JWKS cached with bounded TTL and refreshed on unknown `kid`;
   - `iss` equals the configured project issuer exactly;
   - `aud` contains `authenticated`;
   - `exp` in the future, `iat`/`nbf` not in the future (≤ 60 s clock skew);
   - `sub` present and matches the expected user on refresh or MFA flows;
   - `aal` and `amr` read only from a verified token.
7. **No authentication tokens in browser storage.** No `localStorage`, `sessionStorage`, IndexedDB, or JavaScript-readable cookies. The browser holds only an opaque SchoolOS session cookie.
8. All security-relevant session events are audited: sign-in success/failure, MFA enroll/verify/fail/reset, step-up, sign-out, forced revocation, expiry.

## Secure server-side token and session handling (design)

**Cookie:** `__Host-schoolos_session`: 256-bit random value, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, no `Domain`. Only `SHA-256(cookie value)` is stored server-side.

**Sign-in:**
1. The browser posts credentials to a SchoolOS server route (same origin, CSRF/origin-checked; review S-10). The browser does not talk to Supabase Auth directly.
2. The server calls Supabase Auth, receives access and refresh tokens, and verifies the access token (requirement 6).
3. The server finds or creates the `users` row by `auth_subject = sub`.
4. The server creates a `user_sessions` row: `id`, `user_id`, `session_token_hash`, `supabase_session_id`, `aal`, `authenticated_at`, `mfa_verified_at` (from the verified `amr` `totp` timestamp, else NULL), `step_up_at`, `created_at`, `last_seen_at`, `idle_expires_at`, `absolute_expires_at`, `revoked_at`, `revoked_reason`, `ip_hash`, `user_agent_summary`.
5. Supabase refresh and access tokens, needed for later MFA and step-up calls, are stored **server-side only**, envelope-encrypted with a KMS key (SECURITY_MODEL §7), in a separate `user_session_credentials` table readable only by the auth module's DB role. They're deleted on revocation or expiry.
6. The server sets the session cookie and redirects. Users with privileged memberships are sent to MFA enrollment or challenge before any org route.

**Each request:** look up the session by cookie hash, then reject if revoked, idle-expired, or absolute-expired. Apply stricter org limits for org routes, and require `mfa_verified_at` for privileged memberships. Update `last_seen_at` and `idle_expires_at` (throttled, at most once per minute). Supabase is not called on ordinary requests; the SchoolOS session is authoritative.

**MFA enrollment, challenge, and step-up:** performed by server routes using the stored Supabase tokens. On success the new access token is verified (requirement 6), and `aal`, `mfa_verified_at`, and `step_up_at` are updated from its `amr` `totp` timestamp. Because `aal` may lag after unenrollment, **unenrolling a factor revokes all of the user's SchoolOS sessions**.

**Revocation:** sets `revoked_at` on SchoolOS sessions (immediate effect), deletes stored Supabase credentials, and asks Supabase to end the session where the API supports it (spike item 5).

**Rotation:** the session cookie value is rotated on sign-in, MFA verification, and step-up to prevent session fixation.

## Compatibility spike (time-boxed: 2 working days, against a non-production Supabase project)

All must pass for this ADR to be Accepted:
1. Password sign-in can be performed **server-side** and returns tokens to the server without exposing them to the browser.
2. TOTP enroll, challenge, and verify can be performed server-side on behalf of the signed-in user. The resulting access token has `aal = aal2` and an `amr` entry with `method = totp` and a timestamp.
3. Tokens verify locally against the project JWKS with an asymmetric key (ES256), and the `iss`/`aud` values match the documented formats.
4. Refresh works server-side; refresh after a user is disabled or signed out in Supabase fails as expected.
5. A server-side API exists to end a user's Supabase session(s), or the absence of one is documented (SchoolOS revocation remains authoritative either way).
6. The Supabase project's Data API can be disabled or restricted so that no schema is exposed (ADR-0013).
7. Local development and CI approach chosen: a local Supabase stack, a dedicated dev project, or the test-only fake adapter (which must be refused outside test/local; review TST-8).

## Consequences

- SchoolOS operates a session table and encrypted credential storage. That's more code, but it gives independent control over timeouts and revocation.
- Switching IdPs later only replaces the sign-in and MFA calls; the session model stays.

## Verification

Spike results recorded here. M1 tests: idle and absolute expiry, revocation effect on next request, MFA gating for privileged roles, step-up window, JWT rejection cases (wrong `iss`, wrong `aud`, expired, `HS256`/`none`, unknown `kid`, tampered payload), and a browser test confirming no tokens are present in Web Storage or JavaScript-readable cookies.
