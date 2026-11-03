# ChromeOS Integration

> **Status:** Proposed. Google is an **integration provider**. SchoolOS's product, customer relationship, and data model are independent of Google. Nothing here implies a partnership with or endorsement by Google.

## 0. How to read this document

Every capability is labelled:

- **[Verified-Docs]**: Confirmed in Google's official reference documentation (link given, date checked). *Not yet exercised against a real tenant.*
- **[Verified-Tenant]**: Exercised successfully against a real Google Workspace for Education test tenant with enrolled devices. **No capability has this label yet.**
- **[Assumption]**: Believed true from general knowledge or community sources, not confirmed in official reference docs. Must be verified before design depends on it.
- **[Unknown]**: We do not know. Listed in [`OPEN_QUESTIONS.md`](OPEN_QUESTIONS.md).

Docs verification date for items below: **2026-11-02**. Google changes these APIs; re-verify at the start of each milestone that depends on them.

## 1. Integration goals

1. Read the district's ChromeOS device inventory and org-unit structure.
2. Issue remote device commands and track their real execution status.
3. Read and (for a limited, enumerated set) write Chrome policies at the org-unit level.
4. Derive deterministic security events from Google-reported device state.
5. Later (M6): deploy a SchoolOS Chrome extension via policy to enable features Google's APIs do not provide (e.g. classroom features, SchoolOS-native filtering), subject to verification and privacy review.

## 2. Google API surfaces

### 2.1 Admin SDK Directory API: ChromeOS devices

Reference: <https://developers.google.com/workspace/admin/directory/reference/rest/v1/chromeosdevices>

| Capability | Status | Notes |
| --- | --- | --- |
| `chromeosdevices.list` / `get`: device inventory | [Verified-Docs] | Paginated. Fields include `deviceId`, `serialNumber`, `status`, `lastSync`, `annotatedUser`, `annotatedLocation`, `annotatedAssetId`, `notes`, `model`, `osVersion`, `platformVersion`, `firmwareVersion`, `bootMode` (`Verified` / `Dev`), `orgUnitPath`, `orgUnitId`, `recentUsers`, `activeTimeRanges`, `macAddress`, `lastKnownNetwork`, `tpmVersionInfo`, `osUpdateStatus`, `autoUpdateThrough`, `osVersionCompliance`, `deviceLicenseType`, CPU/RAM/disk reports, and more. |
| Device `status` values | [Verified-Docs] | Includes `ACTIVE`, `DELINQUENT`, `PRE_PROVISIONED`, `DEPROVISIONED`, `DISABLED`, `INACTIVE`, `RETURN_ARRIVED`, and others. |
| `chromeosdevices.patch` / `update`: annotations and OU | [Verified-Docs] | Updatable: `annotatedUser`, `annotatedLocation`, `notes`, `orgUnitPath`, `annotatedAssetId`. |
| `chromeosdevices.moveDevicesToOu` | [Verified-Docs] | Bulk move to an org unit. |
| `chromeosdevices.action` | [Verified-Docs] **deprecated** | Do not use; replaced by `batchChangeStatus`. |
| `customer.devices.chromeos.batchChangeStatus` | [Verified-Docs] | Actions: `DEPROVISION` (requires `deprovisionReason`), `DISABLE`, `REENABLE`. **Max 50 device IDs per request.** Per-device result or error. Docs note license-pool side effects depending on upgrade type. Scope: `https://www.googleapis.com/auth/admin.directory.device.chromeos`. |
| `deviceFiles[]`, `screenshotFiles[]` download URLs | [Verified-Docs] | Populated by log/support-packet/screenshot commands. Access mechanics of `downloadUrl` (auth, lifetime) are [Unknown]. |

### 2.2 Admin SDK Directory API: remote commands

References:
- <https://developers.google.com/workspace/admin/directory/reference/rest/v1/customer.devices.chromeos/issueCommand>
- <https://developers.google.com/workspace/admin/directory/reference/rest/v1/customer.devices.chromeos.commands>

`POST https://admin.googleapis.com/admin/directory/v1/customer/{customerId}/devices/chromeos/{deviceId}:issueCommand` returns a `commandId`; status via `customer.devices.chromeos.commands.get`. Scope: `https://www.googleapis.com/auth/admin.directory.device.chromeos`. [Verified-Docs]

