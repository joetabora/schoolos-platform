# SchoolOS Platform

SchoolOS is an independent, commercial, multi-tenant SaaS platform for K-12 school device security and management.

> **Status:** Pre-implementation. This repository currently contains the engineering foundation and design documentation only. No application code exists yet. Nothing described here should be read as a shipped capability.

---

## Product overview

Schools manage large fleets of student and staff devices, mostly Chromebooks today. IT staff need one place to see their fleet, apply safety and security policy, run remote actions, and review security events. Teachers need limited, classroom-scoped controls. District leaders need evidence that controls are working and that student data is handled responsibly.

SchoolOS will:

1. **Start with managed ChromeOS devices.** It will connect to a school's existing Google Workspace for Education / Chrome Enterprise environment through Google's published APIs and a policy-installed Chrome extension. Google is treated as an **integration provider**, not the owner of the product or customer experience.
2. **Expand to our own Linux-based educational operating system** and native device enforcement agents, written in Go, that report to the same control plane.

SchoolOS is **not** a GoGuardian plugin, reseller product, or add-on to any competing product. It has no dependency on GoGuardian, Securly, Lightspeed, Hapara, Linewize, or similar vendors.

## Mission

Give schools a trustworthy, transparent, and secure way to manage and protect the devices they issue to students, while collecting the minimum student data required and never overstating what the system actually enforces.

## Goals

- **Single control plane** for device inventory, policy, remote commands, security events, and audit across device platforms.
- **Multi-tenant from day one.** Every school district (organization) is strictly isolated at the application layer *and* in PostgreSQL via row-level security (RLS).
- **Truthful enforcement.** Every policy and command shows exactly where it is enforced (Google-managed policy, SchoolOS extension, SchoolOS native agent) and what its real execution status is.
- **Auditable remote actions.** Every remote command has a full, immutable lifecycle record: who requested it, who approved it, what was sent, what the device/provider reported, and when.
- **Privacy by design.** Data minimization, configurable retention, transparent monitoring, and district-controlled access.
- **Platform independence.** ChromeOS-specific logic lives behind a provider adapter so the core product is not coupled to Google.
- **Long-term Linux support** through a native Go agent and our own educational OS.

## Non-goals (for the MVP and until explicitly re-scoped)

- Not a replacement for the Google Admin console. We call Google APIs; we do not reimplement Google's management plane.
- No AI-driven prediction, scoring, or automated judgement about students (e.g. "risk scores", self-harm prediction). If such features are ever considered, they require a separate product, legal, and ethics review.
- No covert monitoring. Monitoring capabilities must be disclosed to the district and, where appropriate, visible to the user.
- No keystroke logging, webcam/microphone capture, or off-device location tracking.
- No consumer / parent-direct product in the MVP. The school (district) is the customer and the data controller.
- No microservice decomposition during the MVP. One deployable web application plus background workers.
- No simulated or mocked enforcement presented as real enforcement, in the UI, sales material, or API responses.
- No production workloads on any developer's home server or personal infrastructure.

## Development philosophy

1. **Accuracy over speed.** We do not claim a capability until it is verified against a real, managed test environment.
2. **Do not invent external capabilities.** Every Google API, extension API, or OS capability we depend on must be cited to official documentation and labelled *Verified*, *Documented but untested*, or *Assumption*. See [`docs/CHROMEOS_INTEGRATION.md`](docs/CHROMEOS_INTEGRATION.md).
3. **Secure by default.** Deny-by-default authorization, server-side checks on every request, RLS as a second line of defense, signed device commands, and complete audit logs.
4. **Simple, boring architecture.** A modular monolith (TypeScript / Next.js / PostgreSQL) until real load or team boundaries justify splitting it.
5. **Separation of control plane and integrations.** The core domain (organizations, policies, commands, events) never imports provider-specific code directly.
6. **Write it down.** Significant decisions are recorded as ADRs in [`docs/DECISIONS/`](docs/DECISIONS/). Unknowns go in [`docs/OPEN_QUESTIONS.md`](docs/OPEN_QUESTIONS.md).
7. **Test what matters.** Authorization, tenant isolation, command lifecycle, and signature verification require automated tests before they ship.

## Proposed technology stack

