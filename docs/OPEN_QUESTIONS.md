# Open Questions

> Each question has an owner and a target milestone. When resolved, record the answer, date, and source (and an ADR if it changes architecture), then move it to the Resolved section. Do not delete questions.

Status: `open`, `investigating`, `resolved`, `wont_resolve`.

## Google / ChromeOS integration

| ID | Question | Why it matters | Target | Status |
| --- | --- | --- | --- | --- |
| G-1 | Which authorization model should we use: OAuth admin consent, service account with domain-wide delegation, or Marketplace app? | Security, onboarding friction, verification requirements | M0 | open |
| G-2 | Which of our required scopes are classified as sensitive or restricted, and what verification or security assessment does Google require? | Could delay launch by weeks or months | M0 | open |
| G-3 | Is any Google partner program required (not just beneficial) for production use of the Directory, Chrome Policy, or Chrome Management APIs by a third-party SaaS? | Business and timeline gating | M0 | open |
| G-4 | What are the effective quotas and rate limits for `chromeosdevices.list`, `issueCommand`, `commands.get`, `batchChangeStatus`, and Chrome Policy APIs at district scale (50k devices)? | Sync frequency, bulk command design | M0 | open |
| G-5 | Can Google custom admin roles grant exactly the privileges SchoolOS needs, so districts can use a least-privilege integration account? | Least privilege | M0 | open |
| G-6 | For `DEVICE_START_CRD_SESSION`, the result URL requires authentication with the issuing email. How does this work when SchoolOS issues the command? Is brokering CRD through a third party viable or permitted? | Remote-access feature viability | M3 | open |
| G-7 | Is there a supported way to cancel a pending Directory API command? (Only `commands.get` is listed in the reference.) | Command lifecycle completeness | M3 | open |
| G-8 | What does `customers.telemetry.devices` actually return in practice, which device reporting policies are required, and with what freshness? | Event ingestion design | M2 | open |
| G-9 | Do `telemetry.notificationConfigs` deliver via Pub/Sub, which event types are available, and what are the latency and setup requirements? | Push vs poll ingestion | M5 | open |
| G-10 | Which Chrome Policy schemas support group targeting vs OU only? | Policy targeting model | M4 | open |
| G-11 | What are the exact Chrome Policy schema names for initial catalog settings (developer mode, URL block/allow lists, extension force-install, etc.)? | Policy catalog | M4 | open |
| G-12 | How are `deviceFiles[].downloadUrl` files authenticated and how long do they live? | Log/support packet features | M3 | open |
| G-13 | Are Chrome Education Upgrade licenses (or equivalent) required for every device we manage via API? What does `deviceLicenseType` report across license types? | Customer prerequisites, sales | M0 | open |
| G-14 | What restrictions do Google's API terms and user data policies place on storing, processing, and displaying data obtained via these APIs? | Legal, data model | M0 | open |
| G-15 | If the authorizing Google admin is removed or loses privileges, what happens to OAuth refresh tokens, and how do we detect and surface it? | Integration reliability | M2 | open |

## Extension (M6)

| ID | Question | Target | Status |
| --- | --- | --- | --- |
| E-1 | What mechanism gives strong, non-spoofable extension-to-server authentication (e.g. `chrome.enterprise.platformKeys`, Verified Access)? | M6 | open |
| E-2 | Does force-install reliably prevent removal or disabling by students across session types? | M6 | open |
| E-3 | Which extension APIs would be needed for teacher classroom features, and what on-device indicators are possible? | M6 | open |
| E-4 | Extension behaviour for unaffiliated users, guest, and managed guest sessions? | M6 | open |
| E-5 | Chrome Web Store / private distribution requirements for a policy-installed enterprise extension? | M6 | open |

## Technical