| Command type | Status | Documented constraints |
| --- | --- | --- |
| `REBOOT` | [Verified-Docs] | Kiosk and managed guest session devices, and regular devices running ChromeOS 113+. Optional payload `user_session_delay_seconds` (0–300), only respected when a user is logged in. |
| `TAKE_A_SCREENSHOT` | [Verified-Docs] | **Only available in Kiosk mode.** Not usable for student sessions. |
| `SET_VOLUME` | [Verified-Docs] | **Kiosk and managed guest session devices only.** Payload `{ "volume": 0–100 }`. |
| `WIPE_USERS` | [Verified-Docs] | Removes all user profile data; keeps device policy and enrollment. |
| `REMOTE_POWERWASH` | [Verified-Docs] | Factory reset; removes enrollment unless forced/auto re-enrollment applies. Irreversible. |
| `DEVICE_START_CRD_SESSION` | [Verified-Docs] | Starts Chrome Remote Desktop. Optional payload `ackedUserPresence`, `crdSessionType` (`private` or `shared`, default `shared`). Result payload contains a session URL that requires authentication with the issuing admin's email. |
| `FETCH_CRD_AVAILABILITY_INFO` | [Verified-Docs] | Returns idle time, user session type, and availability of shared/private sessions. |
| `CAPTURE_LOGS` | [Verified-Docs] | System logs of a **kiosk** device; retrieved via `deviceFiles`. |
| `FETCH_SUPPORT_PACKET` | [Verified-Docs] | Zip of logs/debug data; selectable data collectors; retrieved via `deviceFiles`. |

**Command states** [Verified-Docs]: `PENDING`, `EXPIRED`, `CANCELLED`, `SENT_TO_CLIENT`, `ACKED_BY_CLIENT`, `EXECUTED_BY_CLIENT`. **Result types:** `IGNORED`, `FAILURE`, `SUCCESS`, with `executeTime` and `errorMessage`. Commands have a `commandExpireTime`.

**Implications for SchoolOS:**
- MVP commands: `REBOOT`, `WIPE_USERS`, `REMOTE_POWERWASH`, plus status changes `DISABLE` / `REENABLE` / `DEPROVISION` via `batchChangeStatus`.
- `TAKE_A_SCREENSHOT` and `SET_VOLUME` are **not** general student-device features. They must not be offered for regular user sessions.
- CRD remote sessions: the session URL is bound to the issuing admin's Google identity. How this works when SchoolOS issues the command with service credentials (whose email is "the issuer"?) is [Unknown] and likely makes CRD unsuitable to broker through SchoolOS without further research. **Deferred until verified.**
- The cancel endpoint for commands is not listed among the documented `commands` methods (only `get` was listed). Cancellation from SchoolOS is therefore [Unknown]. Our `cancelled` state only applies before dispatch until verified.
- Rate limits and quotas for `issueCommand` and `list` are [Unknown] for our use case.

### 2.3 Chrome Policy API

Reference: <https://developers.google.com/chrome/policy/reference/rest>

| Capability | Status | Notes |
| --- | --- | --- |
| `customers.policies.resolve`: resolved policy values for a target | [Verified-Docs] | Used for drift detection and preview. |
| `customers.policies.orgunits.batchModify` / `batchInherit` | [Verified-Docs] | Write OU-level policy or revert to inherited. |
| `customers.policies.groups.batchModify` / `batchDelete` / priority ordering | [Verified-Docs] | Group-targeted policies. **Which policy schemas support group targeting** is [Unknown]; must be read from schemas. |
| `customers.policies.networks.*` | [Verified-Docs] | Define/remove networks and certificates. Not in MVP. |
| `customers.policySchemas.list` / `get` | [Verified-Docs] | Source of truth for available policy keys. **SchoolOS setting catalog entries must cite a schema name retrieved from a real tenant.** |
| `media.upload` | [Verified-Docs] | Policy file uploads. Not in MVP. |
| Specific schemas (e.g. developer mode blocking, URL blocklist, extension force-install) | [Assumption] | Exact schema names and fields must be confirmed via `policySchemas.list` in the test tenant before being added to the catalog. |
| OAuth scopes for Chrome Policy API | [Assumption] | Expected `https://www.googleapis.com/auth/chrome.management.policy` (read/write) and a `.readonly` variant. Confirm on method reference pages. |

### 2.4 Chrome Management API

Reference: <https://developers.google.com/chrome/management/reference/rest>

