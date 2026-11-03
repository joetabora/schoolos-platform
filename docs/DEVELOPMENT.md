# SchoolOS application development

This guide describes how to run the SchoolOS staff application locally and how the M1 step 1 foundation is put together. It reflects the code on `feature/m1-application-foundation`, not later M1 steps.

Architecture decisions live in [`DECISIONS/`](DECISIONS/). The M1 sequence is in [`M1_IMPLEMENTATION_PLAN.md`](M1_IMPLEMENTATION_PLAN.md).

## Required software

| Tool | Pin | Where it is declared |
| --- | --- | --- |
| Node.js | **26.13.0** (26 LTS / Lithium) | `.nvmrc`, `.node-version`, `package.json` `engines.node` |
| pnpm | **12.16.1** | `package.json` `packageManager` and `engines.pnpm` |
| Git | any current version | — |

PostgreSQL, Docker, Supabase, and AWS credentials are **not** required for this step. The application starts without a database and without an identity provider.

Do not install Node.js 27. It is not an LTS release ([ADR-0012](DECISIONS/0012-tooling.md)).

## Node.js and pnpm setup

Using nvm:

```bash
nvm install
nvm use
```

`nvm install` with no version reads `.nvmrc` and installs 26.13.0.

Node.js 26 does **not** ship Corepack. Install the pinned pnpm with the npm that comes with Node 26.13.0:

```bash
npm install -g pnpm@12.16.1
pnpm --version   # 12.16.1
node --version   # v26.13.0
```

Do not run `corepack enable` against this Node install. Corepack is absent from Node 26.13.0; a `corepack` binary on `PATH` is almost certainly from another Node version.

`engine-strict=true` in `.npmrc` refuses installs on any other Node.js or pnpm version. GitHub Actions installs the same pnpm version with `pnpm/action-setup` and does not use Corepack.

## Installing dependencies

From the repository root:

```bash
pnpm install
```

CI and release installs must be reproducible:

```bash
pnpm install --frozen-lockfile
```

`pnpm-workspace.yaml` is **not** a monorepo. This repository is a single Next.js application ([ADR-0012](DECISIONS/0012-tooling.md)). pnpm 12 keeps its supply-chain settings in that file:

- `minimumReleaseAge: 10080` (7 days) — packages newer than 7 days are not resolved.
- `allowBuilds` — only `esbuild`, `sharp`, and `unrs-resolver` may run install scripts.

Exact versions are saved (`save-exact=true`). Do not add a dependency unless this step needs it.

## Running the application locally

```bash
cp .env.example .env.local
pnpm dev
```

