#!/usr/bin/env node
// `pnpm security`: every security gate from docs/security.md that can run
// locally. Exit codes: 0 = all passed, 1 = a gate failed,
// 2 = this platform can't run the binary scanners, so they were NOT run
// (never read 2 as "passed"; CI is authoritative).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkRepoAiConfig } from './ai-config.mjs';
import { describe, gatingAdvisories, runAudit } from './audit.mjs';
import { exceptedTargets, validateExceptions } from './exceptions.mjs';
import {
  ensureTool,
  loadManifest,
  securityDir,
  workspaceRoot,
} from './fetch-tool.mjs';
import { validateManifest } from './manifest.mjs';
import {
  detectPlatform,
  EXIT_NOT_RUN,
  unsupportedMessage,
} from './platform.mjs';

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
check(
  'Pinned tool manifest is complete and reviewed within 120 days',
  validateManifest(manifest),
);

check('AI-assistant config (A1-A3)', checkRepoAiConfig(workspaceRoot));

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
  const run = (label, tool, args) => {
    const binary = ensureTool(tool, platform.key, { manifest });
    const result = spawnSync(binary, args, {
      cwd: workspaceRoot,
      stdio: 'inherit',
    });
    check(
      label,
      result.status === 0 ? [] : [`${tool} exited with ${result.status}`],
    );
  };

  run('W7/W8: actionlint', 'actionlint', []);
  const hasToken = Boolean(
    process.env['GH_TOKEN'] || process.env['GITHUB_TOKEN'],
  );
  run('W1-W5: zizmor', 'zizmor', [
    ...(hasToken ? [] : ['--offline']),
    '--min-severity',
    'low',
    '--no-progress',
    '.github',
  ]);
  run('S1: gitleaks (git history)', 'gitleaks', [
    'git',
    '--redact',
    '--no-banner',
    '.',
  ]);
}

for (const warning of warnings) console.log(`⚠ ${warning}`);

if (failures.length) {
  console.log(`\nSecurity gates failed: ${failures.join('; ')}`);
  process.exit(1);
}
if (notRun) process.exit(EXIT_NOT_RUN);
console.log('\nAll security gates passed.');
