# Security Model

> **Status:** Draft v0.1. This document defines required controls. Each control must have an owner and a verification method (test, review, or operational check) before the MVP launch gate (M5).

## 1. Security objectives

1. **Tenant isolation:** no organization can access another organization's data or devices.
2. **Command integrity:** a device or provider only executes commands that were genuinely authorized by an authorized human in the device's own organization.
3. **Accountability:** every security-relevant action is attributable and recorded in a tamper-evident log.
4. **Least privilege:** for staff, SchoolOS employees, services, and provider credentials.
5. **Confidentiality of student data** in transit, at rest, and in operational tooling (logs, backups, support).
6. **Honest state:** the system never reports an action as enforced or executed without confirmation.

## 2. Assets

| Asset | Why it matters |
| --- | --- |
| Google integration credentials (OAuth refresh tokens / service account keys) | Grant admin-level control over a district's devices. Highest-value secret. |
| Command signing keys (future agent) | Allow arbitrary actions on devices. |
| Device private keys / certificates (future) | Device impersonation, fake events. |
| Staff sessions | Account takeover → commands, data access. |
| Student-related data (device assignments, user emails reported by Google, events) | Privacy obligations (see PRIVACY_AND_COMPLIANCE). |
| Audit logs | Evidence; must be trustworthy. |
| Production infrastructure access | Total compromise. |

## 3. Threat model

Method: STRIDE per component, re-reviewed at each milestone that adds an external surface (M2 Google, M6 extension, M7 agent).

### 3.1 Actors

- **External attacker** (internet): credential stuffing, web vulns, supply chain.
- **Malicious or compromised staff user** in a tenant: abuse of legitimate permissions, attempts to escalate or access other schools/tenants.
- **Student**: attempts to bypass controls, tamper with the extension/agent, forge events, impersonate devices.
- **Malicious insider at SchoolOS**: unauthorized data access, silent changes.
- **Compromised dependency or CI pipeline.**
- **Compromised provider credential** (stolen Google token).

### 3.2 Key threats and mitigations

| # | Threat | Category | Mitigation |
| --- | --- | --- | --- |
| T1 | Cross-tenant data access via IDOR or missing tenant filter | Info disclosure / EoP | Server-side `authorize()` on every route; RLS forced on all tenant tables; composite tenant FKs; automated cross-tenant tests in CI |
| T2 | Tenant context leak across pooled DB connections | Info disclosure | `SET LOCAL` only inside transactions; lint rule banning session `SET`; test that runs concurrent requests across tenants |
| T3 | Staff account takeover | Spoofing | MFA required for privileged roles; rate limiting and lockout; breached-password checks if IdP supports; session binding and short idle timeout |
| T4 | Privilege escalation via role management | EoP | Only `member.manage` holders can change roles; cannot grant permissions they do not hold; all changes audited and notified to org owners |
| T5 | Abuse of destructive commands (mass powerwash) | Tampering / DoS | Approval workflow; bulk caps; step-up auth; rate limits; delayed execution window with cancel for bulk destructive commands; alert org owners |
| T6 | Stolen Google credentials from our DB | Info disclosure / EoP | Envelope encryption with KMS; credentials readable only by worker role; no credentials in logs; minimal OAuth scopes; rotation and revocation procedure |
| T7 | Forged or replayed commands to agent (future) | Spoofing / Tampering | Signed commands, nonces, expiry, device-bound target, monotonic sequence (see §6) |
| T8 | Device impersonation / fake events (future) | Spoofing | Per-device keys (TPM-backed where possible), mTLS, enrollment tokens single-use and short-lived, certificate revocation |
| T9 | Student tampering with extension/agent | Tampering | ChromeOS: policy force-install prevents removal by user (to be verified in M6); agent: OS-level protection on SchoolOS Linux; heartbeat-missing alerts. Tamper resistance is never claimed beyond what the platform guarantees |
| T10 | Audit log tampering | Repudiation | Append-only grants; hash chain; periodic external anchoring; separate export to write-once storage |
| T11 | Insider access to customer data | Info disclosure | No standing production data access; support access via customer-granted, time-boxed grants; break-glass with dual approval and audit |
| T12 | Supply-chain compromise | Tampering | Lockfiles, dependency review, automated vulnerability scanning, pinned CI actions, signed releases for the agent, SBOM |
| T13 | SSRF / injection via provider data | Tampering | Treat provider payloads as untrusted; schema validation; parameterized SQL only; output encoding in UI |
| T14 | Remote desktop session misuse | Info disclosure / privacy | Dedicated permission, reason, step-up, user-presence acknowledgement by default where provider supports it, prominent audit, org-level disable switch |
| T15 | Provider outage leads to false "success" | Integrity | `unknown` and `expired` states; never infer success; UI shows last provider confirmation time |

