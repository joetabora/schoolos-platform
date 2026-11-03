# ADR-0013: Database hosting on AWS RDS PostgreSQL 18, application-generated UUIDv7, standard pg pooling

- **Status:** Accepted
- **Date:** 2026-11-02
- **Deciders:** Founding engineering team
- **Related:** ADR-0003, ADR-0004, ADR-0011, ADR-0018; ARCHITECTURE_READINESS_REVIEW D-2, D-3, S-14, A-4, A-5

## Context

The readiness review left open where PostgreSQL runs relative to Supabase, which major version to use, how to generate UUIDv7 identifiers, and which connection pooler to use with `SET LOCAL` tenant context.

## Decision

### Hosting and data ownership
- **AWS RDS for PostgreSQL** is the only application database, in private subnets in `us-east-2` (ADR-0018).
- **Supabase is used for Auth only.** No SchoolOS tables, application data, student data, or device data are stored in Supabase. Supabase's generated Data API is not used. The Supabase project's Data API is disabled, or failing that exposes no schemas, and this is checked by an automated test (review S-14).
- Supabase necessarily stores **staff identity records** (email, credential hashes, MFA factors). It is listed as a sub-processor for that purpose only.
- SchoolOS owns all authorization data: users (linked by `auth_subject`), organizations, memberships, roles, permissions, and all student and device data.
- Local development and CI use the **Docker official `postgres` image**.

### Version
- **PostgreSQL major version 18** in RDS, Docker, and CI.
- The minor version is pinned identically everywhere (currently **18.6**, available in both RDS and Docker Hub as of 2026-11-02) and upgraded deliberately within the RDS standard support window.
- PostgreSQL 19 is a release candidate and is not used.
- Docker 18+ images use a version-specific `PGDATA` (`/var/lib/postgresql/18/docker`) with the volume at `/var/lib/postgresql`. Local compose files must mount accordingly.

### Identifiers
- **UUIDv7 is generated in the application** using an RFC 9562-conformant implementation (library chosen in M1 step 2).
- The schema does not depend on PostgreSQL's native UUIDv7 function, even though PostgreSQL 18 provides one. Columns are type `uuid` and may use `gen_random_uuid()` (v4) only as a fallback for rows created by SQL-only maintenance.

### Connection pooling
- Use a standard **node-postgres (`pg`) `Pool`** per process, connecting directly over the private network to RDS with TLS required.
- **No RDS Proxy or other external pooler** until a measured need (connection count or failover behaviour) is documented in a new ADR.
- Tenant context uses only `SET LOCAL` / `set_config(..., true)` inside an explicit transaction (ADR-0003). This is safe with a client-side pool because each transaction is pinned to one checked-out connection.
- Before accepting any future external pooler, the `SET LOCAL` behaviour and cross-tenant concurrency tests (review TST-3) must pass against it.
- Pool size per task is set so that (web tasks + worker tasks) × pool size stays well below the RDS `max_connections` for the chosen instance class.

## Alternatives considered

| Option | Pros | Cons |
| --- | --- | --- |
| Supabase-hosted Postgres | One vendor | Generated Data API exposure risk; weaker separation of identity and data; harder AWS-native networking |
| Aurora PostgreSQL | Fast failover, storage autoscaling | Higher minimum cost; not needed at MVP scale |
| PostgreSQL 17 | Longer production history | Earlier end of support (RDS standard support to 2030-02 vs 2031-02 for 18) |
| Native `uuidv7()` | No app dependency | Ties schema to PG 18+; app generation works on every version and in tests |
| RDS Proxy from day one | Connection multiplexing | Extra cost and a second pooler semantics to test; unnecessary at M1 scale |

## Consequences

- AWS networking (private subnets, security groups) is required to reach the database from compute (ADR-0018).
- Identity data lives with Supabase; everything else lives in RDS. Offboarding and incident response must cover both.

## Verification

- RDS PostgreSQL release calendar (checked 2026-11-02): PostgreSQL 18 released on RDS 2025-11-14, RDS end of standard support 2031-02-28; minor 18.6 available. <https://docs.aws.amazon.com/AmazonRDS/latest/PostgreSQLReleaseNotes/postgresql-release-calendar.html>
- Docker Hub official `postgres` image (checked 2026-11-02) lists tags `18.6` and `18`. <https://hub.docker.com/_/postgres>
- M1: TST-3 pool-leak test passes against `pg.Pool` → RDS in staging. A test asserts the Supabase Data API exposes no SchoolOS data.
