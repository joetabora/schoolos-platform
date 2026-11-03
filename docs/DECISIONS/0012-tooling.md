# ADR-0012: Tooling — pnpm, Node.js LTS, strict TypeScript, single Next.js app, Tailwind CSS and shadcn/ui

- **Status:** Accepted
- **Date:** 2026-11-02
- **Deciders:** Founding engineering team
- **Related:** ADR-0002, M1_IMPLEMENTATION_PLAN step 1, ARCHITECTURE_READINESS_REVIEW D-1

## Context

M1 needs a fixed toolchain before any code is written. The architecture is a single modular monolith (ADR-0002). The team is small, so tooling should be mainstream and well-documented.

## Decision

| Concern | Choice |
| --- | --- |
| Package manager | **pnpm**, version pinned via the `packageManager` field in `package.json`; lockfile committed |
| Runtime | **Node.js 26 ("Lithium")**, the newest LTS line listed on nodejs.org as of 2026-11-02. The exact version is pinned in `.nvmrc` / `.node-version` and `package.json` `engines`, and matched by the container base image and CI. |
| Language | **TypeScript** with `strict: true` (plus `noUncheckedIndexedAccess`, `noImplicitOverride`) |
| Application shape | **One Next.js application** (App Router) with a separate worker entrypoint from the same package. **No monorepo tooling.** Revisit when the Go agent (M7) needs a shared repository layout. |
| Styling and components | **Tailwind CSS** and **shadcn/ui**. shadcn/ui components are copied into the repo and owned by us, so they are reviewed like our own code. |

Rules:
- Version upgrades of Node.js, Next.js, TypeScript, Tailwind, or pnpm are explicit PRs, not incidental.
- Production and CI use only Active or Maintenance LTS Node.js releases. Node.js 27 is in its Alpha phase (nodejs.org, 2026-11-02) and is not used.
- Exact versions of Next.js, Tailwind CSS, and shadcn/ui are chosen at scaffold time (M1 step 1) from their current stable releases, with compatibility confirmed by a working build and CI run. They are recorded in `package.json` and the lockfile, not in this ADR.

## Alternatives considered

| Option | Pros | Cons |
| --- | --- | --- |
| npm / Yarn | Ubiquitous | pnpm's strict dependency resolution catches phantom dependencies; faster installs |
| Node.js 24 (also LTS) | Longer in production use | Shorter remaining support window than 26 |
| Monorepo (Turborepo/Nx) | Ready for agent/shared packages | Unneeded complexity until M7 |
| Other component kits | Prebuilt | shadcn/ui gives owned, auditable component source with Tailwind |

## Consequences

- One toolchain to secure and update.
- shadcn/ui components need our own accessibility review against WCAG 2.1 AA (NFR-9).

## Verification

- Node.js release status checked at <https://nodejs.org/en/about/previous-releases> on 2026-11-02: v26 "Lithium" listed as LTS, v27 as Alpha.
- M1 step 1 exit check: clean install with the pinned pnpm and Node.js versions, `next build`, type check, and lint all pass in CI.
