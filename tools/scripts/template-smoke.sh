#!/usr/bin/env bash
# Template-only smoke test (docs/security.md, review Q6/Q10): initialize a
# fresh copy of this template, then prove that it verifies, that every
# generator produces a green workspace, and that the lifecycle contracts
# hold. Works on a clone of the committed HEAD, so running it locally never
# touches your working tree (uncommitted changes are not included).
#
#   pnpm template:smoke      (or: bash tools/scripts/template-smoke.sh)
#
# `pnpm template:init` deletes this script and its workflow.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
fail() { printf '\n\033[31mSMOKE FAILED: %s\033[0m\n' "$*" >&2; exit 1; }
expect_file() { [ -e "$1" ] || fail "expected $1 to exist"; }
expect_no_file() { [ ! -e "$1" ] || fail "expected $1 not to exist"; }
expect_grep() { grep -q -- "$1" "$2" || fail "expected '$1' in $2"; }
expect_no_grep() { ! grep -q -- "$1" "$2" || fail "did not expect '$1' in $2"; }

step "Fresh copy of HEAD"
git clone --quiet --no-local "$ROOT" "$WORK/ws"
cd "$WORK/ws"
git remote set-url origin https://github.com/Smoke-Owner/smoke-repo.git

step "Install (frozen lockfile)"
pnpm install --frozen-lockfile

step "template:init"
pnpm template:init --scope smoke --what "Smoke test project"

step "Init assertions"
if git ls-files -z | xargs -0 grep -l '@starter/' 2>/dev/null; then
  fail "@starter/ references remain (listed above)"
fi
expect_no_file tools/scripts/init-template.mjs
expect_no_file tools/scripts/template-smoke.sh
expect_no_file .github/workflows/template-smoke.yml
expect_no_grep '"template:' package.json
expect_grep '^- \*\*What:\*\* Smoke test project$' AGENTS.md
expect_grep '^- \*\*Live:\*\* https://smoke-owner.github.io/smoke-repo/ ' AGENTS.md
[ "$(tr -d '[:space:]' < tools/security/exceptions.json)" = "[]" ] || fail "exceptions.json must stay []"
for pattern in '^\.env$' '^\.env\.\*$' '^!\.env\.example$' '^\*\.pem$' '^\*\.key$'; do
  expect_grep "$pattern" .gitignore # S3
done

step "verify (initialized project)"
pnpm verify

step "Generators"
pnpm new:app tools-admin --no-interactive
expect_grep '"scope:dev"' apps/tools-admin/package.json
expect_no_file apps/tools-admin/project.json
expect_grep 'port: 4202' apps/tools-admin/vite.config.mts
expect_grep 'dir="rtl"' apps/tools-admin/index.html

pnpm new:app shop --scope=product --no-interactive
expect_grep '"scope:product"' apps/shop/package.json

pnpm new:lib dates --type=util --no-interactive
expect_file libs/shared/dates/package.json
expect_grep '"name": "shared-dates"' libs/shared/dates/package.json

pnpm new:lib booking --type=feature --scope=product --no-interactive
expect_grep '"dom"' libs/booking/tsconfig.lib.json

pnpm new:component date-picker --no-interactive
expect_file libs/ui/src/lib/date-picker/DatePicker.tsx
expect_file libs/ui/src/lib/date-picker/DatePicker.stories.tsx
expect_file libs/ui/src/lib/date-picker/DatePicker.spec.tsx
expect_grep "lib/date-picker/DatePicker" libs/ui/src/index.ts

pnpm new:component slot-list --project=booking --no-interactive
expect_no_file libs/booking/src/lib/slot-list/SlotList.stories.tsx
expect_grep '"@smoke/shared-utils": "workspace:\*"' libs/booking/package.json

pnpm new:spike probe --no-interactive
probe_dir="$(ls -d apps/sandbox/src/spikes/*-probe)"
expect_file "$probe_dir/meta.ts"
expect_file "$probe_dir/index.tsx"
if pnpm new:spike probe --no-interactive >/dev/null 2>&1; then fail "duplicate spike name was accepted"; fi

expect_no_grep 'react-router-dom' package.json

step "Delete every spike (including the template's example), then verify"
rm -rf apps/sandbox/src/spikes/*/
pnpm verify

step "Remove the sandbox app, then verify"
pnpm nx g @nx/workspace:remove sandbox --no-interactive
expect_no_file apps/sandbox
if out="$(pnpm new:spike after-removal --no-interactive 2>&1)"; then
  fail "new:spike succeeded without a sandbox app"
fi
grep -q 'No sandbox app' <<<"$out" || fail "new:spike did not explain the missing sandbox: $out"
pnpm verify

step "Negative check: product code importing a scope:dev lib must fail lint"
pnpm new:lib devtools --type=util --scope=dev --no-interactive
node -e '
  const fs = require("fs");
  const f = "apps/shop/package.json";
  const p = JSON.parse(fs.readFileSync(f));
  p.dependencies["@smoke/devtools"] = "workspace:*";
  fs.writeFileSync(f, JSON.stringify(p, null, 2) + "\n");
'
pnpm install
printf "import '@smoke/devtools';\n" >> apps/shop/src/main.tsx
if lint_out="$(pnpm nx lint shop --skip-nx-cache 2>&1)"; then
  fail "lint accepted a scope:product -> scope:dev import"
fi
grep -q 'scope:product' <<<"$lint_out" || fail "lint failed for another reason: $lint_out"

printf '\n\033[32mTemplate smoke test passed.\033[0m\n'
