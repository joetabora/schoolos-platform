# Product Requirements

> **Status:** Draft v0.1. Requirements here describe intended behavior. Any requirement that depends on a Google capability is conditional on the verification status in [`CHROMEOS_INTEGRATION.md`](CHROMEOS_INTEGRATION.md).

## 1. Problem statement

K-12 districts issue thousands of devices to students. IT teams must:

- know what devices exist, who uses them, and whether they are healthy and up to date;
- apply consistent safety and security policy by school, grade, and group;
- act remotely on lost, stolen, or misbehaving devices;
- respond to security events quickly;
- prove to administrators, boards, and parents that controls exist and data is handled responsibly.

Existing tools are often fragmented, opaque about what they actually enforce, and collect more student data than needed. SchoolOS aims to be a single, transparent, auditable control plane that works with existing ChromeOS fleets today and our own Linux-based OS later.

## 2. Personas

| Persona | Description | Primary needs |
| --- | --- | --- |
| **District IT Administrator** ("Dana") | Owns device fleet and Google Admin tenant for a district of 2k–50k devices. | Connect Google, sync inventory, apply policy, run remote commands, see audit trail. |
| **School IT Technician** ("Sam") | Supports one or more schools; limited admin scope. | Find a device fast, see its status, run safe commands (reboot, disable lost device) within their schools only. |
| **Teacher** ("Taylor") | Teaches classes; wants focus during instruction. | Classroom-scoped controls during scheduled class time only (post-MVP; depends on extension capability verification). |
| **District Security / Compliance Officer** ("Chris") | Responsible for security incidents and privacy obligations. | Security event review, audit log export, retention settings, access reviews. |
| **District Leadership / Data Privacy Officer** ("Pat") | Approves vendors and signs data-privacy agreements. | Clear documentation of data collected, retention, sub-processors, and monitoring transparency. |
| **Student** ("Riley") | Uses an issued device. Not a SchoolOS user in the MVP. | Knows when and how the device is monitored; device works reliably. |
| **SchoolOS Support Engineer** (internal) | Helps customers troubleshoot. | Time-limited, customer-approved, fully audited access to a tenant. Never silent access. |
| **SchoolOS Platform Operator** (internal) | Runs production. | Deployment, observability, incident response, without routine access to student data. |

## 3. Key user journeys

### J1. District onboarding
1. SchoolOS staff (or self-service, later) creates an **organization** for the district and invites the first District IT Administrator.
2. Admin signs in, accepts terms, and sets up MFA.
3. Admin connects Google Workspace by completing the Google authorization flow chosen in [`CHROMEOS_INTEGRATION.md`](CHROMEOS_INTEGRATION.md) (an open question until verified).
4. SchoolOS performs an initial **read-only** sync of organizational units and ChromeOS devices.
5. Admin maps Google organizational units to SchoolOS **schools** and **device groups**.
6. Admin invites additional staff with scoped roles.

### J2. Locate and act on a lost device
1. Technician searches by serial number, asset ID, or annotated user.
2. Device detail page shows Google-reported status, last sync, OS version, org unit, recent users (as reported by Google), and the SchoolOS command history.
3. Technician requests **Disable device**. Because disable is a high-impact action, policy requires a second approver (configurable).
4. An approver approves. SchoolOS calls the Google API, records the provider response, and shows the real resulting status. It never displays "disabled" until Google confirms the status change.
5. The full lifecycle is in the audit log.

### J3. Apply a policy to a group
1. Admin creates a SchoolOS policy (e.g. "Block developer mode", "Force-install SchoolOS extension", "URL blocklist").
2. The UI shows, per setting, the **enforcement mechanism** (Google Chrome policy, SchoolOS extension, or not supported on this platform).
3. Admin previews the diff against current Google-resolved policy for the target org unit.
4. Admin applies. SchoolOS writes through the Chrome Policy API and records the result. Drift is detected on subsequent syncs.

### J4. Review a security event
1. A security event is created, for example a device reporting developer mode or verified-boot failure via Google data, or an extension reporting tampering.
2. The event appears in the security queue with severity, source, and raw provenance.
3. Security officer triages: acknowledge, assign, resolve, or escalate, with notes.
4. All actions are audited.

### J5. Support access
1. Customer opens a support ticket. SchoolOS support requests access.
2. A District Admin grants **time-boxed, scoped** support access.
3. Every action by support staff is audited and visible to the district.
4. Access expires automatically.

### J6. Data deletion / offboarding
1. District requests termination.
2. SchoolOS revokes Google tokens, stops sync, exports data on request, and deletes tenant data per contract and retention policy.
3. A deletion certificate (record of what was deleted and when) is produced.

## 4. MVP scope

The MVP is **ChromeOS fleet visibility, policy, and auditable remote commands for district IT**. It is defined by milestones M1–M5 in [`ROADMAP.md`](ROADMAP.md).

