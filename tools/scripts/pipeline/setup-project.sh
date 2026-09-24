#!/usr/bin/env bash
# Creates a GitHub Project (v2) for the pipeline, links it to the repo and
# sets its Status options to the pipeline stages. Prints the PROJECT_URL
# repository variable to set.
#
# Needs a gh login with the `project` scope: gh auth refresh -s project
# Usage: tools/scripts/pipeline/setup-project.sh [owner/repo] [existing-project-number]
set -euo pipefail
repo=${1:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}
owner=${repo%%/*}
number=${2:-}

if [[ -z "$number" ]]; then
  number=$(gh project create --owner "$owner" --title "Pipeline: ${repo#*/}" --format json --jq .number)
  echo "Created project #$number"
fi
gh project link "$number" --owner "$owner" --repo "$repo" 2>/dev/null || true

project_id=$(gh project view "$number" --owner "$owner" --format json --jq .id)
field_id=$(gh project field-list "$number" --owner "$owner" --format json \
  --jq '.fields[] | select(.name == "Status") | .id')

# Replaces the Status options. Existing items lose their Status value.
# On an existing Project, add a missing option (e.g. "Routing") in the
# Project UI instead of re-running this.
# shellcheck disable=SC2016 # GraphQL variables, not shell
gh api graphql -f query='
mutation($field: ID!) {
  updateProjectV2Field(input: {
    fieldId: $field
    singleSelectOptions: [
      { name: "Inbox",           color: GRAY,   description: "stage:inbox" }
      { name: "Qualified",       color: BLUE,   description: "stage:qualified" }
      { name: "Spec",            color: BLUE,   description: "stage:spec" }
      { name: "Planned",         color: GREEN,  description: "stage:planned" }
      { name: "Awaiting approval", color: YELLOW, description: "stage:awaiting-approval" }
      { name: "Building",        color: PURPLE, description: "stage:building" }
      { name: "Reviewing",       color: PURPLE, description: "stage:reviewing" }
      { name: "Fixing",          color: YELLOW, description: "stage:fixing" }
      { name: "Human approval",  color: ORANGE, description: "stage:human-approval" }
      { name: "Routing",         color: PINK,   description: "stage:routing" }
      { name: "Needs attention", color: RED,    description: "stage:needs-attention" }
      { name: "Done",            color: GREEN,  description: "stage:done (merged)" }
    ]
  }) { projectV2Field { ... on ProjectV2SingleSelectField { id } } }
}' -f field="$field_id" >/dev/null
echo "Status options set on project $project_id"

kind=users
[[ "$(gh api "users/$owner" --jq .type)" == "Organization" ]] && kind=orgs
url="https://github.com/$kind/$owner/projects/$number"
gh variable set PROJECT_URL --repo "$repo" --body "$url"
echo "Repository variable PROJECT_URL=$url"
cat <<TXT

Finish in the Project UI (Workflows tab); built-in automations have no API:
  - enable "Item closed"            -> Status: Done
  - enable "Pull request merged"    -> Status: Done
  - enable "Item reopened"          -> Status: Inbox
  - disable "Item added to project" (the pipeline sets Status itself)
  - optional "Auto-add to project": filter is:issue,pr label:stage:*
Then add the PROJECT_TOKEN secret: a classic PAT with the "project" scope
(user-owned Projects are not reachable with GitHub App tokens).
TXT
