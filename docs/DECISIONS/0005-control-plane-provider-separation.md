# ADR-0005: Separate control plane from provider/OS integrations

- **Status:** Proposed
- **Date:** 2026-11-02
- **Related:** SYSTEM_ARCHITECTURE §3, §12; CHROMEOS_INTEGRATION

## Context

SchoolOS starts with ChromeOS via Google APIs and later adds a native Linux agent and our own OS. Google is an integration provider and must not shape the core product model. Google API capabilities may change.

## Decision

- Core domain modules (devices, policies, commands, events, audit) are platform-neutral.
- Each provider (Google, SchoolOS agent) implements narrow interfaces: `DeviceInventoryProvider`, `CommandProvider`, `PolicyProvider`, and event sources.
- Each provider exposes a **capability registry** (`supportedCommands()`, setting catalog mappings) that is the only source for what the UI offers per platform. Entries require a verification reference.
- Provider-specific identifiers live in link tables (`device_provider_links`), not as primary identity.

## Consequences

- Positive: adding the Linux agent does not require changing command/policy semantics; Google API changes are contained.
- Negative: some translation code; provider-specific features need an explicit capability entry.

## Verification

Lint rule: `src/modules/**` cannot import `src/providers/**`. Adding a capability without a docs or tenant verification reference fails review.
