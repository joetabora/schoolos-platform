# M1 Step 1 — Independent security and architecture review

- **Subject:** `feature/m1-application-foundation` (uncommitted work on top of `540b571`)
- **Date:** 2026-11-02
- **Reviewer:** Independent audit of the implementation as it exists in the working tree
- **Method:** Source inspection, ESLint `--print-config` on representative files, redaction-regex evaluation, GitHub Actions tag SHA verification, and Node.js 26.13.0 distribution checks. No application files were modified. Dependencies were not installed. Remote CI has not been run.
- **Remediation:** 2026-11-02. H-1, H-2, and M-1 were corrected on `feature/m1-application-foundation`. Original findings below are unchanged. See [Remediation results](#remediation-results).

## Review scope

In scope:

1. Environment and configuration security (`src/platform/config/env.ts`, `public-env.ts`, `instrumentation.ts`, `.env.example`, `.gitignore`, `next.config.ts`)
2. Fake-authentication guards and UI claims
3. HTTP security headers and the health endpoint
4. Logging, redaction, worker failure handling, and public error exposure
5. ESLint import boundaries and client/server separation
6. Toolchain pinning and the documented pnpm install path
7. GitHub Actions CI
8. The 13 existing unit tests

Out of scope: M1 Step 2 (database, RLS, tenancy), authentication implementation, remote CI execution, and any code changes.

## Verified controls

These checks passed and are not repeated as findings.

- `AUTH_PROVIDER` is required. There is no default and no fallback from `supabase` to `fake` (`env.ts:120`, `env.ts:61-65`).
- `AUTH_PROVIDER=fake` is rejected unless `APP_ENV` is `local` or `test` (`env.ts:55-60`). Staging and production application environments cannot enable fake auth by setting `NODE_ENV=production` or by running `next build`.
- The homepage states that this install does not authenticate, isolate organizations, inventory devices, or enforce policy (`app/page.tsx:18-21`). The status page labels the adapter `fake (not connected)` (`app/status/page.tsx:39-40`).
- `.env` and `.env.*` are gitignored, with only `.env.example` re-included (`.gitignore:26-28`). `.env.example` contains no credentials.
- Production CSP does not include `unsafe-eval`. `X-Frame-Options: DENY` matches `frame-ancestors 'none'`. `X-Content-Type-Options: nosniff` is set. `Referrer-Policy` is `strict-origin-when-cross-origin`.
- `GET /api/v1/health` returns only `{ status: "ok", service: "schoolos-web" }`.
- `env.ts` imports `node:fs`, so a client component that imported `getServerEnv` would fail the Next.js client compile. The only `"use client"` module is `src/components/ui/button.tsx`, and it does not import server config or logging.
- Direct dependencies in `package.json` are exact (no `^` / `~`). `engines` and `packageManager` pin Node 26.13.0 and pnpm 12.16.1. CI uses those same versions. Action SHAs match the intended tags (see §CI).
- Worker startup is synchronous. A `ConfigurationError` is an uncaught exception and yields a nonzero process exit. There is no `try/catch` that swallows failure.

## Findings

### Critical

None.

### High

#### H-1. ESLint import-boundary rules for UI and domain modules are overridden

- **Where:** `eslint.config.mjs:30-75`
- **Evidence:** ESLint 9 flat config does not merge `no-restricted-imports` options across blocks. The last matching block replaces the whole rule. `eslint --print-config app/page.tsx`, `src/components/ui/button.tsx`, and `src/modules/organizations/service.ts` all resolve to only the `pg` / `kysely` / `@supabase/*` path list from the catch-all block (`eslint.config.mjs:64-75`).
- **Effect:**
  - The UI rule forbidding `@/platform/config/env`, `@/platform/log/**`, and `@/platform/db/**` (`eslint.config.mjs:46-62`) is not in force.
  - The domain-module rule forbidding `src/providers/**` (`eslint.config.mjs:30-44`) is not in force.
  - Relative imports such as `../../platform/config/env` would not have matched the `@/` pattern even if the UI block were active.
  - `pg` / `kysely` / Supabase restrictions still apply everywhere except `src/platform/db/**`, which is the intended allow-list for database imports.
- **Compensating control:** `env.ts` and `logger.ts` pull in `node:fs`, so they cannot currently ship in a browser bundle. Provider folders do not exist yet.
- **Blocks approval:** Yes. Step 1 claims these gates are active (`docs/DEVELOPMENT.md:127-132`). Merge should wait until `eslint --print-config` on a UI file shows the env/log/db patterns and on a module file shows the provider pattern.
- **Correction:** Give every file-specific block a complete `no-restricted-imports` option object (paths plus patterns). Put the most specific blocks after the catch-all, or drop the catch-all and attach the package bans to each block. Add a lint fixture that imports `@/platform/config/env` from `src/components` and `@/providers/google` from `src/modules` and must fail.

#### H-2. Log redaction misses connection strings and session identifiers

- **Where:** `src/platform/log/logger.ts:2-3`, `redactValue` at `logger.ts:19-29`
- **Regex:** `/pass(word)?|secret|token|authorization|cookie|credential|private[_-]?key|api[_-]?key/i`
- **Evaluated keys that are not redacted:** `DATABASE_URL`, `databaseUrl`, `connectionString`, `postgresUri`, `dsn`, `sessionId`, `session_id`, `session`, `sid`, `jwt`, `bearer`.
- **Covered:** `password`, `access_token` / `refresh_token` / `accessToken`, `authorization`, `cookie` / `set-cookie`, `api_key` / `apiKey`, `client_secret`, `private_key`. Nested objects whose keys match are redacted (`tests/unit/logger.test.ts:4-19`). Array elements whose index is the key (`"0"`, `"1"`) are not redacted unless a parent key already matched.
- **Redaction is key-based only.** A field named `message` or `detail` that contains `postgres://…` is logged in full. `Error` objects contribute no enumerable `message`/`stack`, so `logger.error("x", { err })` stores `{}` for `err` rather than a stack, which is fail-safe for that shape only.
- **Blocks approval:** Yes for this PR. Step 1 is where the logger is introduced; Step 2 will add `DATABASE_URL`. The current suite would not catch a logged connection string.
- **Correction:** Extend the key pattern with `database`, `connectionstring`, `dsn`, `session`, and `jwt` (or an explicit allow/deny list of field names). Recurse into array values with a non-index key context. Add tests for `DATABASE_URL`, `sessionId`, nested arrays, and `{ message: "postgres://user:pass@host/db" }` so the intended value-scanning policy is explicit. Do not log raw `error.stack` on request paths.

### Medium

#### M-1. DEVELOPMENT.md documents Corepack as if it shipped with Node 26.13.0

- **Where:** `docs/DEVELOPMENT.md:30-37`
- **Fact:** Corepack is not distributed from Node.js 25 onward ([Node.js Corepack docs](https://nodejs.org/docs/latest-v25.x/api/corepack.html); [distribution policy](https://github.com/nodejs/node/blob/main/doc/contributing/distribution.md)). A clean Node 26.13.0 prefix has no `corepack` executable. On this machine `node` is `/…/node/v26.13.0/bin/node` and `corepack` resolves to `/…/node/v22.22.0/bin/corepack` — leftover PATH contamination, not a Node 26 feature. `ls $NVM_DIR/versions/node/v26.13.0/bin/corepack` does not exist.
- **CI is not affected.** `.github/workflows/ci.yml:28-31` installs pnpm 12.16.1 via `pnpm/action-setup`.
- **Blocks approval:** No for runtime security. Yes for claiming the development guide is accurate. Fix the guide in this PR.
- **Correction:** Do not tell developers to run `corepack enable` on a stock Node 26.13.0. Use one of:

  ```bash
  nvm install
  nvm use
  npm install -g pnpm@12.16.1
  pnpm --version   # 12.16.1
  node --version   # v26.13.0
  ```

  Optional, if the team wants Corepack to honor `package.json#packageManager`:

  ```bash
  npm install -g corepack@0.36.0
  corepack enable
  corepack prepare pnpm@12.16.1 --activate
  ```

  `engine-strict=true` in `.npmrc` will still reject any other pnpm version.

#### M-2. Production CSP allows `script-src 'unsafe-inline'`

- **Where:** `src/platform/security/headers.ts:19-21, 34-36`
- **Why it exists:** Next.js App Router historically needs inline scripts unless a nonce pipeline is wired.
- **Risk:** XSS in a later authenticated UI can run inline script. There is no session cookie yet, so the current blast radius is low.
- **Blocks approval:** No for Step 1. Must be revisited before Step 3 (cookies, CSRF).
- **Correction:** Before sessions exist, move to nonce- or hash-based `script-src` and drop `unsafe-inline` for scripts. Keep `unsafe-inline` for styles only if still required.

#### M-3. Tests do not lock the `APP_ENV` vs `NODE_ENV` distinction

- **Where:** `tests/unit/env.test.ts:49-65`
- **Gap:** Rejection tests spread `localSource` (`NODE_ENV: "development"`) and only change `APP_ENV`. There is no test that `NODE_ENV=production`, `APP_ENV=local`, `AUTH_PROVIDER=fake` is allowed — the reason the guard is not on `NODE_ENV`. There is no test that `NODE_ENV=production`, `APP_ENV=production`, `AUTH_PROVIDER=fake` is rejected.
- **Blocks approval:** No. The implementation is correct (`env.ts:51-59`). Add the two cases when touching this file for H-2 / H-1.
- **Correction:** Add those two `loadServerEnv` cases so a future refactor cannot re-bind the guard to `NODE_ENV` and break `next build`.

#### M-4. Unauthenticated `/status` discloses `APP_ENV` and the auth adapter name

- **Where:** `app/status/page.tsx:12-40`
- **Payload:** `local` / `test` / etc. and `fake (not connected)`. Not a secret, but it is environment classification on a public page.
- **Blocks approval:** No for a local foundation. Do not expose this page on a networked `dev`/`staging` host without auth.
- **Correction:** Before any non-local deploy, require a session or restrict the route to the health JSON.

#### M-5. No application-level HTTP error mapper

- **Where:** `app/api/v1/health/route.ts:7-9`; no `app/error.tsx` or `app/global-error.tsx`
- **Behavior:** `getServerEnv()` throws `ConfigurationError` if validation fails. Instrumentation (`instrumentation.ts:9-12`) should fail the process first on the Node runtime. If a request still throws, Next.js production typically returns a generic 500; development shows stacks. `ConfigurationError` messages name the variable and allowed enum values (`env.ts:40-47`). `JSON.stringify(value)` of a malformed enum could echo a value that someone stuffed into `APP_ENV` / `AUTH_PROVIDER`. Other env vars (including `DATABASE_URL`) are not interpolated.
- **Blocks approval:** No for the current single health route.
- **Correction:** Before user-facing APIs, add a route wrapper that maps unknown errors to a generic body and logs the rest through `redactFields`. Do not send `error.stack` to clients.

### Low

#### L-1. Development CSP exception is keyed on `NODE_ENV`, not `APP_ENV`

- **Where:** `next.config.ts:13`
- **Detail:** `getSecurityHeaders({ isDevelopment: process.env.NODE_ENV === "development" })`. `next dev` sets `NODE_ENV=development`; `next build` / `next start` set `production`. A process started as `NODE_ENV=development` against a production dataset would serve `unsafe-eval`. That is not the supported start path.
- **Blocks approval:** No.
- **Correction:** None required for Step 1. Keep using Next’s process flag, not `APP_ENV`, for this header.

#### L-2. Instrumentation skips validation on the Edge runtime

- **Where:** `instrumentation.ts:5-7`
- **Detail:** If `NEXT_RUNTIME === "edge"`, env is not loaded. No Edge routes or middleware exist. A future Edge middleware could serve traffic without this fail-fast hook. Route handlers that call `getServerEnv()` would still throw.
- **Blocks approval:** No.
- **Correction:** When Edge is introduced, validate a public subset there or forbid Edge for tenant routes.

#### L-3. UI restriction would not cover `src/lib/**` even after H-1 is fixed

- **Where:** `eslint.config.mjs:47` (files list)
- **Detail:** `src/lib/utils.ts` is imported by the client `Button`. A later `src/lib` helper that imported `env.ts` would be a client-bundle footgun. `node:fs` would still break the client build today.
- **Blocks approval:** No.
- **Correction:** Include `src/lib/**` and future `src/hooks/**` in the UI restriction set when fixing H-1.

#### L-4. `src/platform/db/**` is ignored from the catch-all rule block

- **Where:** `eslint.config.mjs:66`
- **Detail:** That ignore is how `pg` is allowed. It also means this block’s extra `@typescript-eslint/no-explicit-any` does not apply there. `eslint-config-next/typescript` still reports `any` as error on a hypothetical `src/platform/db/pool.ts`.
- **Blocks approval:** No. Folder does not exist yet.
- **Correction:** When adding `src/platform/db`, keep `no-explicit-any` on those files explicitly.

#### L-5. Checkout leaves `persist-credentials` at the default (`true`)

- **Where:** `.github/workflows/ci.yml:25-26`
- **Detail:** `permissions.contents` is `read`, and the workflow does not use `pull_request_target` or repository secrets. Residual token exposure to PR code is limited to read access.
- **Blocks approval:** No.
- **Correction:** Set `persist-credentials: false` on `actions/checkout` when convenient.

### Informational

#### I-1. Headers that are not warranted yet

Do not add these solely to lengthen a checklist.

| Header | Verdict |
| --- | --- |
| `Strict-Transport-Security` | Add only on HTTPS at deploy time (Step 10). Harmful on local HTTP if mis-set with a long `max-age`. |
| `object-src 'none'` | Tightening; `default-src 'self'` already covers `<object>`. Optional later. |
| `Cross-Origin-Opener-Policy` / `Cross-Origin-Resource-Policy` | Useful with cookies; not needed for this static shell. |
| `X-XSS-Protection` | Obsolete. Do not add. |
| Permissions-Policy extras (`display-capture`, `browsing-topics`) | Optional. Current camera/microphone/geolocation/usb/payment disables are appropriate. |

#### I-2. This foundation cannot boot `APP_ENV=staging` or `production`

Fake is forbidden there and `supabase` is rejected as unimplemented (`env.ts:55-65`). That is correct for Step 1. Operators must not expect a production `APP_ENV` start until Step 3.

#### I-3. `APP_ENV=local AUTH_PROVIDER=fake` on a public host would boot

The guard is the configured application environment, not “are we on AWS.” Deployment must set `APP_ENV` correctly. There is no cloud control plane in this step.

#### I-4. Next.js inlines any referenced `NEXT_PUBLIC_*` variable

`getPublicEnv` (`public-env.ts:9-13`) reads only `NEXT_PUBLIC_APP_NAME`. That is an application allowlist, not a Next.js embedder allowlist. Do not add other `NEXT_PUBLIC_*` keys to env files.

#### I-5. Secret scan is a regex smoke test

`scripts/secret-scan.sh` will not catch a `DATABASE_URL=postgres://…` line. Gitignore remains the primary control for env files.

#### I-6. Remote CI has not run

Local checks were reported in the implementation pass. This review does not treat GitHub Actions as green.

#### I-7. `docs/DEVELOPMENT.md` trailing list is malformed

The production-CSP sentence was inserted above the last bullet (`DEVELOPMENT.md:203-204`). Cosmetic. Fix with M-1.

## CI review

File: `.github/workflows/ci.yml`

| Check | Result |
| --- | --- |
| Triggers | `pull_request` (all branches) and `push` to `main`. Feature-branch pushes without a PR do not run CI. Intended. |
| Permissions | `contents: read` only. No `pull_request_target`. No secrets referenced. |
| Node / pnpm | Node `26.13.0`; pnpm `12.16.1` via `pnpm/action-setup`. Matches `.nvmrc` and `package.json`. |
| Required steps | Frozen install, format, lint, typecheck, unit tests, secret scan, production build, `pnpm audit --prod`. A failed step fails the job. |
| CI env | `APP_ENV=test`, `AUTH_PROVIDER=fake` — allowed by the fake-auth guard. Does not prove a production `APP_ENV` start. |

Action SHAs re-checked against upstream tags in this review:

| Pin in workflow | Tag | Remote SHA |
| --- | --- | --- |
| `actions/checkout@fbc6f399…` | `v5.1.0` | `fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09` |
| `pnpm/action-setup@ea17c68…` | `v6.1.0` (peeled annotated tag) | `ea17c68df8912ef543352723c149a84f56e3d413` |
| `actions/setup-node@949feb2…` | `v7.1.0` | `949feb2413d6458794dcd2491c4babbbce0c15c1` |

Do not claim this workflow has passed on GitHub.

## Testing quality

13 tests across 4 files:

| File | Tests | What they actually prove |
| --- | --- | --- |
| `tests/unit/env.test.ts` | 9 | Missing `APP_ENV` / `AUTH_PROVIDER`; unknown `APP_ENV`; fake rejected in `dev`/`staging`/`production`; fake allowed in `test`; supabase rejected; dotenv parse does not run interpolations; a `DATABASE_URL` sitting unused in the env object does not appear in the fake-auth error string |
| `tests/unit/logger.test.ts` | 1 | Nested `password` / `api_key` / `accessToken` keys redact |
| `tests/unit/headers.test.ts` | 2 | Default CSP has no `unsafe-eval`; `isDevelopment: true` adds it |
| `tests/unit/health.test.ts` | 1 | Payload is static and has no `AUTH_PROVIDER` |

These are real security-behavior tests, not only snapshot tests. They are thin.

Meaningful missing negatives (do not expand the suite beyond what H-1 / H-2 / M-3 need):

1. `NODE_ENV=production` + `APP_ENV=local` + `AUTH_PROVIDER=fake` allowed
2. `NODE_ENV=production` + `APP_ENV=production` + `AUTH_PROVIDER=fake` rejected
3. Logger: `DATABASE_URL`, `sessionId`, array values, `message` containing a URI
4. Lint fixture that `src/components` cannot import `@/platform/config/env`
5. HTTP: health 200 body; health does not include `appEnv` (the unit test of `healthPayload` already covers the function, not the route)

Not needed for Step 1: database isolation, session, or CSRF tests.

## Final recommendation

**Approve with minor corrections.**

The running application does not enable fake authentication in staging or production `APP_ENV`, does not put server secrets in the public env module or the health body, and does not commit `.env` files. Those are the load-bearing controls for Step 1.

Do not merge until:

1. **H-1** — ESLint boundaries actually apply (`eslint --print-config` proof)
2. **H-2** — logger redaction covers connection strings and session identifiers, with tests
3. **M-1** — `docs/DEVELOPMENT.md` describes a pnpm install that works on a clean Node 26.13.0 (npm global `pnpm@12.16.1` or a separately installed Corepack)

Do not start M1 Step 2 until those three are done. H-2 in particular will otherwise sit on the path that logs `DATABASE_URL`.

## Remediation results

Implemented 2026-11-02 on `feature/m1-application-foundation`. Original findings above are preserved. CI was not changed. Remote GitHub Actions has still not been run.

### H-1 — ESLint architectural boundaries

**Status:** Corrected.

**Cause:** ESLint 9 replaces `no-restricted-imports` when a later matching block sets the same rule. The catch-all package-ban block was last, so UI server-module patterns and domain provider patterns never reached the effective config.

**Correction:** `eslint.config.mjs` now gives every matching block a complete restriction set. Order:

1. Default (`**/*.{ts,tsx,mjs}`): ban `pg`, `kysely`, `@supabase/supabase-js`, `@supabase/ssr`.
2. `src/platform/db/**`: ban only Supabase (pg/Kysely allowed).
3. `src/platform/auth/**`: ban only pg/Kysely (Supabase allowed).
4. UI (`src/components/**`, `src/lib/**`, `app/**` except `app/api/**` and `app/status/**`): package bans plus server-module patterns (`@/platform/config/env`, `@/platform/log/**`, `@/platform/db/**`, and `**/` relatives).
5. Domain modules (`src/modules/**`): package bans plus provider patterns.

**Verification:**

- `eslint --print-config src/components/ui/button.tsx` includes `pg`, `@supabase/supabase-js`, and `@/platform/config/env`.
- `eslint --print-config app/page.tsx` includes env, pg, and supabase.
- `eslint --print-config src/lib/utils.ts` includes `@/platform/config/env`.
- `eslint --print-config src/modules/devices/service.ts` includes `@/providers`, `pg`, and `kysely`.
- `eslint --print-config src/platform/db/pool.ts` bans supabase and does not ban pg.
- `eslint --print-config src/platform/auth/adapter.ts` bans pg and does not ban supabase.
- `eslint --print-config app/status/page.tsx` bans pg and does not include the UI env pattern (status may load server env).
- `eslint --print-config src/platform/log/logger.ts` bans pg and does not include the UI env pattern (logger may load server env).
- `tests/unit/eslint-boundaries.test.ts` lints in-memory snippets with `ESLint.lintText({ filePath })` and `calculateConfigForFile`: prohibited UI and module imports fail; allowed db/auth/API/status/worker/logger imports produce zero `no-restricted-imports` messages.

### H-2 — Log redaction

**Status:** Corrected.

**Correction:** `src/platform/log/logger.ts`

- Key matching is case-insensitive after stripping punctuation. Exact keys and suffixes cover `DATABASE_URL` / `databaseUrl`, `sessionId` / `SESSION_ID`, `connectionString`, `dsn`, passwords, tokens, cookies, API keys, and database user/password fields.
- Keys such as `session`, `sessionCount`, and `userId` are not treated as secrets.
- String values and the log `msg` field run through `redactSensitiveText`, which rewrites `postgres://` and `postgresql://` userinfo (and password query params) and libpq/ADO.NET `password=` assignments, while leaving `https://` URLs, hosts, usernames, and credential-less postgres hosts intact.
- `Error` values contribute `name`, redacted `message`, and redacted `stack` — not an unfiltered stack dump.
- Array elements are scanned even when the parent key is not sensitive.

**Verification** (`tests/unit/logger.test.ts`):

- PostgreSQL URL with username and password: password removed, host `db.example.test` kept.
- `postgresql://…?sslmode=require`: password removed, `sslmode` kept.
- libpq keyword-value string `password=test-password`: password replaced, host/user/`sslmode` kept.
- Semicolon-delimited `Password='test-password'`: password replaced, host/username kept.
- Nested `DATABASE_URL` / `sessionId` / `Database_Url` → `[redacted]`.
- Arrays mixing a postgres URI, a benign string, and a public https URL.
- `Error` whose message contains a postgres URI: `JSON.stringify` of the redacted fields does not contain the password.
- `sessionCount`, nested `{ session: { started: true } }`, and `https://status.example.test/health` unchanged.

### M-1 — Node 26 pnpm installation

**Status:** Corrected.

**Correction:** `docs/DEVELOPMENT.md` no longer tells developers to run Corepack on Node 26.13.0. The documented path is:

```bash
npm install -g pnpm@12.16.1
pnpm --version   # 12.16.1
```

The guide states that a `corepack` binary on `PATH` is from another Node version. `.github/workflows/ci.yml` is unchanged and still uses `pnpm/action-setup` 12.16.1.

### Post-remediation checks (local)

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | pass |
| `pnpm format:check` | pass |
| `pnpm lint` | pass |
| `pnpm typecheck` | pass |
| `pnpm test` | 29 passed / 5 files |
| `pnpm secret-scan` | pass |
| `pnpm build` | pass (Next.js 16.4.3) |
| Documentation links in `DEVELOPMENT.md` and this file | 13 relative links, none missing |
| Active branch | `feature/m1-application-foundation` |

### Remediation recommendation

H-1, H-2, and M-1 are resolved. Remaining review items (M-2 CSP `unsafe-inline`, M-3 `APP_ENV`/`NODE_ENV` test pair, M-4 public `/status` disclosure, and later deployment headers) were not in this remediation scope.

Remote CI has still not been run. Do not start M1 Step 2 in this change.
