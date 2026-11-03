# ADR-0017: Audit log design — hash-chained core records, redactable details, signed checkpoints, prefix-only purge, separate platform chain

- **Status:** Accepted
- **Date:** 2026-11-02
- **Deciders:** Founding engineering team
- **Related:** DATA_MODEL §3.7, SECURITY_MODEL §9, PRIVACY_AND_COMPLIANCE §5; ARCHITECTURE_READINESS_REVIEW C-1, C-2, D-5, DB-3, DB-4, S-12

## Context

Audit logs must be tamper-evident (append-only, hash-chained) and also subject to retention limits and data-subject deletion. Deleting or editing hashed rows would break the chain.

## Decision

1. **Core records (`audit_logs`) contain opaque identifiers only** (UUIDs, action codes, outcome, timestamps, correlation ID, `details_id`, `prev_hash`, `hash`, `hash_version`). No emails, names, IP addresses, user agents, or free text.
2. **Detail records (`audit_log_details`)** hold human-readable or personal data (actor email at time of action, IP, user agent, display metadata). They aren't part of the hash and can be **redacted** (fields nulled, `redacted_at` set) under retention or data-subject deletion without breaking the chain.
3. **Hash chain** per organization: `hash = SHA-256(prev_hash ‖ canonical(core row))`, using a documented, versioned canonical serialization. Writes are serialized per organization with `pg_advisory_xact_lock`.
4. **Signed checkpoints (`audit_checkpoints`)** record `(organization_id, seq, hash, created_at, signature, key_id)`. Signatures use an asymmetric **AWS KMS** signing key, so verifiers need only the public key and the application can't forge historical checkpoints without KMS access. Checkpoints are written periodically and always before a purge.
5. **Prefix-only purging:** retention purges delete only a contiguous range from the oldest `seq` up to a checkpointed `seq`. They run as a dedicated `audit_maintainer` DB role, never as `app_user`. Verification starts from the newest checkpoint at or before the first remaining row.
6. **Separate platform audit chain (`platform_audit_logs`)** for events with no organization (org creation by operator CLI, verification results, platform administration). It isn't accessible to tenant-facing roles.
7. **Write semantics:** successful actions write their audit row in the **same transaction** (if the audit insert fails, the action fails). Denied or errored actions are written in a **separate** transaction after rollback.
8. `app_user` has `INSERT`/`SELECT` only on audit tables. No role used at runtime can `UPDATE` or `DELETE` core audit rows.
9. **External anchoring** of checkpoint hashes to write-once storage is planned (OPEN_QUESTIONS T-10), not required in M1.

## Consequences

- Readers join core and detail rows. Exports show `[redacted]` where details were redacted.
- Per-org write serialization; throughput target checked in M1 (review A-6).
- Requires a KMS asymmetric key per environment (ADR-0018).

## Verification

M1 tests (review TST-5): `UPDATE`/`DELETE` as `app_user` fail; any change to a hashed field is detected; redacting details doesn't affect verification; purge plus checkpoint still verifies; a forged checkpoint signature is rejected.
