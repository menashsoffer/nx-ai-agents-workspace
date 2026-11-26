// Runs every TypeScript test with coverage, then checks the merged result (npm run coverage).
// The Node test globs match the test:ts, test:supabase and test:web scripts in package.json.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';

const NODE_TESTS = [
  'supabase/functions/tests/*-test.ts',
  'supabase/tests/*-test.ts',
  'web/tests/*-test.ts',
  'web/src/**/tests/*-test.ts',
  'scripts/bundle/tests/*-test.ts',
  'scripts/coverage/tests/*-test.ts',
  'scripts/lint/tests/*-test.ts',
];

const scope = JSON.parse(readFileSync('scripts/coverage/scope.json', 'utf8')) as {
  include: string[];
  exclude: string[];
};

function run(command: string, args: string[], env: NodeJS.ProcessEnv = {}): void {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: { ...process.env, ...env },
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

rmSync('coverage', { recursive: true, force: true });
mkdirSync('coverage');
run(
  process.execPath,
  [
    '--test',
    '--experimental-test-coverage',
    ...scope.include.map((glob) => `--test-coverage-include=${glob}`),
    ...scope.exclude.map((glob) => `--test-coverage-exclude=${glob}`),
    '--test-reporter=lcov',
    '--test-reporter-destination=coverage/node.lcov',
    '--test-reporter=dot',
    '--test-reporter-destination=stdout',
    ...NODE_TESTS,
  ],
  { SQL_COVERAGE_DIR: 'coverage/sql' },
);
run('npx', ['vitest', 'run', '--coverage']);
run(process.execPath, ['scripts/coverage/check-coverage.ts']);
