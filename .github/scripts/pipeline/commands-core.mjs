// commands-core: split from pipeline-pre.mjs (pure move).
import {
  classifyPlan,
  classifyDevelop,
  parseFlags,
  promptVersion,
  renderPrompt,
  normalizeOutcome,
  renderSpecComment,
  renderPlanComment,
  routerSkip,
  collectRouterInput,
  allowedTargets,
  planRoute,
  MARKERS,
  issueForAgents,
  branchName,
  classifyPatch,
} from '../pipeline-lib.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  setOutput,
  editLabels,
  api,
  list,
  OWNER,
  NAME,
  postComment,
  upsertComment,
} from '../github.mjs';
import { decideExternal } from '../router-external.mjs';
import {
  botLogin,
  many,
  num,
  readIf,
  setStage,
  writeOutcome,
} from './helpers.mjs';

// Per-stage classifiers: workflow job results + agent output -> outcome.
const classifiers = {
  plan: (f) =>
    classifyPlan({ jobResult: f['job-result'], raw: readIf(f.result) }),
  develop: (f) =>
    classifyDevelop({
      implementResult: f['job-result'],
      publishResult: f['publish-result'],
      raw: readIf(f.result),
      patchRejected: f['patch-rejected'] === 'true',
    }),
};

// ------------------------------------------------------------ commands
export const coreCommands = {
  'render-prompt'(args) {
    const f = parseFlags(args);
    const promptText = readFileSync(f.prompt, 'utf8');
    const context = Object.fromEntries(
      many(f.context).map((kv) => [
        kv.slice(0, kv.indexOf('=')),
        kv.slice(kv.indexOf('=') + 1),
      ]),
    );
    context['prompt version'] = `${f.prompt}@${promptVersion(promptText)}`;
    const data = many(f.data).map((kv) => {
      const [name, path] = [
        kv.slice(0, kv.indexOf('=')),
        kv.slice(kv.indexOf('=') + 1),
      ];
      return { name, path, content: readFileSync(path, 'utf8') };
    });
    const prompt = renderPrompt({ promptText, context, data });
    if (f.out) writeFileSync(f.out, prompt);
    if (f.output) setOutput(f.output, prompt);
    setOutput('version', promptVersion(promptText));
  },

  'set-stage'([number, stage]) {
    setStage(num(number), stage);
  },

  'edit-labels'(args) {
    const f = parseFlags(args);
    editLabels(num(f._[0]), { add: many(f.add), remove: many(f.remove) });
  },

  // Appends an outcome note from a JSON file; a problem sets stage:routing.
  outcome([number, file]) {
    writeOutcome(num(number), JSON.parse(readFileSync(file, 'utf8')));
  },

  // Builds a stage's outcome JSON (not posted) from job results and output.
  classify([stage, ...rest]) {
    const f = parseFlags(rest);
    if (!classifiers[stage]) throw new Error(`No classifier for ${stage}`);
    const outcome = normalizeOutcome({
      ...classifiers[stage](f),
      prompt_version: f['prompt-version'] ?? '',
    });
    writeFileSync(f.out, JSON.stringify(outcome));
    // An approved plan run also yields its two comment bodies.
    if (stage === 'plan' && outcome.result === 'success') {
      const result = JSON.parse(readIf(f.result));
      const version = f['prompt-version'] ?? undefined;
      writeFileSync(f['spec-out'], renderSpecComment(result, version));
      writeFileSync(f['plan-out'], renderPlanComment(result, version));
    }
    setOutput('result', outcome.result);
    setOutput('problem', outcome.problem);
  },

  // Read-only: asks the external brain for a pick (router.yml `brain` job).
  async 'route-external'([number]) {
    const skip = routerSkip(api(`issues/${num(number)}`));
    if (skip) {
      console.log(`route-external: skipped (${skip})`);
      setOutput('pick', 'null');
      return;
    }
    const { outcome, history } = collectRouterInput({
      comments: list(`issues/${num(number)}/comments`),
      botLogin: process.env.PIPELINE_BOT_LOGIN,
    });
    const allowed = outcome
      ? allowedTargets(outcome.stage, outcome.problem)
      : ['human'];
    const pick = outcome
      ? await decideExternal({ outcome, history, allowed })
      : null;
    setOutput('pick', JSON.stringify(pick ?? null));
  },

  // The router: read the notes, decide, append a route note, apply it.
  route([number]) {
    const n = num(number);
    const item = api(`issues/${n}`);
    const skip = routerSkip(item);
    if (skip) {
      console.log(`route: skipped (${skip})`);
      setOutput('target', '');
      return;
    }
    let external = null;
    try {
      external = JSON.parse(process.env.ROUTER_EXTERNAL_PICK || 'null');
    } catch {
      external = null;
    }
    // develop.yml publishes nothing while a PR for the issue is open.
    const openPullRequest =
      !item.pull_request &&
      list('pulls?state=open').some(
        (p) =>
          p.head.ref.startsWith(`issue-${n}-`) &&
          p.head.repo?.full_name === `${OWNER}/${NAME}`,
      );
    const r = planRoute({
      comments: list(`issues/${n}/comments`),
      botLogin: process.env.PIPELINE_BOT_LOGIN,
      mode: process.env.ROUTER_MODE === 'external' ? 'external' : 'rules',
      shadow: process.env.ROUTER_SHADOW === 'true',
      external,
      facts: { openPullRequest },
    });
    console.log(
      `route: ${r.outcome?.stage ?? '-'}/${r.outcome?.problem ?? '-'} -> ${r.final.target} (${r.final.reason})`,
    );
    postComment(n, r.body);
    setStage(n, r.stage);
    setOutput('target', r.final.target);
  },

  // COMMENT_AUTHOR overrides the author to match, for comments posted with
  // GITHUB_TOKEN (github-actions[bot]) instead of the pipeline App.
  'upsert-comment'([number, markerKey, file]) {
    const marker = MARKERS[markerKey];
    if (!marker) throw new Error(`Unknown marker ${markerKey}`);
    upsertComment(num(number), marker, readFileSync(file, 'utf8'), {
      author: process.env.COMMENT_AUTHOR || botLogin(),
    });
  },

  // Issue + comments for the plan/develop agents, with the spec and plan
  // taken only from the bot's own marker comments.
  'collect-issue'([number, outFile]) {
    const n = num(number);
    const data = issueForAgents({
      issue: api(`issues/${n}`),
      comments: list(`issues/${n}/comments`),
      botLogin: botLogin(),
    });
    writeFileSync(outFile, JSON.stringify(data, null, 2));
  },

  'branch-name'([number]) {
    setOutput('branch', branchName(num(number), process.env.ISSUE_TITLE ?? ''));
  },

  // Exit 1 unless the patch touches no protected path. `--accept approvable`
  // also passes a patch whose protected paths are all approvable (only
  // develop.yml's implement job, which then asks the owner); `--expect
  // none|approvable` requires exactly that kind (the publish job checks
  // again what implement saw). Outputs `protected` (none | approvable |
  // forbidden) and `protected_paths`.
  'check-patch'(args) {
    const f = parseFlags(args);
    const res = classifyPatch(readFileSync(f._[0], 'utf8'));
    setOutput('protected', res.kind);
    setOutput('protected_paths', res.protected.join('\n'));
    const expect = f.expect ?? null;
    if (expect !== null && !['none', 'approvable'].includes(expect))
      throw new Error(`Bad --expect ${expect}`);
    const accepted = expect
      ? [expect]
      : f.accept === 'approvable'
        ? ['none', 'approvable']
        : ['none'];
    if (res.protected.length)
      (accepted.includes(res.kind) ? console.log : console.error)(
        `Patch touches protected paths (${res.kind}): ${res.protected.join(', ')}`,
      );
    for (const e of res.errors) console.error(`Patch rejected: ${e}`);
    if (!accepted.includes(res.kind)) process.exit(1);
  },
};
