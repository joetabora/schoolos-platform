#!/usr/bin/env bash
# Generates (or with --verify, checks) Kysely types from the migrated database.
# Introspects as schoolos_owner so every column is visible.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${SPIKE_PG_PORT:=54329}"
: "${SPIKE_OWNER_PASSWORD:=spike-local-only-owner}"

export DATABASE_URL="postgres://schoolos_owner:${SPIKE_OWNER_PASSWORD}@127.0.0.1:${SPIKE_PG_PORT}/schoolos_spike?sslmode=disable"

exec ./node_modules/.bin/kysely-codegen \
  --dialect postgres \
  --include-pattern 'spike.*' \
  --out-file src/db-types.ts \
  "$@"
