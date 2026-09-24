// Hand-maintained knowledge the sources cannot express. Keep it short.

/**
 * Stages that are set but have no workflow gated on their label, on purpose.
 * Anything set, ungated and missing here is reported as a finding.
 * - kind `triage`: waits for a human to add the next (human-set) stage;
 * - kind `event`: the next workflow reacts to a GitHub event, not the label;
 * - kind `human`: the pipeline hands over to a human (`human` is the map text).
 */
export const EXPECTED_UNGATED = {
  'stage:inbox': {
    kind: 'triage',
    reason: 'waits for a human to triage the issue and add `stage:qualified`',
  },
  'stage:building': {
    kind: 'event',
    reason: 'opening the PR (not the label) starts CI and the preview',
  },
  'stage:reviewing': {
    kind: 'event',
    reason: 'the review and commit status it posts drive the next step',
  },
  'stage:fixing': {
    kind: 'event',
    reason: 'the fix push re-runs CI, which restarts the review',
  },
  'stage:human-approval': {
    kind: 'human',
    reason: 'a human reviews the PR and the preview, approves and merges',
    human: 'Human reviews, approves, merges',
  },
  'stage:needs-attention': {
    kind: 'human',
    reason: 'the pipeline stopped; a human reads the notice and takes over',
    human: 'Human reads the notice, takes over',
  },
};

/** The MARKERS key a workflow writes right before it escalates. */
export const NOTICE_MARKER = 'notice';

/** Event actions GitHub assumes when a trigger lists no `types`. */
export const DEFAULT_TYPES = {
  pull_request: ['opened', 'synchronize', 'reopened'],
};

/** What a COMMAND_EFFECTS `emits` entry looks like as a GitHub event. */
export const COMMAND_EVENTS = {
  pull_request: { action: 'opened', label: 'opens PR' },
  pull_request_review: { action: 'submitted', label: 'review' },
  status: { action: null, label: 'status' },
};
