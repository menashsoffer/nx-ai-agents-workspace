#!/usr/bin/env bash
# Calls the threshold-index Edge Function on one project. Usage: call-threshold-index.sh NAME REF
set -euo pipefail

name="$1"
ref="${2:-}"
if [ -z "$ref" ]; then
  echo "::notice::$name is not configured; nothing to call."
  exit 0
fi
status=$(curl -sS -o answer.json -w '%{http_code}' --max-time 30 -X POST \
  "https://$ref.supabase.co/functions/v1/threshold-index")
cat answer.json
echo
if [ "$status" = "404" ]; then
  echo "::notice::threshold-index is not deployed to $name yet."
  exit 0
fi
if [ "$status" != "200" ]; then
  echo "::error::threshold-index answered $status on $name."
  exit 1
fi
if grep -q '"proposed"\|"pending"' answer.json; then
  echo "::warning::A threshold proposal on $name waits for admin approval."
fi
