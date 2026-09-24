#!/usr/bin/env node
// `pnpm security`: every security gate from docs/security.md that can run
// locally. Exit codes: 0 = all passed, 1 = a gate failed,
// 2 = this platform can't run the binary scanners, so they were NOT run
// (never read 2 as "passed"; CI is authoritative).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkRepoAiConfig } from './ai-config.mjs';
import { describe, gatingAdvisories, runAudit } from './audit.mjs';
import { exceptedTargets, validateExceptions } from './exceptions.mjs';
import { loadManifest, securityDir, workspaceRoot } from './fetch-tool.mjs';
import { validateManifest } from './manifest.mjs';
import {
  detectPlatform,
  EXIT_NOT_RUN,
  unsupportedMessage,
} from './platform.mjs';
import { runScanners } from './scanners.mjs';
import { checkRepoTasks } from './tasks.mjs';

const isTemplateRepo = existsSync(
  join(workspaceRoot, 'tools/scripts/init-template.mjs'),
);
const failures = [];
const warnings = [];

function check(label, problems) {
  if (problems.length) {
    failures.push(label);
    console.log(`✖ ${label}\n    ${problems.join('\n    ')}`);
  } else {
    console.log(`✔ ${label}`);
  }
}

// --- Platform-independent gates -------------------------------------------
const exceptions = JSON.parse(
  readFileSync(join(securityDir, 'exceptions.json'), 'utf8'),
);
const exceptionProblems = validateExceptions(exceptions);
check('Exceptions file is valid and nothing has expired', exceptionProblems);
const validExceptions = exceptionProblems.length ? [] : exceptions;

const manifest = loadManifest();
const manifestProblems = validateManifest(manifest);
check(
  'Pinned tool manifest is complete and reviewed within 120 days',
  manifestProblems,
);

check('AI-assistant config (A1-A3, A6)', checkRepoAiConfig(workspaceRoot));
check(
  'A7: scripts, run-commands targets and Nx plugins match tasks.json',
  checkRepoTasks(workspaceRoot, join(securityDir, 'tasks.json')),
);

const prodGating = gatingAdvisories(
  runAudit(workspaceRoot, { prod: true }),
  exceptedTargets(validExceptions, ['D1']),
);
check(
  'D1: no high/critical advisories in production dependencies',
  prodGating.map(describe),
);

const allGating = gatingAdvisories(
  runAudit(workspaceRoot, { prod: false }),
  exceptedTargets(
    validExceptions,
    isTemplateRepo ? ['D1', 'D2-T'] : ['D1', 'D2'],
  ),
);
if (isTemplateRepo) {
  check(
    'D2-T: no high/critical advisories in any dependency (template repo)',
    allGating.map(describe),
  );
} else if (allGating.length) {
  warnings.push(
    `D2: high/critical dev-dependency advisories (fix or add an exception within 14 days):\n    ${allGating.map(describe).join('\n    ')}`,
  );
}

// --- Binary scanners (need a supported platform) ---------------------------
const platform = detectPlatform();
let notRun = false;

if ('unsupported' in platform) {
  notRun = true;
  console.log(`⚠ ${unsupportedMessage(platform.unsupported)}`);
} else {
  // Online audits (e.g. impostor commits behind pinned SHAs) need a working
  // GitHub token; CI provides one. Locally, tokens are often absent or scoped
  // differently, so run offline there.
  const online = Boolean(
    process.env['CI'] &&
      (process.env['GH_TOKEN'] || process.env['GITHUB_TOKEN']),
  );
  for (const { label, problems } of runScanners({
    manifest,
    manifestProblems,
    platformKey: platform.key,
    cwd: workspaceRoot,
    online,
  })) {
    check(label, problems);
  }
}

for (const warning of warnings) console.log(`⚠ ${warning}`);

if (failures.length) {
  console.log(`\nSecurity gates failed: ${failures.join('; ')}`);
  process.exit(1);
}
if (notRun) process.exit(EXIT_NOT_RUN);
console.log('\nAll security gates passed.');
