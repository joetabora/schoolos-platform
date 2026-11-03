-- Superuser bootstrap, run once per cluster before dbmate.
-- Equivalent to what the RDS master user would do during provisioning.
-- schoolos_owner gets CREATEROLE (so migrations can create the runtime roles)
-- but not SUPERUSER, BYPASSRLS, or CREATEDB.

create role schoolos_owner login createrole nosuperuser nobypassrls nocreatedb
  password 'spike-local-only-owner';

create database schoolos_spike owner schoolos_owner;
revoke all on database schoolos_spike from public;

\connect schoolos_spike

-- PostgreSQL 15+ already withholds CREATE on public; also withhold USAGE so
-- runtime roles see nothing there (dbmate's schema_migrations lives in public).
revoke all on schema public from public;

-- Scratch database for dbmate transaction-behaviour probes (no roles created there).
\connect postgres
create database schoolos_spike_txprobe owner schoolos_owner;
revoke all on database schoolos_spike_txprobe from public;
