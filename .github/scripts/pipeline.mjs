#!/usr/bin/env node
// Deterministic pipeline steps, called from .github/workflows/*.yml.
// Usage: node .github/scripts/pipeline.mjs <command> [args...]
// The commands live in pipeline/commands-*.mjs; shared helpers in
// pipeline/helpers.mjs. This file only picks the command and runs it.
import { approvalCommands } from './pipeline/commands-approval.mjs';
import { coreCommands } from './pipeline/commands-core.mjs';
import { lifecycleCommands } from './pipeline/commands-lifecycle.mjs';
import { ownerCommands } from './pipeline/commands-owner.mjs';
import { protectedCommands } from './pipeline/commands-protected.mjs';
import { reviewCommands } from './pipeline/commands-review.mjs';

const [, , command, ...argv] = process.argv;

const commands = {
  ...coreCommands,
  ...approvalCommands,
  ...reviewCommands,
  ...ownerCommands,
  ...protectedCommands,
  ...lifecycleCommands,
};

if (!commands[command]) {
  console.error(
    `Unknown command: ${command}\nCommands: ${Object.keys(commands).join(', ')}`,
  );
  process.exit(2);
}
try {
  await commands[command](argv);
} catch (e) {
  console.error(e.stack ?? e);
  process.exit(1);
}
