# ADR-0001: Record architecture decisions

- **Status:** Accepted
- **Date:** 2026-11-02
- **Deciders:** Founding engineering team

## Context

SchoolOS handles student-related data and remote device control for schools. Decisions about tenancy, security, and integrations must be explainable to future engineers, auditors, and district security reviewers.

## Decision

Use lightweight Architecture Decision Records in `docs/DECISIONS/`, using the template in `0000-template.md`.

## Consequences

- Positive: traceable reasoning; easier onboarding; evidence for security questionnaires.
- Negative: small overhead per decision.

## Verification

PR reviewers ask "does this need an ADR?" for changes touching the areas listed in the ADR README.
