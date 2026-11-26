#!/usr/bin/env bash
# Deploys the Edge Functions listed in supabase/functions/deployed.txt to the linked project.
set -euo pipefail

list="supabase/functions/deployed.txt"
names=$(grep -v '^\s*#' "$list" | sed 's/\s//g' | grep -v '^$' || true)
if [ -z "$names" ]; then
  echo "No functions listed in $list; nothing to deploy."
  exit 0
fi
for name in $names; do
  if [ ! -f "supabase/functions/$name/index.ts" ]; then
    echo "Listed function $name has no supabase/functions/$name/index.ts" >&2
    exit 1
  fi
  supabase functions deploy "$name" --project-ref "$SUPABASE_PROJECT_REF"
done