| ID | Question | Target | Status |
| --- | --- | --- | --- |
| T-2 | Supabase is selected for Auth (ADR-0013/0016). Remaining: which Supabase region and plan; does it meet our data-residency and sub-processor needs for staff identity data; what DPA terms apply? | M1 | open |
| T-3 | M1 uses email + password + TOTP (ADR-0016). Remaining: when and whether to add Google OIDC and/or SAML for district staff. | M5 | open |
| T-4 | Postgres-backed job queue library choice (evaluate e.g. pg-boss, graphile-worker) vs. Redis-based queue from the start. | M1 | open |
| T-7 | Device gateway transport for Go agent: long-poll, WebSocket, or gRPC streaming? | M7 | open |
| T-8 | Device CA: managed private CA service vs self-operated? | M7 | open |
| T-9 | Which Linux distribution is the base for the SchoolOS educational OS and the M7 development target? | M7 | open |
| T-10 | Audit log external anchoring mechanism (object-lock storage, transparency log)? | M5 | open |
| T-12 | Can Supabase Auth password sign-in, TOTP enroll/challenge/verify, refresh, and session termination all be performed **server-side** without exposing tokens to the browser? Docs confirm the `aal`/`amr` claims and the JWKS (ADR-0016); the server-side flows need the ADR-0016 spike. Supabase session limits no longer matter because SchoolOS enforces sessions. | M1 (step 0b) | investigating |
| T-21 | Does RDS `rds_superuser` (and other RDS-managed roles) bypass `FORCE RLS` the same way a true superuser does? Unvalidated; Docker superuser behaviour must not be assumed on RDS. | M1 (step 10) | open |
| T-22 | dbmate and `pg` TLS settings against RDS (the spike used `sslmode=disable` on localhost). | M1 (step 10) | open |
| T-16 | IaC tool for AWS: Terraform/OpenTofu or AWS CDK (TypeScript)? Must support separate accounts per environment, reviewed plans, and encrypted remote state with no plaintext secrets. | M1 (before step 10) | open |
| T-17 | Egress design for private ECS tasks (Supabase, Google APIs, AWS APIs): NAT gateway count per environment vs VPC endpoints, and the cost of each. | M1 (before step 10) | open |
| T-18 | Email delivery for invitations, MFA-reset notices, and security notifications: Amazon SES, Supabase Auth email, or another provider? Includes sender domain authentication (SPF/DKIM/DMARC). | M1 (before step 7) | open |
| T-20 | Container build: Node.js 26 base image variant, Next.js output mode for containers, image signing/provenance. | M1 (step 1/10) | open |

## Business

| ID | Question | Target | Status |
| --- | --- | --- | --- |
| B-1 | Pricing model: per device, per student, per school? Seat enforcement behaviour? | M5 | open |
| B-2 | Initial target states and district sizes? | M0 | open |
| B-3 | Self-serve onboarding vs sales-assisted for MVP? | M5 | open |
| B-4 | Billing provider? | M5 | open |
| B-5 | Do any founders or team members have non-compete, non-solicit, or IP-assignment obligations to competitors (GoGuardian or others) that affect this work? | M0 | open |
| B-6 | Support model and SLAs for pilot districts? | M5 | open |
| B-7 | Trademark clearance for "SchoolOS"? | M0 | open |

## Legal and privacy

| ID | Question | Target | Status |
| --- | --- | --- | --- |
| L-1 | Does our contract structure and practice qualify SchoolOS under the FERPA school-official exception? What contract terms are needed? | M0 | open |
| L-2 | Obligations under the current, amended COPPA Rule when acting on behalf of schools (written security program, retention policy, school authorization)? | M0 | open |
| L-3 | State-specific requirements for initial target states (DPAs, breach notification, public posting)? | M0 | open |
| L-4 | Does storing Google-reported `recentUsers` or network identifiers change obligations? Default off pending answer. | M2 | open |
| L-5 | Breach-notification timelines to commit to contractually? | M5 | open |
| L-6 | Adopt a standard DPA template (e.g. SDPC National DPA)? Sign the Student Privacy Pledge? | M5 | open |
| L-7 | Legal review of remote access (CRD) and any future classroom-observation features. | M3 / M6 | open |
| L-8 | Insurance (cyber liability, E&O) requirements before first customer. | M5 | open |

