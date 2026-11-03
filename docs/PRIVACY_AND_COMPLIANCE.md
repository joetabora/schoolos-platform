# Privacy and Compliance

> **Important:** This document records engineering and product considerations. It is **not legal advice** and **SchoolOS does not claim compliance** with FERPA, COPPA, CIPA, state student-privacy laws, or any other law or framework. All items below must be reviewed and validated by qualified education-privacy counsel before customer launch. Where this document says "must," it is an internal product requirement, not a statement of what the law requires.

## 1. Roles and posture

- **The school district (organization) is the customer** and decides what data is collected and why. SchoolOS acts on the district's behalf and under its direction.
- SchoolOS intends to operate as a service provider to schools under contract (commonly analyzed under FERPA's "school official" exception). Whether and how that exception applies depends on the contract terms and actual practices. **Counsel review required.**
- SchoolOS does not sell student data, use it for advertising, or build profiles of students for non-educational purposes. These are product commitments to be written into customer contracts and the privacy policy.

## 2. Regulatory considerations (to validate with counsel)

| Area | Why it is relevant | Engineering implications (draft) |
| --- | --- | --- |
| **FERPA** (US federal) | Device and usage data tied to identifiable students may be part of education records. | District-controlled access; ability to support district responses to parent/eligible-student access requests; no redisclosure; contractual use restrictions; audit of access. |
| **COPPA** (US federal) | Students under 13 use the devices. FTC guidance has historically allowed schools to authorize collection in the educational context in place of individual parental consent, limited to educational purposes. The FTC amended the COPPA Rule in 2025; current requirements must be confirmed by counsel. | Collect only for the school's educational/security purpose; no commercial use; written security program; retention limits; deletion on request; school authorization captured in contract. |
| **CIPA** (US federal, E-rate) | Districts receiving E-rate funding have internet-safety obligations. SchoolOS may be *part* of how a district meets them, later (filtering is M6+). | Do not claim to make a district "CIPA compliant." Document what technical measures we provide. |
| **PPRA** (US federal) | Governs certain surveys/information collection from students. | Not expected to apply to MVP; re-review if student-facing features are added. |
| **State student-privacy laws** (e.g. California SOPIPA, New York Education Law §2-d, Illinois SOPPA, and many others) | Many states impose operator obligations: use restrictions, security requirements, breach notification, data-privacy agreements, public posting of contracts or sub-processors. | Support state-specific DPAs; maintain sub-processor list; configurable retention; breach-notification runbook; data inventory. State-by-state review needed before selling in each state. |
| **State breach-notification laws** | Timelines and content vary. | Incident response runbook must include legal notification steps (SECURITY_MODEL §12). |
| **Data Privacy Agreements** (e.g. Student Data Privacy Consortium templates) | Districts frequently require them. | Product must be able to meet common DPA clauses: deletion on termination, no secondary use, sub-processor notice, security controls. |
| **Accessibility** (Section 508, ADA) | Public schools' procurement requirements. | WCAG 2.1 AA target for staff UI. |

## 3. Data minimization

### 3.1 Principles
- Collect only data needed for a feature the district has enabled.
- Prefer device-level data over person-level data. Prefer aggregates over raw events.
- Store provider fields via **explicit allow-lists**; unknown fields from provider payloads are dropped at ingestion.
- No data collected "in case it's useful later."

### 3.2 MVP data inventory

| Category | Examples | Source | Contains student-identifying data? | Default retention (proposed) |
| --- | --- | --- | --- | --- |
| Staff accounts | name, email, role, login times | SchoolOS / IdP | No (staff) | Life of account + 90 days |
| Device inventory | serial, model, OS version, org unit, status, last sync | Google Directory API | Indirectly (via annotated user / recent users) | Life of device record |
| Device assignment | admin-annotated user | Google Directory API (`annotatedUser`) | **Yes** | Life of device record |
| Recent device users | managed user emails reported by Google (`recentUsers`) | Google Directory API | **Yes** | **Not stored by default.** Shown live on demand only; storing requires an explicit org setting (open question) |
| Network identifiers | MAC address, last known IP / WAN IP | Google Directory API | Potentially | **Not stored by default** in MVP |
| Device snapshots | allow-listed hardware/health attributes | Google | No (device-level) | 90 days |
| Commands | type, target device, requester, reason, results | SchoolOS | Possibly in staff-entered reason | 2 years (aligned with audit) |
| Security events | rule, device, evidence fields | SchoolOS | Possibly | 1 year |
| Audit logs | actor, action, target | SchoolOS | Staff yes; students indirectly | Minimum per contract, proposed 2 years |
| Raw provider payloads | for debugging/provenance | Google | Possibly | 14 days |

### 3.3 Explicitly not collected in MVP
Browsing history, URLs visited, page content, screenshots of student sessions, keystrokes, messages, microphone/camera, precise location, biometric data, student grades or demographics.

## 4. Monitoring transparency

- **District transparency:** each organization has a *Data & Monitoring* page listing every enabled capability, what it collects, the enforcement mechanism, and retention. This page can be exported for the district's own notices to families.
- **Student/user transparency (post-MVP, extension/agent features):** any feature that observes student activity (e.g. teacher screen view in M6) must:
  - be off by default and enabled per organization;
  - display a visible on-device indicator while active, where the platform allows;
  - be time-bounded (e.g. only during scheduled class periods);
  - be documented in the district-facing data inventory.
- **Remote desktop / remote access:** default to user-presence acknowledgement and shared sessions where supported; audited (SECURITY_MODEL §10).
- **No covert modes.** We will not build features designed to hide monitoring from the device user.
- **Honest capability claims:** marketing and UI must not describe capabilities that are simulated or unverified.

## 5. Retention and deletion

- Retention is configurable per organization per data category within platform bounds (DATA_MODEL `retention_settings`).
- Scheduled purge jobs delete data older than the retention window and write a `purge_runs` record (counts only, no deleted content).
- **Backups:** deleted data persists in encrypted backups until backup expiry (proposed ≤ 35 days). This must be disclosed in contracts.
- **Per-student requests:** district staff can submit a data-subject request (export or deletion) for an identifier; the system locates matching records (annotated user, audit references, events) and executes or reports what cannot be deleted (e.g. audit records required by contract, with identifiers pseudonymized where possible).
- **Offboarding:** on contract termination, provider credentials are revoked immediately, data is exportable for a defined window (proposed 30 days), then deleted; a deletion certificate is generated.

## 6. Access controls

- Least privilege via roles with school scopes (SECURITY_MODEL §5).
- Student-identifying fields (annotated user, recent users) require `device.read_user_identity` permission, separate from `device.read`.
- All access to student-identifying data via exports is audited.
- SchoolOS staff: no standing access; customer-granted time-boxed support access only; visible in the customer's audit log.
- Production database access for engineers is break-glass only.

## 7. School authorization

Before SchoolOS processes data for an organization, the following must exist and be recorded in `subscriptions.contract_ref` or a related record:

1. Signed customer agreement including data-processing terms / DPA.
2. Identification of the district's authorized representative.
3. District acknowledgement of the capabilities being enabled and their data collection (generated from the Data & Monitoring page).
4. For Google integration: the authorization is granted by a Google Workspace super admin (or delegated admin with sufficient privileges) of that district's own Google customer, through Google's consent mechanism. SchoolOS never asks for Google admin passwords.

Feature flags that expand data collection (e.g. storing recent users, future screen view) require an org-owner action with an audit record.

## 8. Sub-processors

Maintain a public sub-processor list (cloud host, database provider, IdP, email delivery, error tracking). Known so far: **AWS** (hosting, database, secrets, in `us-east-2`) and **Supabase** (staff identity and MFA records only; no student, device, or application data). The email provider is open (OPEN_QUESTIONS T-18). Error-tracking and analytics tools must be configured to exclude student data, or not used on pages that render it.

## 9. Items requiring legal validation (tracked in OPEN_QUESTIONS)

- Applicability and conditions of the FERPA school-official exception to SchoolOS's contract and practices.
- COPPA obligations under the current (amended) rule when operating on behalf of schools, including written security program and retention-policy requirements.
- Whether storing `recentUsers` or network identifiers changes our obligations.
- State-by-state requirements for initial target states.
- Breach-notification timelines to commit to in contracts.
- Whether SchoolOS should sign the Student Privacy Pledge or adopt a standard DPA template.
- Data residency commitments.
