// A tiny stand-in for .github/scripts/pipeline-lib.mjs.
export const STAGES = ['stage:new', 'stage:ready', 'stage:built', 'stage:help'];
export const FIX_LOOP_1 = 'fix-loop:1';
export const MARKERS = {
  notice: '<!-- demo:notice -->',
  result: '<!-- demo:result -->',
  unused: '<!-- demo:unused -->',
};
export const COMMAND_EFFECTS = {
  'set-stage': { stages: [], markers: [], emits: [], args: { stage: 1 } },
  'upsert-comment': { stages: [], markers: [], emits: [], args: { marker: 1 } },
  review: {
    stages: ['stage:help'],
    problems: ['stage:help'],
    markers: ['notice'],
    emits: ['pull_request_review'],
    loops: [FIX_LOOP_1],
  },
};
