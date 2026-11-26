#!/usr/bin/env bash
# Removes the given migration versions from this checkout, so one production run
# leaves them out. A later run applies them with --include-all.
set -euo pipefail

for version in "$@"; do
  if ! [[ "$version" =~ ^[0-9]{14}$ ]]; then
    echo "Not a migration version: $version" >&2
    exit 1
  fi
  files=(supabase/migrations/"$version"_*.sql)
  if [ ! -e "${files[0]}" ]; then
    echo "No migration $version in supabase/migrations" >&2
    exit 1
  fi
  rm -- "${files[@]}"
  echo "Held back ${files[*]}"
done
