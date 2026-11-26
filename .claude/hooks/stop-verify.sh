#!/usr/bin/env bash
# Claude Code Stop hook: before a session ends with unverified changes, run
# `pnpm verify:affected`. A failure blocks the stop (exit 2) so Claude fixes it
# first. After three failed rounds in one session it lets Claude stop, so a
# human takes over instead of an endless loop.
# CLAUDE_VERIFY_HOOK=off disables it.
set -uo pipefail

[ "${CLAUDE_VERIFY_HOOK:-enforce}" = "off" ] && exit 0
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

maximum_rounds=3
session_id="$(node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{try{console.log(JSON.parse(s).session_id||"")}catch{console.log("")}})')"
counter_file="${TMPDIR:-/tmp}/claude-verify-${session_id:-unknown}.count"

# Nothing changed (no local edits, nothing ahead of main): nothing to verify.
if [ -z "$(git status --porcelain 2>/dev/null)" ] &&
  { ! git rev-parse --verify -q origin/main >/dev/null || git diff --quiet origin/main...HEAD; }; then
  exit 0
fi

output="$(pnpm verify:affected 2>&1)"
if [ $? -eq 0 ]; then
  rm -f "$counter_file"
  exit 0
fi

rounds=$(($(cat "$counter_file" 2>/dev/null || echo 0) + 1))
echo "$rounds" > "$counter_file"

if [ "$rounds" -ge "$maximum_rounds" ]; then
  echo "verify:affected failed $rounds times. Stop and tell the user which check fails and what you tried." >&2
  rm -f "$counter_file"
  exit 0
fi

{
  echo "verify:affected failed (round $rounds of $maximum_rounds). Fix the failures, do not weaken checks:"
  echo "$output" | tail -n 40
} >&2
exit 2
