#!/usr/bin/env bash
# Creates (or updates) the pipeline labels. Idempotent.
# Usage: tools/scripts/pipeline/setup-labels.sh [owner/repo]
set -euo pipefail
repo=${1:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}

label() { gh label create "$1" --repo "$repo" --color "$2" --description "$3" --force; }

label stage:inbox           ededed "New issue, waiting for triage"
label stage:qualified       c5def5 "Triaged; starts the spec + plan agent"
label stage:spec            bfd4f2 "Deprecated: no longer set (spec+plan run on stage:qualified)"
label stage:planned         0e8a16 "Plan posted; starts the develop agent"
label stage:awaiting-approval e99f00 "Protected changes pushed with no PR; the owner approves or rejects them"
label stage:building        1d76db "Draft PR open; CI running"
label stage:human-approval  0052cc "Everything green; a human reviews and merges"
label stage:routing         fef2c0 "A stage reported a problem; the router decides the next step"
label stage:needs-attention d93f0b "The router handed off; a human must act"
label stage:done            0e8a16 "PR merged; the item is finished"
echo "Labels ready on $repo"