### In scope
- Multi-tenant organizations, schools, and staff users with roles.
- Staff authentication with MFA support.
- Google Workspace connection per organization.
- ChromeOS device inventory sync (read) from the Admin SDK Directory API.
- Org unit sync and mapping to SchoolOS schools / groups.
- Device detail and search.
- Remote commands that the Directory API documents (see the CHROMEOS doc for the exact list and constraints), starting with `REBOOT` and device disable/re-enable via `batchChangeStatus`.
- Command lifecycle tracking with provider status polling.
- Approval workflow for high-impact commands.
- Policy read via Chrome Policy API `resolve`, and a small, explicitly enumerated set of policy writes via `batchModify` (exact set to be chosen during M4).
- Security events derived from Google-reported device data (for example `bootMode = Dev`, OS version compliance) and from SchoolOS's own system (failed logins, permission changes).
- Immutable audit log with export.
- Data retention settings per organization.

### Out of scope for MVP (candidates for later milestones)
- Teacher classroom tools (screen view, tab control, focus mode). These depend on a policy-installed extension and require separate verification and privacy review (M6).
- Web content filtering by SchoolOS (M6, extension-based).
- Student-facing UI.
- Parent portal.
- SIS / roster integrations beyond Google org units (Classroom/OneRoster are later).
- Native Go agent and Linux OS (M7–M9).
- Self-service sign-up and billing automation (subscriptions are modelled, billing provider integration is later).
- Any AI/ML-based classification or prediction.

## 5. Functional requirements

IDs are stable and referenced by tests and ADRs.

### Tenancy and organization
- **FR-ORG-1** The system shall support multiple organizations (districts) with fully isolated data.
- **FR-ORG-2** An organization shall contain one or more schools; devices and users may be scoped to schools.
- **FR-ORG-3** A user may belong to more than one organization (e.g. contractor), with independent roles per organization. The active organization shall be explicit in every request.

### Identity and access
- **FR-IAM-1** Staff users shall authenticate via the configured identity provider. Password plus MFA, or Google sign-in for staff, are both candidates (see OPEN_QUESTIONS).
- **FR-IAM-2** Roles shall be assigned per organization and optionally per school scope.
- **FR-IAM-3** Authorization shall be enforced server-side on every API request and additionally by PostgreSQL RLS.
- **FR-IAM-4** Built-in roles for MVP: `org_owner`, `org_admin`, `school_admin`, `technician`, `security_analyst`, `auditor` (read-only), `support_delegate` (internal, time-boxed). Teacher role is defined but has no MVP permissions.
- **FR-IAM-5** Permission changes shall be audited.

### Integrations
- **FR-INT-1** An org admin shall connect exactly one Google Workspace customer per organization in MVP.
- **FR-INT-2** The system shall store provider credentials encrypted and never display them after entry.
- **FR-INT-3** The system shall display the integration's health: last successful sync, last error, granted scopes.
- **FR-INT-4** Disconnecting an integration shall revoke stored credentials and stop all sync jobs.

### Device inventory
- **FR-DEV-1** The system shall sync ChromeOS devices from Google on a schedule and on demand.
- **FR-DEV-2** Each device record shall store provider identifiers and a provenance timestamp for each synced attribute set.
- **FR-DEV-3** The UI shall clearly label data as "reported by Google at <time>" versus SchoolOS-native data.
- **FR-DEV-4** Users shall search devices by serial number, asset ID, annotated user, org unit, and status.
- **FR-DEV-5** Devices removed from the provider shall be marked, not hard-deleted, until retention rules apply.

### Policies
- **FR-POL-1** A policy shall be a versioned, named set of settings targeted at a scope (organization, school, device group).
- **FR-POL-2** Each setting shall declare its enforcement mechanism per platform; settings without a real mechanism shall be shown as "not enforceable on this platform" and shall not be silently accepted.
- **FR-POL-3** Applying a policy shall produce a policy deployment record with per-target results.
- **FR-POL-4** The system shall detect drift between intended SchoolOS policy and provider-resolved policy.

