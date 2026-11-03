#!/usr/bin/env bash
# Runs the pinned dbmate binary as schoolos_owner (never as a superuser).
# Usage: scripts/dbmate.sh <command> [args]   e.g. up, rollback, status
set -euo pipefail
cd "$(dirname "$0")/.."

: "${SPIKE_PG_PORT:=54329}"
: "${SPIKE_OWNER_PASSWORD:=spike-local-only-owner}"
: "${SPIKE_DB:=schoolos_spike}"
: "${SPIKE_MIGRATIONS_DIR:=db/migrations}"

export DATABASE_URL="postgres://schoolos_owner:${SPIKE_OWNER_PASSWORD}@127.0.0.1:${SPIKE_PG_PORT}/${SPIKE_DB}?sslmode=disable"

exec ./node_modules/.bin/dbmate \
  --migrations-dir "${SPIKE_MIGRATIONS_DIR}" \
  --no-dump-schema \
  --wait \
  "$@"
