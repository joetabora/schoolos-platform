#!/usr/bin/env bash
# V4: builds the install-check image from scratch for each CI-relevant platform.
set -euo pipefail
cd "$(dirname "$0")/.."

for platform in linux/arm64 linux/amd64; do
  echo "=== install check: ${platform}"
  docker build --no-cache --progress plain --platform "${platform}" \
    -f Dockerfile.install-check -t schoolos-spike-install-check:local . 2>&1 \
    | grep -E "dbmate version|^#[0-9]+ [0-9.]+ (Version|kysely|pg|kysely-codegen|vitest|v26|aarch64|x86_64|lockfile|[0-9]+\.[0-9]+\.[0-9]+$)|ERROR|Done in|frozen" || true
  docker image inspect schoolos-spike-install-check:local --format "built {{.Os}}/{{.Architecture}}"
  docker image rm schoolos-spike-install-check:local > /dev/null
done