| Capability | Status | Notes |
| --- | --- | --- |
| `customers.reports.*`: fleet reports | [Verified-Docs] | Includes `countChromeVersions`, `countInstalledApps`, `countChromeDevicesThatNeedAttention`, `countChromeDevicesReachingAutoExpirationDate`, `countDevicesPerBootType`, `countDevicesPerReleaseChannel`, `countActiveDevices`, `countChromeHardwareFleetDevices`, print-job reports, and others. |
| `customers.telemetry.devices` `list` / `get` | [Verified-Docs] | Device telemetry. Exact fields, required per-device reporting policies, and freshness are [Unknown] until tested. |
| `customers.telemetry.events.list` | [Verified-Docs] | Telemetry events. Which event types exist and their latency are [Unknown]. |
| `customers.telemetry.notificationConfigs` | [Verified-Docs] | Create/list/delete (v1). Believed to deliver notifications via Google Cloud Pub/Sub; [Assumption] until tested. Potential push-based event ingestion. |
| `customers.telemetry.users` | [Verified-Docs] | User-level telemetry. **Privacy review required before use.** |
| `customers.apps.*`: app details, extension install requests | [Verified-Docs] | |
| `customers.profiles.*` and `profiles.commands` | [Verified-Docs] | Chrome browser profiles (managed browsers), not ChromeOS device commands. Out of MVP scope. |
| `customers.enterprise.securityInsights.*`, `connectorConfigs` | [Verified-Docs] | Exist; relevance, licensing, and privacy impact are [Unknown]. Not in MVP. |
| Some resources exist only under `v1alpha1` | [Verified-Docs] | Do not depend on alpha resources for MVP. |

### 2.5 Admin SDK Reports API (audit activities)
- Existence of Chrome-related audit activity reports: [Assumption]. Needs verification of application names, event types, and latency before use for security events. Not in MVP.

### 2.6 Google Classroom API / rosters
- Rosters for teacher features (M6): [Assumption] that Classroom API provides course and roster read access with appropriate scopes. Not in MVP; requires privacy review.

## 3. Chrome extension capabilities (post-MVP, M6)

| Capability | Status | Notes |
| --- | --- | --- |
| `chrome.enterprise.deviceAttributes` | [Verified-Docs] <https://developer.chrome.com/docs/extensions/reference/api/enterprise/deviceAttributes> | **ChromeOS only; force-installed by policy only.** Methods: `getDirectoryDeviceId`, `getDeviceSerialNumber`, `getDeviceAssetId`, `getDeviceAnnotatedLocation`, `getDeviceHostname`. Return empty string if the current user is **not affiliated**. Google states serial number access is for device administration and must not be used for tracking without administrator consent. |
| `webRequestBlocking` under Manifest V3 | [Verified-Docs] <https://developer.chrome.com/docs/extensions/reference/api/webRequest> | Not available to most MV3 extensions, but **policy-installed extensions can continue to use it**. `declarativeNetRequest` is the general alternative. |
| Force-install via policy prevents user removal | [Assumption] | Widely understood behaviour; verify in test tenant. |
| `chrome.enterprise.platformKeys` for device-bound keys / attestation | [Assumption] | Candidate for strong extension-to-server authentication. Needs research. |
| Tab/screen observation for teacher tools (`tabs`, `tabCapture`, etc.) | [Unknown] | Capability, user-visible indicators, performance, and privacy implications must be prototyped and reviewed. **No commitments.** |
| Extension behaviour in guest / unaffiliated / managed guest sessions | [Unknown] | |

The SchoolOS extension is our own code, distributed under our own developer account. It does not use, embed, or depend on any competitor's extension.

## 4. Authorization model with Google

Two broad options exist. Which to use is a **key open question** because it affects security, onboarding friction, and Google review requirements.

| Option | Description | Pros | Cons / unknowns |
| --- | --- | --- | --- |
| **A. OAuth with admin consent** | A district Google super admin authorizes SchoolOS's OAuth client; we store a refresh token per tenant. | No customer-managed keys; consent visible to the admin; revocable by the customer in Google. | Token tied to the authorizing admin's account and privileges (if that admin leaves, the integration breaks) [Assumption]. OAuth app verification and possible security assessment for sensitive/restricted scopes [Unknown]. |
| **B. Service account + domain-wide delegation** | District admin grants our service account client ID scopes in the Admin console; we impersonate an admin user. | Not tied to one interactive consent; common for server integrations. | We hold one powerful key; impersonation still requires an admin subject [Assumption]. Higher blast radius on compromise. |
| **C. Google Workspace Marketplace app** | Distribute via Marketplace with admin install. | Discoverable; admin-install flow. | Listing requirements, review process, and whether it changes the auth mechanics are [Unknown]. |

