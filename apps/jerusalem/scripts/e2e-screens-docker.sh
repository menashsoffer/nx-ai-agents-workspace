#!/usr/bin/env bash
# Takes the approved screen pictures (e2e/screens/baseline) inside Playwright's own Linux image,
# which draws text exactly as the GitHub runner does. Pictures taken on another machine differ
# by a few percent of anti-aliased pixels. Needs Docker, a freshly reset local Supabase
# (`npx supabase db reset`) and the E2E_* settings of documentation/e2e-tests-he.md.
# Extra arguments go to Playwright, for example --update-snapshots.
set -euo pipefail
image=mcr.microsoft.com/playwright:v1.63.0-noble
docker run --rm --network host \
  -e E2E_API_URL -e E2E_PUBLISHABLE_KEY -e E2E_DB_URL -e E2E_MAILPIT_URL \
  -e HTTP_PROXY -e HTTPS_PROXY -e NO_PROXY \
  -v "$PWD:/work" -w /work "$image" bash -c '
    apt-get update -qq >/dev/null && apt-get install -y -qq postgresql-client >/dev/null
    npx playwright test --project screens-phone --project screens-desktop "$@"' _ "$@"
