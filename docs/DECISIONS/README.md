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
| [0012](0012-tooling.md) | Tooling: pnpm, Node.js LTS, strict TypeScript, single Next.js app, Tailwind CSS and shadcn/ui | Accepted |
| [0013](0013-database-hosting-postgres-version-uuid-pooling.md) | AWS RDS PostgreSQL 18, Supabase for Auth only, app-generated UUIDv7, standard pg pooling | Accepted |
| [0014](0014-database-tooling.md) | Database tooling: dbmate, Kysely, node-postgres | Proposed (pending spike) |
| [0015](0015-organization-resolution.md) | Organization explicit in URL paths; per-request membership and permission checks | Accepted |
| [0016](0016-session-model.md) | Session model: Supabase identity + TOTP, SchoolOS-authoritative server-side sessions | Proposed (pending spike; fixed requirements binding) |
| [0017](0017-audit-log-design.md) | Audit log: hash-chained core, redactable details, signed checkpoints, prefix purge, platform chain | Accepted |
| [0018](0018-aws-infrastructure-and-deployment.md) | AWS infrastructure and deployment with cost controls | Accepted (IaC tool and egress open) |
| [0019](0019-support-access-grants.md) | Support access via temporary grants evaluated by `authorize()` | Accepted (implementation M5) |
