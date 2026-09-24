#!/usr/bin/env bash
# Protects the default branch with a repository ruleset:
#   - changes only through pull requests
#   - 1 approval, from a code owner (.github/CODEOWNERS), after the last push
#   - all review conversations resolved
#   - required status checks, branch up to date:
#       "ci" from GitHub Actions, and
#       "pipeline/security" (the security review verdict) from the pipeline
#       App only, so no other token can post a passing status
#   - no force pushes, no deletion
#   - no bypass actors: no agent, bot or app can merge on its own
# Also turns off "Allow GitHub Actions to create and approve pull requests"
# so GITHUB_TOKEN can never approve.
#
# Rulesets are free on public repos. Private repos need GitHub Pro/Team.
# Usage: tools/scripts/pipeline/setup-ruleset.sh [owner/repo]
# The App is found from the repo variable PIPELINE_BOT_LOGIN
# (`<slug>[bot]`); set PIPELINE_APP_ID to skip the lookup.
set -euo pipefail
repo=${1:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}
name="main protection (pipeline)"

app_id=${PIPELINE_APP_ID:-}
if [[ -z "$app_id" ]]; then
  bot=$(gh api "repos/$repo/actions/variables/PIPELINE_BOT_LOGIN" --jq .value 2>/dev/null || true)
  if [[ -z "$bot" ]]; then
    echo "error: set the repo variable PIPELINE_BOT_LOGIN (docs/pipeline.md) or PIPELINE_APP_ID." >&2
    exit 1
  fi
  app_id=$(gh api "apps/${bot%\[bot\]}" --jq .id 2>/dev/null || true)
fi
if ! [[ "$app_id" =~ ^[0-9]+$ ]]; then
  echo "error: could not resolve the pipeline App's ID; set PIPELINE_APP_ID (App settings -> App ID)." >&2
  exit 1
fi

visibility=$(gh api "repos/$repo" --jq .visibility)
if [[ "$visibility" != "public" ]]; then
  echo "warning: $repo is $visibility; rulesets are enforced for free only on public repos." >&2
fi

body=$(cat <<JSON
{
  "name": "$name",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [],
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 1,
        "require_code_owner_review": true,
        "require_last_push_approval": true,
        "dismiss_stale_reviews_on_push": true,
        "required_review_thread_resolution": true,
        "allowed_merge_methods": ["squash", "merge", "rebase"]
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": true,
        "do_not_enforce_on_create": false,
        "required_status_checks": [
          { "context": "ci", "integration_id": 15368 },
          { "context": "pipeline/security", "integration_id": $app_id }
        ]
      }
    }
  ]
}
JSON
)

id=$(gh api "repos/$repo/rulesets" --jq ".[] | select(.name == \"$name\") | .id" || true)
if [[ -n "$id" ]]; then
  gh api -X PUT "repos/$repo/rulesets/$id" --input - <<<"$body" >/dev/null
  echo "Updated ruleset $id on $repo (pipeline/security from App $app_id)"
else
  gh api -X POST "repos/$repo/rulesets" --input - <<<"$body" >/dev/null
  echo "Created ruleset on $repo (pipeline/security from App $app_id)"
fi

gh api -X PUT "repos/$repo/actions/permissions/workflow" \
  -f default_workflow_permissions=read -F can_approve_pull_request_reviews=false >/dev/null
echo "GITHUB_TOKEN: read-only by default, cannot approve PRs"
