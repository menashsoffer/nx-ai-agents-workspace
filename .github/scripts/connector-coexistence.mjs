// Coexistence check for a target that also runs its own ("direct") Claude
// workflows next to the pipeline-engine connector, for example the
// standard claude.yml of anthropics/claude-code-action that answers @claude.
// Run by the owner BEFORE copying the connector, on the candidate the copy
// would produce (the target's existing workflows plus the connector's):
//   node .github/scripts/connector-coexistence.mjs \
//     --existing <target>/.github/workflows \
//     --connector connectors/pipeline-sandbox/.github/workflows
// or after copying, on the installed folder:
//   node .github/scripts/connector-coexistence.mjs <target>/.github/workflows
// Errors are conflicts that break the engine's guarantees; warnings need a
// person's decision. Exit 1 on any error.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { branchPushTriggers } from './pipeline-lib.mjs';

/** The connector's own workflow files (connectors/pipeline-sandbox). */
const CONNECTOR_FILES = ['pipeline-develop.yml', 'pipeline-plan.yml'];

const ENGINE_CALL =
  /^menashsoffer\/nx-ai-agents-workspace\/\.github\/workflows\/engine-/;
const CLAUDE_ACTION = /^anthropics\/claude-code-action@/;

const triggersOf = (workflow) => workflow?.on ?? workflow?.[true] ?? {};
const asMap = (triggers) =>
  typeof triggers === 'string'
    ? { [triggers]: null }
    : Array.isArray(triggers)
      ? Object.fromEntries(triggers.map((name) => [name, null]))
      : triggers;

/**
 * True when a job's `if:` keeps it off the pipeline's stage labels: it
 * skips labels that start with `stage:`, runs only on one named non-stage
 * label, or skips `labeled` events. An `||` could bypass the filter, so a
 * condition with one does not count.
 */
export function filtersStageLabels(condition) {
  const text = String(condition ?? '').replace(/\$\{\{|\}\}/g, ' ');
  if (!text.trim() || text.includes('||')) return false;
  return (
    /!\s*startsWith\(\s*github\.event\.label\.name\s*,\s*'stage:'\s*\)/.test(
      text,
    ) ||
    /github\.event\.label\.name\s*==\s*'(?!stage:)[^']+'/.test(text) ||
    /github\.event\.action\s*!=\s*'labeled'/.test(text)
  );
}

/**
 * True when the workflow runs on `issues: labeled` (a missing types list
 * includes it) and not every job filters the stage labels out.
 */
function runsOnStageLabels(workflow) {
  const map = asMap(triggersOf(workflow));
  if (!Object.hasOwn(map, 'issues')) return false;
  const types = map.issues?.types;
  if (types !== undefined && ![].concat(types).includes('labeled'))
    return false;
  const jobs = Object.values(workflow?.jobs ?? {});
  return !jobs.length || !jobs.every((job) => filtersStageLabels(job?.if));
}

const writesContents = (permissions) =>
  permissions === 'write-all' || permissions?.contents === 'write';

/**
 * `workflows` maps a file name to its parsed YAML. Returns `{ errors,
 * warnings }` for every workflow that is not the connector's.
 */
export function checkCoexistence(workflows) {
  const errors = [];
  const warnings = [];
  for (const file of CONNECTOR_FILES)
    if (!Object.hasOwn(workflows, file))
      errors.push(`${file}: the connector workflow is missing`);
  for (const [file, workflow] of Object.entries(workflows)) {
    if (CONNECTOR_FILES.includes(file)) continue;
    const text = JSON.stringify(workflow);
    const jobs = Object.values(workflow?.jobs ?? {});
    if (runsOnStageLabels(workflow))
      errors.push(
        `${file}: runs on issue label changes, also the pipeline's stage:* labels (no job filters them out)`,
      );
    for (const branch of ['issue-7-probe', 'issue-123-task'])
      if (branchPushTriggers(asMap(triggersOf(workflow)), branch).length)
        errors.push(`${file}: runs on a push of the engine's ${branch} branch`);
    if (/PIPELINE_APP_PRIVATE_KEY/.test(text))
      errors.push(`${file}: reads the pipeline App's private key`);
    if (jobs.some((job) => job?.secrets === 'inherit'))
      errors.push(`${file}: passes all secrets on (secrets: inherit)`);
    if (jobs.some((job) => ENGINE_CALL.test(String(job?.uses ?? ''))))
      errors.push(`${file}: calls the engine outside the connector`);
    if (
      /pipeline-engine-/.test(
        JSON.stringify(jobs.map((job) => job?.concurrency ?? null)),
      )
    )
      errors.push(`${file}: shares the engine's concurrency groups`);
    const claudeJobs = jobs.filter((job) =>
      (job?.steps ?? []).some((step) =>
        CLAUDE_ACTION.test(String(step?.uses ?? '')),
      ),
    );
    if (!claudeJobs.length) continue;
    if (
      claudeJobs.some((job) =>
        writesContents(job.permissions ?? workflow.permissions),
      )
    )
      warnings.push(
        `${file}: a direct Claude job can push branches; it could push to an issue-<n>-* branch the engine publishes`,
      );
    const map = asMap(triggersOf(workflow));
    if (Object.hasOwn(map, 'issues') || Object.hasOwn(map, 'issue_comment'))
      warnings.push(
        `${file}: a direct Claude job also answers on pipeline issues; its comments never count as pipeline markers, but people may confuse them`,
      );
  }
  return { errors, warnings };
}

/**
 * The workflows folder copying the connector would produce: `existing`
 * plus `connector`. An existing file with a connector file's name and other
 * content would be overwritten: that is an error of its own.
 */
export function candidateOf(existing, connector) {
  const errors = [];
  for (const [file, workflow] of Object.entries(connector))
    if (
      Object.hasOwn(existing, file) &&
      JSON.stringify(existing[file]) !== JSON.stringify(workflow)
    )
      errors.push(
        `${file}: an existing workflow would be overwritten by the connector's`,
      );
  return { workflows: { ...existing, ...connector }, errors };
}

/** Parses every *.yml / *.yaml file of a workflows folder. */
export function readWorkflowFolder(folder) {
  return Object.fromEntries(
    readdirSync(folder)
      .filter((file) => /\.ya?ml$/.test(file))
      .map((file) => [
        file,
        parseYaml(readFileSync(join(folder, file), 'utf8')),
      ]),
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [option, existingFolder, connectorOption, connectorFolder] =
    process.argv.slice(2);
  let workflows;
  let errors = [];
  if (option === '--existing' && connectorOption === '--connector') {
    ({ workflows, errors } = candidateOf(
      readWorkflowFolder(existingFolder),
      readWorkflowFolder(connectorFolder),
    ));
  } else workflows = readWorkflowFolder(option);
  const result = checkCoexistence(workflows);
  errors = [...errors, ...result.errors];
  for (const warning of result.warnings) console.log(`warning: ${warning}`);
  for (const error of errors) console.log(`error: ${error}`);
  console.log(
    errors.length
      ? 'Coexistence: conflicts found.'
      : 'Coexistence: no conflict.',
  );
  process.exit(errors.length ? 1 : 0);
}
