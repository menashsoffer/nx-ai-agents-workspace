// pipeline/commands-split: part of the pipeline CLI (see ../pipeline.mjs).
import { readFileSync } from 'node:fs';
import {
  isSplitChild,
  parseCreatedParts,
  renderChildBody,
  renderSplitComment,
  MARKERS,
} from '../pipeline-lib.mjs';
import { api } from '../github.mjs';
import { findBotComment, num, upsertBotComment } from './helpers.mjs';

/** Opens part `index` (0-based) and returns its issue number. */
function openPart({ parent, parts, index, previous }) {
  const part = parts[index];
  const issue = api('issues', {
    method: 'POST',
    body: {
      title: part.title,
      body: renderChildBody({
        parent,
        index: index + 1,
        total: parts.length,
        body: part.body,
        previous,
      }),
    },
  });
  return issue.number;
}

export const splitCommands = {
  // plan.yml publish job, App token: opens the planner's proposed split of a
  // too-big issue as new issues (the inbox workflow labels them stage:inbox).
  // Resumable: the split comment on `parent` records the parts opened so
  // far, so a rerun continues instead of opening duplicates. A part of an
  // earlier split is never split again by the pipeline: a person decides.
  'split-issues'([parentArg, file]) {
    const parent = num(parentArg);
    const parts = JSON.parse(readFileSync(file, 'utf8'));
    if (!parts.length) return console.log('split-issues: no split proposed');
    if (isSplitChild(api(`issues/${parent}`).body))
      return console.log(
        `split-issues: #${parent} is itself a part, not splitting`,
      );
    const marker = findBotComment(parent, MARKERS.split);
    const created = parseCreatedParts(marker?.body);
    for (let index = created.length; index < parts.length; index += 1) {
      const previous = created.at(-1) ?? null;
      created.push(openPart({ parent, parts, index, previous }));
      upsertBotComment(
        parent,
        MARKERS.split,
        renderSplitComment({ created, total: parts.length }),
      );
    }
    console.log(
      `split-issues: #${parent} -> ${created.map((n) => `#${n}`).join(', ')}`,
    );
  },
};
