#!/usr/bin/env bash
# Calls the registry-recheck Edge Function once on one project. Each run asks the registries
# about up to 50 verified numbers whose last answer is 30 days old; the rest wait for the
# next day. Usage: call-registry-recheck.sh NAME REF
set -euo pipefail

name="$1"
ref="${2:-}"
if [ -z "$ref" ]; then
  echo "::notice::$name is not configured; nothing to call."
  exit 0
fi
status=$(curl -sS -o answer.json -w '%{http_code}' --max-time 90 -X POST \
  "https://$ref.supabase.co/functions/v1/registry-recheck")
echo "$(cat answer.json)"
if [ "$status" = "404" ]; then
  echo "::notice::registry-recheck is not deployed to $name yet."
  exit 0
fi
if [ "$status" != "200" ]; then
  echo "::error::registry-recheck answered $status on $name."
  exit 1
fi
if grep -q '"failed":true' answer.json; then
  echo "::warning::A registry did not answer on $name; those numbers are asked again tomorrow."
fi