## Resolved

| ID | Question | Answer | Date | Source |
| --- | --- | --- | --- | --- |
| T-1 | Which cloud provider for production? | AWS, primary region `us-east-2` | 2026-11-02 | [ADR-0018](DECISIONS/0018-aws-infrastructure-and-deployment.md) |
| T-5 | Connection pooler compatible with `SET LOCAL`? | Standard `pg` Pool with direct private RDS connectivity; no RDS Proxy until needed; any future pooler must pass `SET LOCAL` and cross-tenant concurrency tests first | 2026-11-02 | [ADR-0013](DECISIONS/0013-database-hosting-postgres-version-uuid-pooling.md) |
| T-6 | Hosting model for Next.js and worker? | Containerized web service and independent worker on ECS Fargate behind an ALB | 2026-11-02 | [ADR-0018](DECISIONS/0018-aws-infrastructure-and-deployment.md) |
| T-11 | PostgreSQL in our account or co-hosted with Supabase? | AWS RDS in our account; Supabase for Auth only; Supabase Data API not used and verified to expose nothing | 2026-11-02 | [ADR-0013](DECISIONS/0013-database-hosting-postgres-version-uuid-pooling.md) |
| T-14 | PostgreSQL version and UUIDv7 approach? | PostgreSQL 18 (18.6 in RDS and Docker as of 2026-11-02); UUIDv7 generated in the application | 2026-11-02 | [ADR-0013](DECISIONS/0013-database-hosting-postgres-version-uuid-pooling.md); AWS RDS release calendar; Docker Hub |
| T-15 | Audit immutability vs retention and deletion? | Opaque-ID hashed core, redactable details, KMS-signed checkpoints, prefix-only purge, separate platform chain | 2026-11-02 | [ADR-0017](DECISIONS/0017-audit-log-design.md) |
| T-13 | dbmate + Kysely + node-postgres? | Accepted: dbmate migrations, Kysely queries, `pg` pool. One pool and one root Kysely; handlers receive only a Kysely `Transaction`. Remaining environmental risks are T-21 and T-22 (RDS RLS and TLS). T-23 and T-24 are resolved. | 2026-11-02 | [ADR-0014](DECISIONS/0014-database-tooling.md); [ADR-0021](DECISIONS/0021-transaction-connection-safety.md); [ADR-0022](DECISIONS/0022-database-roles-bootstrap-and-ci.md); [spike report](SPIKE_DB_TOOLING_REPORT.md) |
| T-19 | Which RFC 9562-conformant UUIDv7 library (ADR-0013)? | Node.js `crypto.randomUUIDv7()` through a centralized SchoolOS helper. No UUID npm package. | 2026-11-02 | [ADR-0020](DECISIONS/0020-uuidv7-node-crypto.md) |
| T-23 | If `ROLLBACK` fails without the connection dying, can a dirty client return to the `pg` Pool with leftover tenant context? | Both safeguards: empty tenant-context assertion before setting context, and destroy the client when commit/rollback is uncertain. Keep the aborted-transaction probe. Stock Kysely does not destroy on failed rollback; Step 2 must validate against the installed Kysely/pg and add a focused destroy test. | 2026-11-02 | [ADR-0021](DECISIONS/0021-transaction-connection-safety.md) |
| T-24 | How should CI avoid cluster-wide `CREATE ROLE` collisions if more than one database shares a PostgreSQL cluster? | One Postgres container and one database per CI job. Bootstrap creates `schoolos_owner` and the database. Migrations create only runtime roles needed at the current step (`app_user` in step 2). Never silently accept a role with wrong privileges. Defer `app_auth`, `app_org_enumerator`, and `audit_maintainer`. | 2026-11-02 | [ADR-0022](DECISIONS/0022-database-roles-bootstrap-and-ci.md) |
