#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$project_root"
mkdir -p release
rm -f release/family-hub-static.zip release/family-hub-source.tgz release/SHA256SUMS

(cd dist && zip -qr ../release/family-hub-static.zip .)
tar --exclude='./node_modules' --exclude='./release' --exclude='./test-results' --exclude='./playwright-report' --exclude='./.git' -czf release/family-hub-source.tgz .
(cd release && shasum -a 256 family-hub-static.zip family-hub-source.tgz > SHA256SUMS)
echo "Release artifacts written to release/."