**Proposed direction (pending verification):** Option A with a dedicated "SchoolOS integration" admin account recommended to districts (custom admin role with minimum privileges, if Google's custom admin roles support the required privileges: [Unknown]). Decision to be captured in a new ADR after the M0 spike.

## 5. Licensing and partner-access dependencies

| Dependency | Status | Why it matters |
| --- | --- | --- |
| Chrome Education Upgrade (or equivalent device license) on each managed device | [Assumption] | Device management and API visibility of enrolled ChromeOS devices are believed to require per-device upgrade licenses. Directory API does expose `deviceLicenseType`. |
| Google Workspace for Education edition | [Unknown] | Whether specific APIs (e.g. telemetry, security insights) require paid editions. |
| Google Cloud project per environment with APIs enabled | [Assumption] | Standard for Google APIs. |
| OAuth app verification / security assessment for requested scopes | [Unknown] | May take weeks; must start early (M0). |
| Google partner programs (e.g. Google for Education partner programs, Chrome Enterprise partner programs) | [Unknown] | Whether any program is **required** for API access, preferred by districts, or gives access to additional capabilities. Investigate as a business task in M0; do not assume. |
| API quotas | [Unknown] | Affects sync frequency and bulk command throughput. |
| Terms of service restrictions on use of data obtained via Google APIs | [Unknown] | Must review Google API Services User Data Policy and Workspace API terms. |

## 6. Device enrollment

- **ChromeOS enrollment is performed by the district in Google** (manual enterprise enrollment or zero-touch / pre-provisioned enrollment, where the device `status` can be `PRE_PROVISIONED` [Verified-Docs]). SchoolOS does not enroll ChromeOS devices.
- SchoolOS "onboards" devices by syncing them from the Directory API and linking `deviceId` → SchoolOS `device`.
- Optional (post-MVP): SchoolOS writes `annotatedAssetId` / `notes` back to Google if the district opts in.
- Extension deployment (M6): the district (or SchoolOS via Chrome Policy API, if scopes allow and the district approves) force-installs the SchoolOS extension for target OUs.

## 7. Known limitations

1. Several commands are restricted to kiosk/managed guest sessions (`TAKE_A_SCREENSHOT`, `SET_VOLUME`, `CAPTURE_LOGS`) [Verified-Docs].
2. `REBOOT` for regular user sessions requires ChromeOS 113+ [Verified-Docs].
3. `batchChangeStatus` accepts at most 50 devices per call [Verified-Docs]; bulk actions must be chunked.
4. Command delivery depends on the device being online and checking in; commands can expire [Verified-Docs].
5. Extension device attribute APIs return empty values for unaffiliated users [Verified-Docs].
6. Google data freshness (e.g. `lastSync`, telemetry) is controlled by Google and device reporting policies; we cannot make it real-time.
7. Remote desktop session brokering through a third-party service is unverified (§2.2).
8. Policy targeting granularity is org units (and groups for some schemas); SchoolOS device groups that do not map to an OU or group cannot be enforced via Google policy.

## 8. Fallback strategies

| If… | Then… |
| --- | --- |
| A command is not supported for a device's session type or OS version | Hide it for that device with an explanation; never show it as "sent." |
| A policy setting cannot be targeted at the SchoolOS scope | Require the admin to target an OU; or mark setting `not_applicable` for that scope. |
| Google API access requires a lengthy verification or partner process | Start the process in M0; build against a test tenant under internal/testing app status while waiting; adjust GTM dates rather than shipping unverified features. |
| Quotas limit sync frequency | Incremental/targeted refresh for viewed devices; nightly full sync; display freshness. |
| Telemetry push (notification configs) is unavailable or unsuitable | Poll on a schedule; derive events from diffs. |
| Extension-based features are blocked by platform limits or privacy review | Ship ChromeOS management without them; prioritize native Linux agent for richer enforcement. |
| Google changes or deprecates an API | Provider adapter isolates impact; capability registry disables affected features; customers informed. |
| A district cannot grant needed scopes | Degrade to read-only inventory mode with clear UI messaging. |

## 9. Verification plan (M0 spike)

Using a dedicated Google Workspace for Education test tenant (company-owned, not a customer tenant) with at least 3 enrolled Chromebooks with valid device upgrade licenses:

1. Create OAuth client; complete admin consent; record exact scopes granted.
2. `chromeosdevices.list`: confirm fields populated in practice; measure latency and pagination.
3. `issueCommand REBOOT` on a device with a logged-in user (ChromeOS ≥ 113): observe all states and timings.
4. `batchChangeStatus DISABLE` / `REENABLE`: confirm effect on device and Admin console.
5. `policySchemas.list`: export the schema catalog; identify schemas for the initial setting catalog.
6. `policies.resolve` and `orgunits.batchModify` for one low-risk setting; confirm in Admin console.
7. `telemetry.devices.list`: determine which fields are populated and which device reporting policies are required.
8. Test `DEVICE_START_CRD_SESSION` semantics to answer the issuer-identity question.
9. Document quotas observed and any errors.

Each verified item moves from [Verified-Docs] to [Verified-Tenant] in this document, with date and tester.
