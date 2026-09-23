#!/usr/bin/env bash
# Claude Code SessionStart hook: mints a short-lived GitHub App installation
# token (menashsoffer-nx-pipeline[bot]) so local sessions push commits and
# open PRs as the pipeline bot instead of the developer's own GitHub account.
#
# No-op wherever .env.local (APP_ID + PEM_PATH) isn't present, e.g. cloud
# sessions or a machine that hasn't set this up. Once .env.local IS present,
# a failure to mint the token or wire it into git is a loud error (exit 2,
# which Claude Code shows to the user), never a silent fallback to the
# developer's own git identity: https://code.claude.com/docs/en/hooks-guide.md
# ("Some events can't be blocked: for SessionStart ... exit 2 shows stderr to
# the user and execution continues" — SessionStart can never abort startup,
# so exit 2 is used purely for visibility, not to block anything).
#
# The token expires after ~1 hour (GitHub API limit on installation access
# tokens). If `git push`/`gh` start failing with 401 partway through a long
# session, re-mint by re-running this same script:
#   "$CLAUDE_PROJECT_DIR"/.claude/hooks/mint-app-identity.sh
set -uo pipefail

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 2

if [ ! -f .env.local ]; then
  exit 0
fi

if [ -z "${CLAUDE_ENV_FILE:-}" ]; then
  echo "mint-app-identity: .env.local is present but \$CLAUDE_ENV_FILE is not set; cannot inject GH_TOKEN or git config" >&2
  exit 2
fi

token="$(node scripts/mint-app-token.mjs)"
status=$?
if [ "$status" -ne 0 ] || [ -z "$token" ]; then
  echo "mint-app-identity: failed to mint a GitHub App installation token (mint-app-token.mjs exited $status)" >&2
  exit 2
fi

# GitHub's documented way to authenticate git over HTTPS with an installation
# token is HTTP Basic auth, username "x-access-token":
# https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation
basic="$(printf 'x-access-token:%s' "$token" | base64 | tr -d '\n')"
if [ -z "$basic" ]; then
  echo "mint-app-identity: failed to base64-encode the installation token" >&2
  exit 2
fi

# Inject the git config via the GIT_CONFIG_COUNT/GIT_CONFIG_KEY_n/
# GIT_CONFIG_VALUE_n environment variables (git >= 2.31) instead of
# `git config --local`, so nothing is ever written to .git/config: the
# credential lives only in this session's environment and is gone the
# moment the session ends. https://git-scm.com/docs/git-config#ENVIRONMENT
if ! {
  printf 'export GH_TOKEN=%q\n' "$token"
  printf 'export GIT_CONFIG_COUNT=1\n'
  printf 'export GIT_CONFIG_KEY_0=%q\n' 'http.https://github.com/.extraheader'
  printf 'export GIT_CONFIG_VALUE_0=%q\n' "Authorization: Basic ${basic}"
} >>"$CLAUDE_ENV_FILE"; then
  echo "mint-app-identity: failed to write to \$CLAUDE_ENV_FILE" >&2
  exit 2
fi
