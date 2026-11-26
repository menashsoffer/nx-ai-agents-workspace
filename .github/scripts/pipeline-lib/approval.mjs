// pipeline-lib/approval: one concern of the pipeline decision logic (see ../pipeline-lib.mjs).
import { evaluateGates } from './gates.mjs';
import { parkedIn } from './naming.mjs';

// ---------------------------------------------------------------- approval

/**
 * Whether the Copilot gate is on: the REQUIRE_COPILOT repo variable is
 * exactly the string `true`. Unset, empty, `false`, `TRUE`, `1` and
 * anything else are off, so a typo can never make the gate wait forever
 * for a review that nobody licensed.
 */
export const parseRequireCopilot = (value) => value === 'true';

/**
 * Gate for the Copilot review (only when `requireCopilot`) and the
 * human-approval hand-off. All deterministic (see evaluateGates): CI
 * green, zero unresolved threads and, with the Copilot gate on, Copilot
 * reviewed the head. With it off, no Copilot review is requested and the PR
 * goes straight to human approval once the other gates hold. Whatever the
 * action, `gates` is the value for the `pipeline/gates` status of this head
 * (null when the PR is not open). A parked PR is left alone, but its status
 * still says what holds.
 */
export function evaluateApproval({
  prState,
  labels,
  headSha,
  ciConclusion,
  securityJobConclusion,
  reviewRequired = false,
  reviewState = null,
  unresolvedThreads,
  copilotReviewedHead,
  requireCopilot = false,
  protectedRequired,
  protectedApprovalState,
  state,
}) {
  if (prState !== 'open')
    return { action: 'noop', reason: 'PR is not open', gates: null };
  const gates = evaluateGates({
    ciConclusion,
    securityJobConclusion,
    reviewRequired,
    reviewState,
    unresolvedThreads,
    copilotReviewedHead,
    requireCopilot,
    protectedRequired,
    protectedApprovalState,
  });
  const parked = parkedIn(labels);
  if (parked) return { action: 'noop', reason: `PR is in ${parked}`, gates };
  // Copilot is asked to review only once everything before it holds.
  const before = gates.checks
    .filter((c) => ['ci', 'review', 'threads'].includes(c.key))
    .find((c) => c.state !== 'success');
  if (before) return { action: 'wait', reason: before.detail, gates };
  if (requireCopilot && !copilotReviewedHead) {
    if (state.copilotRequestedFor === headSha)
      return { action: 'wait', reason: 'waiting for Copilot review', gates };
    return { action: 'request-copilot', gates };
  }
  if (gates.state !== 'success')
    return { action: 'wait', reason: gates.description, gates };
  // Once per head, whatever the PR's draft state: a person's draft stays a
  // draft for good, a pipeline draft that could not be converted is left for
  // the owner (the hand-off comment says so), and one put back to draft after
  // the hand-off is respected. Repeating the hand-off would only repeat the
  // outcome note on every event.
  if (
    state.humanApprovalFor === headSha &&
    labels.includes('stage:human-approval')
  )
    return {
      action: 'noop',
      reason: 'already handed to human approval',
      gates,
    };
  return { action: 'human-approval', gates };
}
