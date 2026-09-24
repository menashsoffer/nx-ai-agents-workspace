#!/usr/bin/env bash
# Protects the default branch with a repository ruleset ("main protection
# (pipeline)"); a re-run produces exactly this and nothing more or less:
#   - changes only through pull requests
#   - 1 approval, from a code owner (.github/CODEOWNERS), after the last push;
#     stale approvals dismissed on push; the extra approval GitHub asks for
#     on unattributed changes is on (require_extra_approval_for_unattributed_changes)
#   - all review conversations resolved
#   - required status checks, branch up to date:
#       "ci" and "security" from GitHub Actions (the two jobs of ci.yml), and
#       "pipeline/gates" (the sum of every review gate, see docs/pipeline.md)
#       from the pipeline App only, so no other token can post a passing one
#   - no force pushes, no deletion
#   - one bypass actor: the repo owner (PIPELINE_OWNER_LOGIN), in bypass mode
#     "pull_request", i.e. only inside a PR and never by pushing to main.
#     No agent, bot or app can bypass or merge on its own.
# Also turns off "Allow GitHub Actions to create and approve pull requests"
# so GITHUB_TOKEN can never approve.
#
# Rulesets are free on public repos. Private repos need GitHub Pro/Team.
# Usage: [DRY_RUN=1] tools/scripts/pipeline/setup-ruleset.sh [owner/repo]
# Needs the repo variables PIPELINE_OWNER_LOGIN (the owner's GitHub login) and
# PIPELINE_BOT_LOGIN (`<slug>[bot]`). The App's ID comes from PIPELINE_APP_ID
# if set (a private App is not readable at `apps/<slug>`, so this is the
# reliable choice), else from `performed_via_github_app` on a recent comment
# the App wrote. DRY_RUN=1 prints the JSON body it would PUT/POST and exits
# without changing anything.
set -euo pipefail
repo=${1:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}
name="main protection (pipeline)"
actions_app_id=15368 # github-actions

# On an HTTP error gh prints the error body to stdout, so blank the value.
owner=$(gh api "repos/$repo/actions/variables/PIPELINE_OWNER_LOGIN" --jq .value 2>/dev/null) || owner=""
if [[ -z "$owner" ]]; then
  echo "error: set the repo variable PIPELINE_OWNER_LOGIN (docs/pipeline.md): the owner's GitHub login, the ruleset's only bypass actor." >&2
  exit 1
fi
owner_id=$(gh api "users/$owner" --jq .id 2>/dev/null) || owner_id=""
if ! [[ "$owner_id" =~ ^[0-9]+$ ]]; then
  echo "error: could not resolve the user id of PIPELINE_OWNER_LOGIN '$owner'." >&2
  exit 1
fi

app_id=${PIPELINE_APP_ID:-}
if [[ -z "$app_id" ]]; then
  bot=$(gh api "repos/$repo/actions/variables/PIPELINE_BOT_LOGIN" --jq .value 2>/dev/null) || bot=""
  if [[ -n "$bot" ]]; then
    slug=${bot%\[bot\]}
    # `gh api apps/<slug>` is 404 for a private App, so read the App's ID off a
    # comment it wrote. Filter by slug: github-actions (15368) writes comments too.
    app_id=$(gh api "repos/$repo/issues/comments?per_page=100&sort=created&direction=desc" \
      --jq "[.[] | select(.performed_via_github_app.slug == \"$slug\") | .performed_via_github_app.id] | first // empty" 2>/dev/null) || app_id=""
  fi
fi
if ! [[ "$app_id" =~ ^[0-9]+$ ]]; then
  echo "error: could not resolve the pipeline App's ID; set PIPELINE_APP_ID (App settings -> App ID)." >&2
  exit 1
fi

body=$(cat <<JSON
{
  "name": "$name",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [
    { "actor_id": $owner_id, "actor_type": "User", "bypass_mode": "pull_request" }
  ],
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
        "require_extra_approval_for_unattributed_changes": true,
        "required_reviewers": [],
        "allowed_merge_methods": ["squash", "merge", "rebase"]
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": true,
        "do_not_enforce_on_create": false,
        "required_status_checks": [
          { "context": "ci", "integration_id": $actions_app_id },
          { "context": "security", "integration_id": $actions_app_id },
          { "context": "pipeline/gates", "integration_id": $app_id }
        ]
      }
    }
  ]
}
JSON
)

if [[ "${DRY_RUN:-}" == "1" ]]; then
  echo "$body"
  exit 0
fi

visibility=$(gh api "repos/$repo" --jq .visibility)
if [[ "$visibility" != "public" ]]; then
  echo "warning: $repo is $visibility; rulesets are enforced for free only on public repos." >&2
fi

id=$(gh api "repos/$repo/rulesets" --jq ".[] | select(.name == \"$name\") | .id" || true)
if [[ -n "$id" ]]; then
  gh api -X PUT "repos/$repo/rulesets/$id" --input - <<<"$body" >/dev/null
  echo "Updated ruleset $id on $repo (pipeline/gates from App $app_id, owner bypass in PRs only)"
else
  gh api -X POST "repos/$repo/rulesets" --input - <<<"$body" >/dev/null
  echo "Created ruleset on $repo (pipeline/gates from App $app_id, owner bypass in PRs only)"
fi

gh api -X PUT "repos/$repo/actions/permissions/workflow" \
  -f default_workflow_permissions=read -F can_approve_pull_request_reviews=false >/dev/null
echo "GITHUB_TOKEN: read-only by default, cannot approve PRs"
