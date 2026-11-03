#!/usr/bin/env bash
# Full ADR-0014 spike from a clean state:
#   fresh PostgreSQL 18.6 container -> bootstrap -> dbmate migrate ->
#   strict typecheck -> type drift check -> test suite -> container install check.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "### node $(node --version), pnpm $(pnpm --version)"
echo "### reset database"
bash scripts/reset-db.sh
echo "### typecheck (strict)"
./node_modules/.bin/tsc --noEmit -p tsconfig.json
echo "### generated types in sync"
bash scripts/codegen.sh --verify
echo "### test suite"
./node_modules/.bin/vitest run
if [[ "${SKIP_INSTALL_CHECK:-0}" != "1" ]]; then
  echo "### reproducible install (containers)"
  bash scripts/install-check.sh
fi
echo "### spike complete"
