// The trusted orchestrator for a target's setup and verify commands
// (engine-check.yml, verify job). One Node process reads the profile and
// its own code once, BEFORE any target code runs, then runs every setup
// command and every verify command as a child process and decides from
// their exit codes alone. A setup command that rewrites engine.mjs, the
// profile or anything else on disk cannot change the running process, so
// it cannot turn a failing verify command into a pass. (Running a second
// `node engine.mjs` after setup, as before, loaded whatever setup left.)
// The workflow also makes the engine checkout and the profile root-owned
// and read-only and removes sudo and Docker access before this step.
import { spawnSync } from 'node:child_process';
import { parseFlags } from './pipeline-lib.mjs';
import { commandEnvironment, failOn, readJson } from './engine-cli-support.mjs';

export const verifyCommands = {
  // Runs the profile's setup, then verify commands, in the target (cwd).
  // Exit 1 on the first failing command, or when there is nothing to verify.
  'verify-target'(args) {
    const flags = parseFlags(args);
    const { setup, verify } = readJson(flags.profile).commands;
    if (!verify.length)
      failOn(['the profile has no verify commands'], 'Verify');
    const environment = commandEnvironment();
    const steps = [
      ...setup.map((command) => ['setup', command]),
      ...verify.map((command) => ['verify', command]),
    ];
    for (const [kind, [program, ...commandArguments]] of steps) {
      const text = [program, ...commandArguments].join(' ');
      console.log(`$ (${kind}) ${text}`);
      const result = spawnSync(program, commandArguments, {
        stdio: 'inherit',
        env: environment,
      });
      if (result.status !== 0)
        failOn(
          [
            `${kind} command failed (${result.status ?? result.signal}): ${text}`,
          ],
          'Verify',
        );
    }
    console.log(`verify: ${steps.length} command(s) passed`);
  },
};
