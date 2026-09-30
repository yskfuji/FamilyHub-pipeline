#!/usr/bin/env bash
set -euo pipefail

log_path="/private/tmp/family-hub-lighthouse-server.log"
npm run preview >"$log_path" 2>&1 &
server_pid=$!
cleanup() { kill "$server_pid" 2>/dev/null || true; }
trap cleanup EXIT

ready=0
for _ in {1..50}; do
  if curl -fs http://127.0.0.1:4173/today >/dev/null; then ready=1; break; fi
  sleep 0.2
done
if [[ "$ready" != "1" ]]; then
  echo "Preview server did not start. See $log_path" >&2
  exit 1
fi

npx --yes lighthouse@12.8.2 http://127.0.0.1:4173/today \
  --quiet \
  --preset=desktop \
  --only-categories=performance,accessibility,best-practices \
  --chrome-flags="--headless --no-sandbox --disable-gpu" \
  --output=json --output=html \
  --output-path=docs/audits/lighthouse-today
node scripts/lighthouse-summary.mjs