## 4. Device identity

### 4.1 ChromeOS (MVP)
- Device identity is **Google's** `deviceId` from the Directory API, scoped to the organization's connected Google customer.
- SchoolOS does not authenticate ChromeOS devices directly in MVP; all device actions are mediated by Google APIs using the organization's credentials.
- **Post-MVP extension:** a policy-installed extension can read the Directory device ID via `chrome.enterprise.deviceAttributes.getDirectoryDeviceId()` (documented; only for force-installed extensions and affiliated users; see CHROMEOS_INTEGRATION). This value is **an identifier, not a credential**; a student who can run code could spoof it. Extension-to-server authentication therefore needs a stronger mechanism (candidates: `chrome.enterprise.platformKeys` with verified access / remote attestation, to be researched; listed in OPEN_QUESTIONS).

### 4.2 Native agent (future)
- Enrollment with a single-use, short-lived, organization-scoped enrollment token.
- Device generates a key pair locally (TPM-resident when available); private key never leaves the device.
- Control plane issues an X.509 device certificate from an internal CA dedicated to device identity, with `organization_id` and `device_id` encoded.
- mTLS for all agent ↔ gateway traffic. Certificates short-lived (e.g. 30 days) with automatic renewal; revocation list checked by the gateway.

## 5. Authentication and authorization (staff)

- IdP: Supabase Auth initially (see ADR-0004), with SchoolOS owning users/memberships/roles.
- MFA: required for `org_owner`, `org_admin`, `school_admin`, `technician`, `security_analyst`; optional (configurable to required) for `auditor`.
- Step-up re-authentication (≤ 5 minutes since last auth) for: approving destructive commands, starting remote access, managing integrations, changing roles, exporting audit logs or data.
- Sessions: HTTP-only, `Secure`, `SameSite=Lax` cookies; idle timeout 30 min, absolute 12 h (configurable per org within bounds); CSRF protection on mutating requests.
- Authorization: permission-based RBAC with school scopes, checked server-side via a single `authorize()` path, plus RLS for tenant isolation. See SYSTEM_ARCHITECTURE §8.
- API tokens (post-MVP): scoped, expiring, hashed at rest, tied to a membership, auditable.

## 6. Signed commands and replay protection

### 6.1 Google-mediated commands (MVP)
Commands are sent via Google APIs over TLS using organization credentials. Google is responsible for delivery to the device. Our controls:
- Command intent persisted and audited **before** dispatch.
- Idempotency keys prevent duplicate dispatch from retries or double-clicks.
- Provider `commandId` stored; status polled and recorded.
- Expiry enforced on our side (do not dispatch after `expires_at`).

### 6.2 SchoolOS-native commands (extension or agent; future)
Every command delivered to a SchoolOS client is a signed envelope:

```json
{
  "v": 1,
  "kid": "cmd-signing-2027-01",
  "org": "<organization_id>",
  "device": "<device_id>",
  "cmd_id": "<command_target_id>",
  "type": "reboot",
  "params": {},
  "iat": 1798000000,
  "nbf": 1798000000,
  "exp": 1798000600,
  "nonce": "<128-bit random>",
  "seq": 4182
}
```

- **Signature:** Ed25519 over the canonical serialization; keys held in KMS/HSM, signing performed by the control plane only. Clients ship with / are provisioned with the public key set and support rotation via `kid`.
- **Client verification (all must pass):** signature valid for a trusted `kid`; `org` and `device` match the client's enrolled identity; `nbf ≤ now ≤ exp` with bounded clock skew; `nonce` not previously seen (client keeps a nonce cache for the validity window); `seq` greater than last executed `seq` for that device.
- **Results** are returned over the authenticated channel and signed by the device key, so the control plane can attribute them.
- Rejections (bad signature, expired, replay) are reported as security events.