| Concern | Choice | Notes |
| --- | --- | --- |
| Web platform | TypeScript (strict), Next.js, Tailwind CSS, shadcn/ui; pnpm; Node.js 26 LTS | Single app serving UI and REST API, plus a worker entrypoint ([ADR-0012](docs/DECISIONS/0012-tooling.md)) |
| Database | AWS RDS for PostgreSQL 18 (Docker `postgres:18` locally and in CI) | Primary system of record, with row-level security; app-generated UUIDv7 ([ADR-0013](docs/DECISIONS/0013-database-hosting-postgres-version-uuid-pooling.md)) |
| Database tooling | dbmate, Kysely, node-postgres | Proposed, pending spike ([ADR-0014](docs/DECISIONS/0014-database-tooling.md)) |
| Authentication | Supabase Auth for identity and TOTP MFA only | SchoolOS-authoritative sessions and authorization ([ADR-0004](docs/DECISIONS/0004-authentication-provider.md), [ADR-0016](docs/DECISIONS/0016-session-model.md)) |
| Hosting | AWS `us-east-2`: ECS Fargate (web + worker), ALB, RDS, Secrets Manager, KMS | With budgets and cost controls ([ADR-0018](docs/DECISIONS/0018-aws-infrastructure-and-deployment.md)) |
| Background jobs | PostgreSQL-backed queue first, Redis when needed | [ADR-0009](docs/DECISIONS/0009-background-jobs.md) |
| Device agent (future) | Go | Cross-platform native agent ([ADR-0007](docs/DECISIONS/0007-go-device-agent.md)) |
| ChromeOS integration | Google Admin SDK, Chrome Policy API, Chrome Management API, policy-installed Chrome extension | Subject to licensing and access verification |

## Documentation index

| Document | Purpose |
| --- | --- |
| [`docs/PRODUCT_REQUIREMENTS.md`](docs/PRODUCT_REQUIREMENTS.md) | Personas, journeys, MVP scope, requirements, acceptance criteria |
| [`docs/SYSTEM_ARCHITECTURE.md`](docs/SYSTEM_ARCHITECTURE.md) | Multi-tenant architecture, components, deployment topology |
| [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) | Proposed PostgreSQL entities, relationships, RLS approach |
| [`docs/SECURITY_MODEL.md`](docs/SECURITY_MODEL.md) | Threat model, identity, signed commands, secrets, incident response |
| [`docs/PRIVACY_AND_COMPLIANCE.md`](docs/PRIVACY_AND_COMPLIANCE.md) | FERPA/COPPA considerations, minimization, retention, transparency |
| [`docs/CHROMEOS_INTEGRATION.md`](docs/CHROMEOS_INTEGRATION.md) | Google integration plan, verified capabilities vs assumptions |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Milestones M0–M9, dependencies, risks, exit criteria |
| [`docs/DECISIONS/`](docs/DECISIONS/) | Architecture decision records |
| [`docs/OPEN_QUESTIONS.md`](docs/OPEN_QUESTIONS.md) | Unresolved technical, business, legal, integration questions |
| [`docs/ARCHITECTURE_READINESS_REVIEW.md`](docs/ARCHITECTURE_READINESS_REVIEW.md) | Pre-M1 review: contradictions, gaps, assumptions, required decisions |
| [`docs/M1_IMPLEMENTATION_PLAN.md`](docs/M1_IMPLEMENTATION_PLAN.md) | Detailed M1 plan and implementation sequence |

## Repository status and conventions

- Default branch: `main`. Work on short-lived feature branches; merge by pull request with review.
- No secrets in the repository, ever. See [`docs/SECURITY_MODEL.md`](docs/SECURITY_MODEL.md#7-secrets-management).
- Application code, package manifests, and infrastructure-as-code will be added starting at milestone M1 (see [`docs/ROADMAP.md`](docs/ROADMAP.md)).

## Legal notice

Nothing in this repository is legal advice or a claim of legal or regulatory compliance. FERPA, COPPA, state student-privacy laws, and contractual obligations must be validated by qualified counsel before SchoolOS is offered to customers.

Google, ChromeOS, Chromebook, Google Workspace, and Chrome Enterprise are trademarks of Google LLC. Other product names are trademarks of their respective owners. SchoolOS is not affiliated with or endorsed by Google or any other vendor named here.
