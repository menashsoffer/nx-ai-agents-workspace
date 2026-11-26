#!/usr/bin/env bash
# Calls the address-check Edge Function on one project until no address waits, at most
# MAX_RUNS times. Each run checks up to 40 addresses; the function skips a run that
# starts within a minute of the previous one. Usage: call-address-check.sh NAME REF
set -euo pipefail

name="$1"
ref="${2:-}"
max_runs="${MAX_RUNS:-30}"
if [ -z "$ref" ]; then
  echo "::notice::$name is not configured; nothing to call."
  exit 0
fi
for run in $(seq 1 "$max_runs"); do
  status=$(curl -sS -o answer.json -w '%{http_code}' --max-time 90 -X POST \
    "https://$ref.supabase.co/functions/v1/address-check")
  echo "run $run: $(cat answer.json)"
  if [ "$status" = "404" ]; then
    echo "::notice::address-check is not deployed to $name yet."
    exit 0
  fi
  if [ "$status" != "200" ]; then
    echo "::error::address-check answered $status on $name."
    exit 1
  fi
  if grep -q '"refused":true' answer.json; then
    echo "::warning::The map service refused requests on $name; the next run continues."
    exit 0
  fi
  if grep -q '"remaining":0' answer.json; then
    exit 0
  fi
  sleep 65
done
