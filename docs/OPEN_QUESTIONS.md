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
| T-1 | Which cloud provider for production (requirements in SYSTEM_ARCHITECTURE §14)? | M0 | open |
| T-2 | Supabase Auth hosted vs alternative OIDC provider (e.g. Auth0, Clerk, WorkOS, Cognito, self-hosted). Does Supabase hosting meet our data residency and sub-processor needs? | M0 | open |
| T-3 | Staff sign-in: password+MFA, Google OIDC for staff, SAML for districts, or all? | M1 | open |
| T-4 | Postgres-backed job queue library choice (evaluate e.g. pg-boss, graphile-worker) vs. Redis-based queue from the start. | M1 | open |
| T-5 | Connection pooler choice compatible with `SET LOCAL` tenant context in transaction mode. | M1 | open |
| T-6 | Hosting model for Next.js (container vs serverless platform) given long-running worker needs and private DB networking. | M1 | open |
| T-7 | Device gateway transport for Go agent: long-poll, WebSocket, or gRPC streaming? | M7 | open |
| T-8 | Device CA: managed private CA service vs self-operated? | M7 | open |
| T-9 | Which Linux distribution is the base for the SchoolOS educational OS and the M7 development target? | M7 | open |
| T-10 | Audit log external anchoring mechanism (object-lock storage, transparency log)? | M5 | open |
| T-11 | Does PostgreSQL run in our own cloud account, or co-hosted with Supabase? If co-hosted, how is Supabase's auto-generated data API disabled and verified? (Review D-2, S-14) | M1 | open |
| T-12 | Does Supabase Auth provide TOTP MFA with a server-verifiable assurance level, reauthentication for step-up, and configurable idle/absolute session limits on our plan? (Review A-1 to A-3) | M1 | open |
| T-13 | Which migration tool and DB access library? (Review D-4) | M1 | open |
| T-14 | Which PostgreSQL major version does the chosen managed provider support, and is native `uuidv7()` available? (Review D-3) | M1 | open |
| T-15 | How should audit logs reconcile immutability with retention and data-subject deletion? (Review C-1, C-2, D-5) | M1 | open |

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

_None yet._
