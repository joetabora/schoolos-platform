# ADR-0010: Never represent simulated enforcement as real

- **Status:** Accepted
- **Date:** 2026-11-02
- **Related:** NFR-13, FR-POL-2, FR-CMD-3, CHROMEOS_INTEGRATION §0

## Context

Device security products are trusted by schools to actually enforce controls. Showing a control as active when it is mocked, simulated, unverified, or unsupported on a platform creates false assurance, safety risk for students, and legal/reputational risk.

## Decision

- Every policy setting and command carries an enforcement mechanism per platform; `unsupported` is a first-class value and is shown in the UI.
- Command and policy results come only from provider/agent confirmations. Dispatch is not success.
- Mock providers exist only for automated tests and for demo organizations flagged `is_demo`. Demo orgs display a persistent "Simulated data" banner and cannot connect to real providers.
- Capabilities are labelled [Verified-Docs], [Verified-Tenant], [Assumption], or [Unknown] in CHROMEOS_INTEGRATION; only [Verified-Tenant] capabilities may be offered to production customers.
- Marketing and sales material follow the same rule.

## Consequences

- Some features will appear later than competitors' claims. This is acceptable.

## Verification

Launch gate review (M5) includes a screen-by-screen honesty review; tests assert mock providers cannot be configured for non-demo orgs.
