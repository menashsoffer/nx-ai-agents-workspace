#!/usr/bin/env bash
# Claude Code SessionStart hook: prepares cloud sessions (Claude Code on the
# web) so `pnpm verify` and `pnpm e2e` work immediately. No-op locally.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"

corepack enable >/dev/null 2>&1 || true
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 pnpm install --frozen-lockfile

# Reuse the sandbox's preinstalled Chromium for Playwright when present.
if [ -n "${CLAUDE_ENV_FILE:-}" ] && [ -d /opt/pw-browsers ]; then
  chromium=$(find /opt/pw-browsers -maxdepth 3 -path '*chromium-*/chrome-linux*/chrome' -type f 2>/dev/null | sort -V | tail -n 1)
  if [ -n "$chromium" ]; then
    echo "export PLAYWRIGHT_CHROMIUM_PATH=\"$chromium\"" >> "$CLAUDE_ENV_FILE"
  fi
fi
