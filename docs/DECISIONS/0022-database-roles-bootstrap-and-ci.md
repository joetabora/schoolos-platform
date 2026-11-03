# ADR-0022: Cluster bootstrap versus database-level runtime roles

- **Status:** Accepted
- **Date:** 2026-11-02
- **Deciders:** Founding engineering team
- **Related:** ADR-0003, ADR-0014; OPEN_QUESTIONS T-24; DATA_MODEL §4.2; [`SPIKE_DB_TOOLING_REPORT.md`](../SPIKE_DB_TOOLING_REPORT.md)

## Context

`CREATE ROLE` is cluster-scoped. The database-tooling spike created `schoolos_owner` in superuser bootstrap and created `app_user`, `app_auth`, and `app_org_enumerator` in a dbmate migration. Two databases on the same cluster cannot both apply that migration (T-24).

Passwords must stay out of migrations. Blind `CREATE ROLE IF NOT EXISTS` / `EXCEPTION WHEN duplicate_object` can accept an existing role that has `SUPERUSER` or `BYPASSRLS`.

M1 step 2 does not implement identity, tenancy tables, org enumeration, or audit. Creating those roles early expands privilege surface without a user.

## Decision

Separate **cluster-level bootstrap** from **database-level migrations**.

- **Bootstrap** (local/CI superuser; later the RDS master user) creates `schoolos_owner` (`LOGIN CREATEROLE`, no `SUPERUSER`, no `BYPASSRLS`, no `CREATEDB`), creates the application database owned by `schoolos_owner`, and revokes `PUBLIC` access as required. Passwords are provisioned out of band. Bootstrap is not a dbmate migration.
- **Migrations** run as `schoolos_owner` and create only the **runtime roles needed at the current implementation stage**. Step 2 creates `app_user` (`LOGIN`, no `SUPERUSER` / `BYPASSRLS` / `CREATEROLE` / `CREATEDB`, `NOINHERIT`) plus database-level `GRANT CONNECT` and schema privileges. Migrations do not create `schoolos_owner`.
- **Deferred** until the step that needs them: `app_auth` (identity / sessions), `app_org_enumerator` (scheduler org-id enumeration), `audit_maintainer` (audit purge / checkpoints). `platform_ops` remains M5 (DATA_MODEL §4.2).
- **CI and local development** use one PostgreSQL container and one database per job. Sharing a cluster across databases that each run the role migration is unsupported.
- **Never silently accept an existing role with incorrect privileges.** Role-attribute validation must inspect **every specified attribute** on **both** `schoolos_owner` and `app_user`, and assert the expected value of each — not merely that `app_user` is not a superuser. The six attributes are `LOGIN`, `SUPERUSER`, `BYPASSRLS`, `CREATEROLE`, `CREATEDB`, and `INHERIT`. Also verify ownership and grants against the least-privilege design (database owner, `CONNECT`, schema privileges). Creation or startup must fail closed if a name is taken by a role whose attributes are not exactly those specified. Do not use unconditional `IF NOT EXISTS` or swallow `duplicate_object`. Do not treat a `SUPERUSER`/`BYPASSRLS` check alone as sufficient. Do not create deferred roles in Step 2.

If a later milestone needs several databases on one cluster, a new ADR must move role creation to bootstrap **with attribute assertions**. That is not the Step 2 design.

## Alternatives considered

| Option | Pros | Cons |
| --- | --- | --- |
| One DB per cluster; runtime roles in migrations (chosen) | Matches CI; attributes are versioned SQL | Parallel DBs on one cluster cannot both migrate roles |
| All `CREATE ROLE` in bootstrap | Parallel DBs work | Role attributes leave dbmate history |
| Idempotent `CREATE ROLE` on collision | Convenience | Can accept a `BYPASSRLS` / `SUPERUSER` leftover |

## Consequences

- Positive: least privilege at each step; cluster vs database operations stay distinct; CI collision is avoided by construction.
- Negative / costs: later steps add role migrations when those roles are first needed.
- Risks and mitigations: RDS `CREATEROLE` / `rds_superuser` behavior remains T-21 (step 10). Docker bootstrap is not RDS evidence.

## Verification

- Bootstrap SQL creates `schoolos_owner` and the database; it does not create `app_user`.
- The first runtime-role migration creates `app_user` only (until a later step adds another role).
- A test or probe asserts the expected value of each of the six attributes on **both** roles. Expected:

  | Attribute | `schoolos_owner` | `app_user` |
  | --- | --- | --- |
  | `LOGIN` | yes | yes |
  | `SUPERUSER` | no | no |
  | `BYPASSRLS` | no | no |
  | `CREATEROLE` | yes | no |
  | `CREATEDB` | no | no |
  | `INHERIT` | yes (default; not `NOINHERIT`) | no (`NOINHERIT`) |

  It also verifies database ownership (`schoolos_owner` owns the application database) and grants (`app_user` has `CONNECT` and the intended schema privileges; it is not the owner and has no `BYPASSRLS`). Any mismatch fails. Checking only that `app_user` is not `SUPERUSER` is not sufficient.
- CI compose/service definition uses one Postgres service and one database name per job.
