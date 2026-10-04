#!/usr/bin/env bash
# Claude Code SessionStart hook: prepares cloud sessions (Claude Code on the
# web) so `pnpm verify` and `pnpm e2e` work immediately. No-op locally.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"

# Use the Node version from .nvmrc: the sandbox image ships an older one, and
# the repo requires Node 24+. A failure here only warns; install still runs.
required_node="$(tr -d '[:space:]' < .nvmrc)"
if [ "$(node --version | sed 's/^v//; s/\..*//')" != "${required_node%%.*}" ] && [ -s /opt/nvm/nvm.sh ]; then
  export NVM_DIR=/opt/nvm
  set +eu
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
  nvm install "$required_node" >/dev/null && nvm use "$required_node" >/dev/null
  node_status=$?
  set -eu
  if [ "$node_status" -eq 0 ]; then
    node_directory="$(dirname "$(command -v node)")"
    export PATH="$node_directory:$PATH"
    if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
      printf 'export PATH=%q:$PATH\n' "$node_directory" >> "$CLAUDE_ENV_FILE"
    fi
  else
    echo "session-start: could not switch to Node $required_node; continuing with $(node --version)" >&2
  fi
fi

corepack enable >/dev/null 2>&1 || true
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 pnpm install --frozen-lockfile

# Reuse the sandbox's preinstalled Chromium for Playwright when present.
if [ -n "${CLAUDE_ENV_FILE:-}" ] && [ -d /opt/pw-browsers ]; then
  chromium=$(find /opt/pw-browsers -maxdepth 3 -path '*chromium-*/chrome-linux*/chrome' -type f 2>/dev/null | sort -V | tail -n 1)
  if [ -n "$chromium" ]; then
    printf 'export PLAYWRIGHT_CHROMIUM_PATH=%q\n' "$chromium" >> "$CLAUDE_ENV_FILE"
  fi
fi
