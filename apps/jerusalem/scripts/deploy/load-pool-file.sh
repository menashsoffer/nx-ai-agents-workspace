#!/usr/bin/env bash
# Loads the registries in data/pool-file through public.import_pool_registry, signed in
# as the project's first active admin, one registry per request. A registry that is
# already on the site is skipped, so a second run only loads what the first one missed.
# Files in data/pool-file/contacts are registries already on the site: they go through
# public.import_pool_contacts, which only adds what is missing and so can run again.
# Usage: load-pool-file.sh REF [FILE...]   (needs SUPABASE_ACCESS_TOKEN)
set -euo pipefail

ref="${1:?project ref}"
shift
files=("$@")
if [ ${#files[@]} -eq 0 ]; then
  files=(data/pool-file/*.json data/pool-file/contacts/*.json)
fi

admin="(select g.user_id from public.role_grants g
  join public.profiles p on p.user_id = g.user_id
  where g.role = 'admin' and g.revoked_at is null and p.status = 'active'
  order by g.created_at limit 1)"
tag='$pool_file$'

failed=0
for file in "${files[@]}"; do
  name=$(jq -r .name "$file")
  fn=import_pool_registry
  case "$file" in */contacts/*) fn=import_pool_contacts ;; esac
  if grep -qF "$tag" "$file"; then
    echo "::error::$file contains the quoting tag; not loaded."
    failed=1
    continue
  fi
  sql="with signed_in as (select set_config('request.jwt.claims',
    json_build_object('sub', $admin, 'role', 'authenticated')::text, true))
  select public.$fn($tag$(cat "$file")$tag::jsonb) as report
  from signed_in"
  # A large registry is longer than an argument may be, so the query goes through a file.
  printf '%s' "$sql" > query.sql
  status=$(jq -n --rawfile q query.sql '{query: $q}' | curl -sS -o answer.json -w '%{http_code}' \
    --max-time 120 -X POST "https://api.supabase.com/v1/projects/$ref/database/query" \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H 'Content-Type: application/json' \
    --data-binary @-)
  if [ "$status" = "201" ] || [ "$status" = "200" ]; then
    echo "$name: $(jq -c '.[0].report' answer.json)"
  elif grep -q 'already exists' answer.json; then
    echo "$name: already on the site, skipped"
  else
    echo "::error::$name: $status $(cat answer.json)"
    failed=1
  fi
done
exit "$failed"
