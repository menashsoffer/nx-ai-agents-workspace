// pipeline-lib/command-effects: one concern of the pipeline decision logic (see ../pipeline-lib.mjs).
import { TARGET_STAGE } from './router-rules.mjs';
import { RESTART_STAGES } from './restart.mjs';

// ---------------------------------------------------------------- effects

/**
 * What each `pipeline.mjs` command writes, for tools/pipeline-map. Only
 * commands with an effect are listed. pipeline-lib.test.mjs scans the
 * command bodies and fails when this table disagrees with them.
 * - stages: stage labels the command may set;
 * - problems: the subset that means "something went wrong" (the hand-off
 *   to the router, or the router's hand-off to a human);
 * - markers: MARKERS keys of comments it upserts (one per item, edited);
 * - appends: MARKERS keys of notes, comments or reviews it adds (history);
 * - emits: GitHub events it causes that can trigger workflows
 *   (`pull_request_review` = Copilot requested, `issue_comment` = a
 *   disposition record note);
 * - args: effects taken from the command line, as positional index or flag
 *   (`stage`: stage label, `marker`: MARKERS key to upsert).
 */
export const COMMAND_EFFECTS = {
  'set-stage': {
    stages: [],
    markers: [],
    appends: [],
    emits: [],
    args: { stage: 1 },
  },
  'edit-labels': {
    stages: [],
    markers: [],
    appends: [],
    emits: [],
    args: { stage: '--add' },
  },
  outcome: {
    stages: ['stage:routing'],
    problems: ['stage:routing'],
    markers: [],
    appends: ['outcome'],
    emits: [],
  },
  route: {
    stages: [...new Set(Object.values(TARGET_STAGE))].sort(),
    problems: [TARGET_STAGE.human],
    markers: [],
    appends: ['route'],
    emits: [],
  },
  'upsert-comment': {
    stages: [],
    markers: [],
    appends: [],
    emits: [],
    args: { marker: 1 },
  },
  'ci-failed': {
    stages: ['stage:routing'],
    problems: ['stage:routing'],
    markers: [],
    appends: ['outcome'],
    emits: [],
  },
  'pr-closed': {
    stages: ['stage:done', 'stage:routing'],
    problems: ['stage:routing'],
    markers: [],
    appends: ['outcome'],
    emits: [],
  },
  approval: {
    stages: ['stage:human-approval', 'stage:routing'],
    problems: ['stage:routing'],
    markers: ['gates', 'humanApproval', 'state'],
    appends: ['outcome'],
    emits: ['pull_request_review'],
  },
  // The record note (an issue_comment by the App) is what approval.yml
  // re-evaluates the gates on (so is protected-decision's approval note).
  disposition: {
    stages: [],
    markers: [],
    appends: ['disposition', 'dispositionReply'],
    emits: ['issue_comment'],
  },
  // develop.yml, approvable protected changes: the branch is pushed with no
  // PR, the issue waits for the owner. Not a problem hand-off to the router.
  'protected-request': {
    stages: ['stage:awaiting-approval'],
    markers: [],
    appends: ['outcome', 'protectedApproval'],
    emits: [],
  },
  // The owner's /approve-protected: opens the PR (a `pull_request` event) and
  // appends the record note the gates re-evaluate on. /reject-protected is
  // the escalation.
  'protected-decision': {
    stages: ['stage:building', 'stage:routing'],
    problems: ['stage:routing'],
    markers: [],
    appends: ['outcome', 'protectedApproved'],
    emits: ['issue_comment', 'pull_request'],
  },
  // The owner's /restart: the issue's lifetime counter (state comment), a
  // restart route note and the issue's stage label.
  restart: {
    stages: Object.values(RESTART_STAGES).sort(),
    markers: ['state'],
    appends: ['route'],
    emits: [],
  },
  // A person moved an item out of stage:needs-attention by hand: one pointer
  // to /restart.
  'restart-hint': {
    stages: [],
    markers: [],
    appends: ['restartHint'],
    emits: [],
  },
  // review.yml: the findings as review threads (a PR review, which re-runs
  // approval.yml) and the outcome note (an issue_comment, likewise). A failed
  // review is a problem for the router.
  'review-publish': {
    stages: ['stage:routing'],
    problems: ['stage:routing'],
    markers: [],
    appends: ['outcome', 'reviewFinding'],
    emits: ['issue_comment', 'pull_request_review'],
  },
  // A new head with protected changes: a new approval request on the issue.
  'protected-status': {
    stages: ['stage:awaiting-approval'],
    markers: [],
    appends: ['outcome', 'protectedApproval'],
    emits: [],
  },
};
