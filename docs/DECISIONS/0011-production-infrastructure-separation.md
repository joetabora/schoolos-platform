# ADR-0011: Production infrastructure separate from personal/home infrastructure

- **Status:** Accepted
- **Date:** 2026-11-02
- **Related:** SYSTEM_ARCHITECTURE §14, SECURITY_MODEL §7

## Context

Early-stage projects are often run on a developer's home server or personal cloud account. For a product holding student data and admin credentials to school device fleets, that is unacceptable: weak physical security, no attestation, single-person access, unclear data ownership, and contractual exposure.

## Decision

- Production (and staging) run only on managed cloud infrastructure in **company-owned accounts** with MFA, least-privilege IAM, and audit logging.
- Environments are isolated in separate accounts/projects with separate credentials.
- Developer home servers may be used only for local development with synthetic data and a non-customer Google test tenant. They never hold customer data, production secrets, or production Google credentials.
- Infrastructure is defined as code; manual production changes require break-glass procedure.

## Consequences

- Hosting costs from M1 for staging and from M5 for production.

## Verification

Security review checklist at M5 confirms no production resources or secrets outside company-owned accounts.
