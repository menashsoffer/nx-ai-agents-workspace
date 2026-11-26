#!/usr/bin/env bash
# Verification stamp: proves the exact working tree that is about to be
# committed or pushed passed `pnpm verify:affected`.
#
#   verify-stamp.sh write   called by stop-verify.sh after a passing verify.
#                           Stores a fingerprint of the working tree in .git/.
#   verify-stamp.sh check   PreToolUse hook for Bash. For `git commit` and
#                           `git push` it compares the tree with the stamp.
#
# CLAUDE_VERIFY_STAMP=off | observe (default) | enforce
#   off      do nothing
#   observe  warn on stderr and append to .git/verify-stamp.log, never block
#   enforce  block (exit 2) until verify has passed for this exact tree
set -uo pipefail

mode="${CLAUDE_VERIFY_STAMP:-observe}"
[ "$mode" = "off" ] && exit 0
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
git_directory="$(git rev-parse --git-dir 2>/dev/null)" || exit 0
stamp_file="$git_directory/verify-stamp"

# Hash of every tracked and untracked (non-ignored) file as it is on disk,
# independent of commits, so the stamp survives `git commit` and `git push`.
compute_fingerprint() {
  local temporary_index
  temporary_index="$(mktemp -u)"
  [ -f "$git_directory/index" ] && cp "$git_directory/index" "$temporary_index"
  GIT_INDEX_FILE="$temporary_index" git add -A >/dev/null 2>&1
  GIT_INDEX_FILE="$temporary_index" git write-tree
  rm -f "$temporary_index"
}

case "${1:-}" in
write)
  compute_fingerprint > "$stamp_file"
  ;;
check)
  command_text="$(node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{try{console.log(JSON.parse(s).tool_input.command||"")}catch{console.log("")}})')"
  printf '%s' "$command_text" | grep -Eq '(^|[;&|[:space:]])git[[:space:]]+(commit|push)([[:space:]]|$)' || exit 0
  [ "$(cat "$stamp_file" 2>/dev/null)" = "$(compute_fingerprint)" ] && exit 0

  message="No passing verify:affected stamp for this exact tree. Run \`pnpm verify:affected\` first."
  if [ "$mode" = "enforce" ]; then
    echo "$message" >&2
    exit 2
  fi
  echo "[observe] $message" >&2
  echo "$(date -u +%FT%TZ) unstamped: $command_text" >> "$git_directory/verify-stamp.log"
  ;;
*)
  echo "usage: verify-stamp.sh write|check" >&2
  exit 1
  ;;
esac
exit 0