### Commands
- **FR-CMD-1** Every remote command shall be persisted before dispatch with: requester, target, type, parameters, reason, and required approvals.
- **FR-CMD-2** Command states shall follow the lifecycle in [`SYSTEM_ARCHITECTURE.md`](SYSTEM_ARCHITECTURE.md#10-command-engine). State transitions are append-only.
- **FR-CMD-3** The UI shall display the actual provider-reported or agent-reported execution state. "Sent" shall never be shown as "Done".
- **FR-CMD-4** High-impact commands (wipe users, powerwash, deprovision, disable, remote desktop) shall require a configurable approval policy (default: second approver for powerwash and deprovision).
- **FR-CMD-5** Commands shall have an expiry; expired commands shall be marked `expired` and not retried silently.
- **FR-CMD-6** Bulk commands shall be limited by configurable rate and size caps and require confirmation of the target count.
- **FR-CMD-7** Remote-access commands (e.g. Chrome Remote Desktop session) shall require an explicit permission, a reason, and shall be audited. Where the provider supports user-presence acknowledgement, the default shall require it.

### Security events
- **FR-SEC-1** The system shall ingest security-relevant signals from provider sync and from SchoolOS itself.
- **FR-SEC-2** Each event shall record source, raw provenance reference, severity, and affected entity.
- **FR-SEC-3** Events shall support triage states: `new`, `acknowledged`, `in_progress`, `resolved`, `dismissed`.
- **FR-SEC-4** Event definitions shall be deterministic rules, not predictive models.

### Audit
- **FR-AUD-1** All authentication events, permission changes, integration changes, policy changes, command lifecycle transitions, data exports, and support access shall be audit logged.
- **FR-AUD-2** Audit logs shall be append-only to application roles and tamper-evident (hash chaining).
- **FR-AUD-3** Org admins and auditors shall be able to filter and export their organization's audit log.

### Privacy and retention
- **FR-PRV-1** Each organization shall configure retention per data category within platform-defined bounds.
- **FR-PRV-2** The system shall support per-student data export and deletion requests initiated by the district.
- **FR-PRV-3** A data inventory page shall show which data categories are collected for the organization and from which source.

### Subscriptions
- **FR-SUB-1** Each organization shall have a subscription record (plan, device seat limit, term, status).
- **FR-SUB-2** Exceeding the licensed seat count shall warn but not disable safety-critical functions in MVP.

## 6. Nonfunctional requirements

| ID | Category | Requirement |
| --- | --- | --- |
| NFR-1 | Security | OWASP ASVS Level 2 as the target baseline for the web application. |
| NFR-2 | Isolation | Zero cross-tenant data access; enforced by automated tests that attempt cross-tenant reads/writes on every API route and table. |
| NFR-3 | Availability | MVP target 99.5% monthly for the control plane UI/API. Provider outages are reported, not hidden. |
| NFR-4 | Performance | Device list and search p95 < 500 ms for orgs up to 50k devices. |
| NFR-5 | Scale (MVP) | 50 organizations, 250k devices total, without architectural changes. |
| NFR-6 | Sync freshness | Full inventory sync at least every 24 h; incremental/targeted refresh on demand. Exact achievable rate depends on Google API quotas (open question). |
| NFR-7 | Durability | Point-in-time recovery for PostgreSQL; RPO ≤ 15 min, RTO ≤ 4 h. |
| NFR-8 | Observability | Structured logs, metrics, traces with tenant ID tagging; no student PII in logs. |
| NFR-9 | Accessibility | WCAG 2.1 AA for staff UI. |
| NFR-10 | Data residency | US-hosted primary region for MVP. |
| NFR-11 | Maintainability | Typed end to end; ≥ 80% coverage on authorization, command engine, and audit modules. |
| NFR-12 | Supportability | Every provider call logs a correlation ID and the provider's request/operation ID where available. |
| NFR-13 | Honesty | No UI, API, or marketing surface may represent simulated, mocked, or unverified enforcement as real. Demo/sandbox tenants must be visibly labelled. |

## 7. Acceptance criteria (MVP)

The MVP is accepted when all of the following are demonstrated in a **real Google Workspace for Education test tenant with real enrolled ChromeOS devices**, not mocks:

1. **Tenant isolation:** Automated test suite demonstrates that a user in Org A cannot read or mutate any Org B record through any API route, and that direct SQL under the application role without the tenant context returns zero rows.
2. **Onboarding:** A new org admin can connect Google and see an accurate device inventory whose count matches the Google Admin console for the same scope.
3. **Device detail:** Device attributes displayed match the Directory API response, with provenance timestamps.
4. **Reboot command:** A reboot issued from SchoolOS reaches a test device, and SchoolOS displays the provider-reported states through to `EXECUTED_BY_CLIENT` with result, or `EXPIRED`/failure with the provider's message.
5. **Disable/re-enable:** Disable through SchoolOS results in the device showing as disabled in both SchoolOS and Google Admin console; re-enable reverses it. Both are audited.
6. **Approvals:** A powerwash request cannot be dispatched without the configured second approval, and the attempt is audited.
7. **Policy:** At least one policy setting written via SchoolOS is visible as applied in Google Admin console for the target org unit, and SchoolOS detects a manual change made in the Admin console as drift.
8. **Security events:** A device in developer mode (as reported by Google) generates a security event within one sync cycle.
9. **Audit:** Every action above appears in the audit log with actor, time, target, and outcome; the hash chain verifies.
10. **Retention:** Lowering a retention setting results in data older than the new window being purged by the scheduled job, with a purge record.
11. **Disconnect:** Disconnecting Google revokes stored credentials and halts sync within 5 minutes.
12. **Honesty review:** A reviewer confirms no screen shows a capability that was not exercised against a real device.
