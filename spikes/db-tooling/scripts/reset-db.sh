#!/usr/bin/env bash
# Destroys and recreates the disposable PostgreSQL 18.6 container, runs the
# superuser bootstrap, then applies migrations with dbmate as schoolos_owner.
set -euo pipefail
cd "$(dirname "$0")/.."

docker compose down --volumes --remove-orphans
docker compose up --detach --wait

docker compose exec -T postgres psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres \
  < bootstrap/bootstrap.sql

docker compose exec -T postgres psql -X -At -U postgres -d postgres -c 'select version()'

bash scripts/dbmate.sh migrate
