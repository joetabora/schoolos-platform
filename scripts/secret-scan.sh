#!/usr/bin/env bash
# Lightweight secret scan for CI and local use. Does not send data off-machine.
set -euo pipefail
cd "$(dirname "$0")/.."

patterns=(
  '-----BEGIN [A-Z ]*PRIVATE KEY-----'
  'AKIA[0-9A-Z]{16}'
  'ASIA[0-9A-Z]{16}'
  'gh[pousr]_[A-Za-z0-9]{30,}'
  'sk_(live|test)_[A-Za-z0-9]{10,}'
  'sb_secret_'
  'AIza[0-9A-Za-z_-]{35}'
  'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.'
)

exclude=(
  --exclude-dir=node_modules
  --exclude-dir=.git
  --exclude-dir=.next
  --exclude-dir=coverage
  --exclude-dir=spikes
  --exclude=pnpm-lock.yaml
  --exclude=secret-scan.sh
)

found=0
for pattern in "${patterns[@]}"; do
  if grep -RInE "${exclude[@]}" -e "$pattern" .; then
    found=1
  fi
done

if [[ "$found" -ne 0 ]]; then
  echo "secret-scan: matched a credential-like pattern" >&2
  exit 1
fi

echo "secret-scan: no credential-like patterns found"