Then open [http://localhost:3000](http://localhost:3000). Useful routes:

| Path | What it is |
| --- | --- |
| `/` | Staff application shell and product identification |
| `/status` | Live process status (environment name and health only) |
| `/api/v1/health` | JSON `{ "status": "ok", "service": "schoolos-web" }` |

Production-mode local run:

```bash
pnpm build
pnpm start
```

The background worker is a separate process from the same package ([ADR-0002](DECISIONS/0002-modular-monolith-nextjs-typescript.md), [ADR-0009](DECISIONS/0009-background-jobs.md)). It currently validates configuration and exits after logging that no jobs are registered. Unlike Next.js, `tsx` does not load dotenv files on its own, so the worker applies `.env` then `.env.local` without overriding variables already set in the process:

```bash
pnpm worker
```

## Environment configuration

Copy [`.env.example`](../.env.example) to `.env.local`. Real `.env` / `.env.*` files are git-ignored. Never put secrets in `NEXT_PUBLIC_*` variables.

| Variable | Required | Notes |
| --- | --- | --- |
| `APP_ENV` | yes | `local` \| `test` \| `dev` \| `staging` \| `production` |
| `AUTH_PROVIDER` | yes | `fake` is allowed only when `APP_ENV` is `local` or `test`. `supabase` is rejected until M1 step 3. |
| `NODE_ENV` | no | Defaults to `development`. Next.js sets `production` during `next build`. |
| `LOG_LEVEL` | no | `debug` \| `info` \| `warn` \| `error`. Defaults to `info`. |
| `NEXT_PUBLIC_APP_NAME` | no | Browser-safe product name. Defaults to `SchoolOS`. |

`DATABASE_URL` and `SUPABASE_*` are listed in `.env.example` as comments only. They are not read in this step.

Server-only values are loaded by `src/platform/config/env.ts` (`loadServerEnv` / `getServerEnv`). Public values are loaded by `src/platform/config/public-env.ts`. The UI must not import the server module; ESLint enforces that.

Configuration fails fast at worker start and at the Next.js `instrumentation` hook (Node.js runtime only). Error messages name the variable and the allowed values. They do not print other environment values, so a misconfiguration cannot leak a secret that happens to be present.

`AUTH_PROVIDER=fake` is gated on **`APP_ENV`**, not `NODE_ENV`. Next.js sets `NODE_ENV=production` during `next build`, including in CI. Gating on `NODE_ENV` would make a legitimate test/local production build refuse to start. Staging and production application environments still cannot use the fake adapter (TST-8).

## Lint, typecheck, formatting, tests, and build

| Command | What it does |
| --- | --- |
| `pnpm format` | Prettier write |
| `pnpm format:check` | Prettier check (CI) |
| `pnpm lint` | ESLint (Next.js core-web-vitals + TypeScript, plus import boundaries) |
| `pnpm typecheck` | `next typegen` then `tsc --noEmit` with strict flags |
| `pnpm test` | Vitest unit tests |
| `pnpm secret-scan` | Local regex scan for credential-like strings |
| `pnpm build` | Production Next.js build |
| `pnpm ci` | format check, lint, typecheck, test, secret-scan, build |

TypeScript is pinned to **6.0.3**. TypeScript 7.0.2 is current, but `typescript-eslint` 8.72 (pulled in by `eslint-config-next` 16.4.3) does not support the TypeScript 7 API. Strictness flags in `tsconfig.json` are `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noPropertyAccessFromIndexSignature`, and `useUnknownInCatchVariables`. `any` is an ESLint error.

Next.js is pinned to **16.4.3**. 16.4.4 was published inside the 7-day `minimumReleaseAge` window. Upgrade in an explicit PR after the release is old enough (and after reviewing the 16.4.x security notes).

Import-boundary rules (already active, even though some folders do not exist yet):

- `pg` and `kysely` may only be imported from `src/platform/db` ([ADR-0014](DECISIONS/0014-database-tooling.md)). The transaction wrapper invariant for that module:
  - One centrally managed `pg.Pool` and one root Kysely instance.
  - `withTenant` / `withUser` / `withSystem` own the Kysely transaction lifecycle.
  - Handlers receive only a Kysely `Transaction`, never the pool, the root instance, or a raw `pg` client.
  - Transaction-bound objects must not escape the handler or outlive the transaction.
  - Nested `transaction()` / `startTransaction()` / `connection()` are rejected so they cannot commit the outer transaction early. If a database operation fails, the wrapper fails the request even when the handler catches the original exception (aborted-transaction probe, SQLSTATE `25P02`).
- `@supabase/supabase-js` and `@supabase/ssr` may only be imported from `src/platform/auth` ([ADR-0004](DECISIONS/0004-authentication-provider.md), [ADR-0016](DECISIONS/0016-session-model.md)).
- `src/modules/**` cannot import `src/providers/**` ([ADR-0005](DECISIONS/0005-control-plane-provider-separation.md)).
- UI under `app/` (except `app/api/**` and `app/status/**`), `src/components/`, and `src/lib/` cannot import server env, logging, or database modules. Domain modules cannot import `src/providers/**`. These restrictions are asserted by `tests/unit/eslint-boundaries.test.ts` against ESLint's effective config.

## CI workflow

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs on pull requests and on pushes to `main`.

Environment for CI: `APP_ENV=test`, `AUTH_PROVIDER=fake`, `LOG_LEVEL=info`, `NEXT_PUBLIC_APP_NAME=SchoolOS`.

Steps, in order:

1. Frozen-lockfile install (`pnpm install --frozen-lockfile`)
2. Format check
3. ESLint
4. TypeScript check
5. Unit tests
6. Secret scan
7. Production build
8. `pnpm audit --prod`

GitHub Actions are pinned to immutable commit SHAs:

| Action | Version | SHA |
| --- | --- | --- |
| `actions/checkout` | v5.1.0 | `fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09` |
| `pnpm/action-setup` | v6.1.0 | `ea17c68df8912ef543352723c149a84f56e3d413` (annotated tag `v6.1.0` peeled) |
| `actions/setup-node` | v7.1.0 | `949feb2413d6458794dcd2491c4babbbce0c15c1` |

The runner image is `ubuntu-24.04`. Node.js is 26.13.0, matching `.nvmrc`.

## Repository structure

```
app/                         Next.js App Router (UI and /api/v1)
  layout.tsx                 Root layout, fonts, metadata
  page.tsx                   Landing page
  globals.css                Tailwind v4 theme
  status/page.tsx            Process status (no tenant data)
  api/v1/health/route.ts     Public health endpoint
src/
  platform/                  Cross-cutting infrastructure
    config/                  Server and public env validation
    log/                     Structured JSON logger with redaction
    http/                    Health payload
    security/                HTTP security headers
  components/                Application shell and shadcn/ui primitives
  lib/utils.ts               `cn()` class merger
  worker.ts                  Background worker entrypoint
instrumentation.ts           Server startup: validate env, log web start
tests/unit/                  Vitest tests for env, logger, health
docs/                        Architecture, ADRs, this guide
.github/workflows/ci.yml
```

Not created in this step, by design:

- `src/platform/db`, `src/platform/auth`, `src/platform/authz`, `src/platform/audit`
- `src/modules/**`, `src/providers/**`, `src/jobs/**`
- `db/migrations`
- Docker Compose PostgreSQL
- Supabase project wiring

Those land in later M1 steps. ESLint rules and folder names are already aligned with [`SYSTEM_ARCHITECTURE.md`](SYSTEM_ARCHITECTURE.md) §5.1 so those steps do not have to fight the foundation.

## What this step does not do

- No database schema, pool, RLS, or tenant transaction wrapper.
- No authentication, sessions, MFA, invitations, or roles.
- No organization or school records, and no student data.
- No AWS resources.
- No analytics or third-party scripts.

Production Content-Security-Policy does not include `unsafe-eval`. `next dev` adds it only so React's development overlay can reconstruct stacks. Production builds never include it.
- No fake device inventory, alerts, or district data in the UI.
