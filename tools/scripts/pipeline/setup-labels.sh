#!/usr/bin/env bash
# Creates (or updates) the pipeline labels. Idempotent.
# Usage: tools/scripts/pipeline/setup-labels.sh [owner/repo]
set -euo pipefail
repo=${1:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}

label() { gh label create "$1" --repo "$repo" --color "$2" --description "$3" --force; }

label stage:inbox           ededed "New issue, waiting for triage"
label stage:qualified       c5def5 "Triaged; starts the spec agent"
label stage:spec            bfd4f2 "Spec posted; starts the plan agent"
label stage:planned         0e8a16 "Plan posted; starts the develop agent"
label stage:building        1d76db "Draft PR open; CI running"
label stage:reviewing       5319e7 "Security review done; waiting for Copilot and threads"
label stage:fixing          fbca04 "Automated fixer is applying review feedback"
label stage:human-approval  0052cc "Everything green; a human reviews and merges"
label stage:needs-attention d93f0b "Pipeline stopped; a human must act"
label fix-loop:1            f9d0c4 "First automated fix round used"
label fix-loop:2            e99695 "Second (last) automated fix round used"
echo "Labels ready on $repo"
