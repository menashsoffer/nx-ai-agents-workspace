// Coexistence check for a target that also runs its own ("direct") Claude
// workflows next to the pipeline-engine connector, for example the
// standard claude.yml of anthropics/claude-code-action that answers @claude.
// Run by the owner on a checkout of the target, before installing the
// connector there:
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

/** True when the workflow runs on `issues: labeled` (a missing types list includes it). */
function runsOnLabels(workflow) {
  const map = asMap(triggersOf(workflow));
  if (!Object.hasOwn(map, 'issues')) return false;
  const types = map.issues?.types;
  return types === undefined || [].concat(types).includes('labeled');
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
    if (runsOnLabels(workflow))
      errors.push(
        `${file}: runs on issue label changes, so also on the pipeline's stage:* labels`,
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
  const { errors, warnings } = checkCoexistence(
    readWorkflowFolder(process.argv[2]),
  );
  for (const warning of warnings) console.log(`warning: ${warning}`);
  for (const error of errors) console.log(`error: ${error}`);
  console.log(
    errors.length
      ? 'Coexistence: conflicts found.'
      : 'Coexistence: no conflict.',
  );
  process.exit(errors.length ? 1 : 0);
}
