#!/usr/bin/env bash
# Claude Code SessionStart hook: mints a short-lived GitHub App installation
# token (menashsoffer-nx-pipeline[bot]) so local sessions push commits and
# open PRs as the pipeline bot instead of the developer's own GitHub account.
# No-op wherever .env.local (APP_ID + PEM_PATH) isn't present, e.g. cloud
# sessions or a machine that hasn't set this up.
set -uo pipefail

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

if [ -z "${CLAUDE_ENV_FILE:-}" ] || [ ! -f .env.local ]; then
  exit 0
fi

token="$(node scripts/mint-app-token.mjs)"
status=$?
if [ "$status" -ne 0 ] || [ -z "$token" ]; then
  echo "mint-app-identity: could not mint a GitHub App token, falling back to the default git identity" >&2
  exit 0
fi

printf 'export GH_TOKEN=%q\n' "$token" >>"$CLAUDE_ENV_FILE"
git config --local "http.https://github.com/.extraheader" "AUTHORIZATION: bearer ${token}"
