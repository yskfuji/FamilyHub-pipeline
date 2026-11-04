#!/usr/bin/env bash
set -euo pipefail

# 配布物を作る。--dry-run はソースの一覧を確かめるだけで、何も書かない。
project_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$project_root"

# ソースの一覧は git に聞く。.gitignore が除外の正本で、tar の除外の書き方の差に左右されない。
# 追跡していない新しいファイルも含める。release/ の説明は配布物そのものではないので入れない。
source_files() {
  git ls-files --cached --others --exclude-standard | grep -Ev '^release/' | while IFS= read -r file; do
    if [[ -e "$file" ]]; then printf '%s\n' "$file"; fi
  done
}

# 一覧に入ってはいけないもの。追跡してしまった場合もここで止める。
forbidden='(^|/)(\.env(\..*)?|[^/]*\.(sqlite|sqlite-wal|sqlite-shm|db|db-wal|db-shm))$|^(data|uploads|media|dist|dist-audit|dist-http|dist-server|test-results|playwright-report|node_modules)/'
list_file="$(mktemp)"
trap 'rm -f "$list_file"' EXIT
source_files > "$list_file"
if found="$(grep -E "$forbidden" "$list_file")"; then
  echo "The source archive would contain files that must stay out:" >&2
  echo "$found" >&2
  exit 1
fi

if [[ "${1:-}" == "--dry-run" ]]; then
  cat "$list_file"
  echo "Dry run: $(wc -l < "$list_file" | tr -d ' ') files would go into the source archive. Nothing was written." >&2
  exit 0
fi

mkdir -p release
rm -f release/family-hub-static.zip release/family-hub-source.tgz release/SHA256SUMS

(cd dist && zip -qr ../release/family-hub-static.zip .)
tar -czf release/family-hub-source.tgz -T "$list_file"
(cd release && shasum -a 256 family-hub-static.zip family-hub-source.tgz > SHA256SUMS)
echo "Release artifacts written to release/."
