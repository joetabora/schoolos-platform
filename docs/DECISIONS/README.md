# Architecture Decision Records

We record significant architecture decisions as short, numbered ADRs. Copy [`0000-template.md`](0000-template.md) to create a new one.

Rules:
- One decision per ADR. Number sequentially; never renumber.
- Accepted ADRs are not edited in substance; supersede them with a new ADR and update the old one's status.
- Any change to tenancy, authorization, provider boundaries, command lifecycle, cryptography, or hosting requires an ADR.
- "Proposed" ADRs become "Accepted" after review by at least one other engineer.

| ADR | Title | Status |
| --- | --- | --- |
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions | Accepted |
| [0002](0002-modular-monolith-nextjs-typescript.md) | Modular monolith with TypeScript and Next.js | Proposed |
| [0003](0003-postgresql-multi-tenancy-rls.md) | PostgreSQL shared-schema multi-tenancy with RLS | Proposed |
| [0004](0004-authentication-provider.md) | Supabase Auth behind an internal interface; SchoolOS owns authorization | Proposed |
| [0005](0005-control-plane-provider-separation.md) | Separate control plane from provider/OS integrations | Proposed |
| [0006](0006-command-lifecycle.md) | Auditable command lifecycle with append-only events | Proposed |
| [0007](0007-go-device-agent.md) | Go for the future native device agent | Proposed |
| [0008](0008-rest-api-first.md) | REST API first; separate device communication layer later | Proposed |
| [0009](0009-background-jobs.md) | PostgreSQL-backed job queue first; Redis when needed | Proposed |
| [0010](0010-no-simulated-enforcement.md) | Never represent simulated enforcement as real | Accepted |
| [0011](0011-production-infrastructure-separation.md) | Production infrastructure separate from personal/home infrastructure | Accepted |