## 7. Secrets management

- **No secrets in the repository, CI logs, client bundles, or database plaintext.** Secret scanning runs on every PR and push.
- Runtime secrets (DB credentials, IdP keys, KMS access) come from a managed secrets store, injected at runtime.
- **Per-tenant provider credentials:** envelope encryption — a data encryption key (DEK) per credential, wrapped by a KMS key encryption key (KEK). Decryption only in the worker, only at use time, never cached beyond the job.
- Rotation: KEK rotation annually or on suspicion; OAuth credentials revocable per tenant; procedure documented and tested in staging.
- Developers have no access to production secrets by default. Break-glass access requires two-person approval and is logged.
- Local development uses separate, non-production credentials and a separate Google test tenant.

## 8. Encryption

- **In transit:** TLS 1.2+ (1.3 preferred) everywhere, HSTS on the web app; internal traffic to the database over TLS; mTLS for agents.
- **At rest:** managed PostgreSQL with storage encryption; backups encrypted; object storage encrypted with KMS keys.
- **Application-level encryption** for provider credentials (envelope encryption) and any field designated highly sensitive.
- Password hashing is delegated to the IdP; SchoolOS never stores staff passwords.

## 9. Audit logging

- Scope: see FR-AUD-1 in PRODUCT_REQUIREMENTS.
- Each record includes actor, actor type, organization, action, target, outcome, timestamp, IP/user agent (for user actors), correlation ID.
- **Denied** authorization attempts on sensitive actions are logged too.
- Tamper evidence via per-organization hash chain; daily verification job; export to write-once storage.
- Audit logs are visible to the organization (org admins and auditors) including actions by SchoolOS support staff.
- Platform operational logs (application logs) are separate from audit logs, redact PII, and have shorter retention.

## 10. Remote access controls

- Remote access (e.g. Chrome Remote Desktop session via the Directory API `DEVICE_START_CRD_SESSION` command) is:
  - **disabled by default** per organization; an org owner must enable it;
  - gated by the `remote_access.start` permission;
  - requires a reason and step-up authentication;
  - requests user-presence acknowledgement / shared session by default where the provider supports it;
  - logged as a distinct audit action with start time, requester, target device, and session type.
- SchoolOS staff cannot initiate remote access to customer devices.

## 11. Secure development lifecycle

- Code review required for all changes; security-sensitive paths (auth, RLS migrations, command engine, crypto, provider credentials) require a designated reviewer (CODEOWNERS).
- CI: type check, lint, unit tests, RLS/isolation tests, dependency vulnerability scan, secret scan, SAST.
- Threat model updated when a new external surface is added.
- External penetration test before first production customer and annually thereafter.
- Dependency updates on a regular cadence; critical CVEs patched within defined SLAs (e.g. critical 72 h, high 14 days).

## 12. Incident response

### 12.1 Severity levels
| Sev | Example |
| --- | --- |
| SEV1 | Confirmed cross-tenant data exposure, credential compromise, unauthorized destructive commands |
| SEV2 | Suspected exposure, production outage affecting command or audit integrity |
| SEV3 | Degraded sync for multiple tenants, vulnerability with no evidence of exploitation |
| SEV4 | Minor issues |

### 12.2 Process
1. **Detect:** alerts, customer report, vulnerability disclosure.
2. **Triage:** assign incident commander; set severity; open private incident channel and timeline.
3. **Contain:** e.g. revoke provider credentials for affected tenants, disable command dispatch globally (kill switch), rotate signing keys, block sessions.
4. **Eradicate & recover:** fix, deploy, restore from backup if needed, verify audit chain.
5. **Notify:** affected districts within contractual and legal timeframes (to be defined with counsel; state laws vary). SchoolOS does not notify students/parents directly; the district is the controller, unless law or contract requires otherwise.
6. **Post-incident review:** blameless write-up, action items tracked to completion.

### 12.3 Required capabilities before M5
- Global **command dispatch kill switch** (per org and platform-wide).
- Ability to revoke all provider credentials for an organization in one action.
- Ability to force sign-out of all sessions for an organization.
- Documented on-call rotation and contact path.
- Published vulnerability disclosure policy (`security.txt`).
