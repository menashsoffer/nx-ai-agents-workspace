import type {
  FileLengthException,
  MeasuredFile,
} from './file-length-audit.scanner.js';

export const TODAY = new Date('2026-10-04T12:00:00Z');

export const COUNT_CASES: Array<[string, string, number]> = [
  ['an empty file has no lines', '', 0],
  ['one line without a newline', 'a', 1],
  ['one line with a newline', 'a\n', 1],
  ['a blank last line counts', 'a\n\n', 2],
  ['two lines without a final newline', 'a\nb', 2],
  ['Windows line endings count once per line', 'a\r\nb\r\n', 2],
  ['comments and blank lines count', '// c\n\nx\n', 3],
];

export const SCOPE_CASES: Array<[string, boolean]> = [
  ['apps/site/src/app/App.tsx', true],
  ['libs/shared/utils/src/lib/cn.ts', true],
  ['tools/pages/src/assemble.mjs', true],
  ['.github/scripts/pipeline.mjs', true],
  ['tools/scripts/template-smoke.sh', true],
  ['apps/site/src/styles.css', true],
  ['docs/pipeline.md', true],
  ['libs/ui/src/docs/introduction.mdx', true],
  ['.github/workflows/ci.yml', true],
  ['.github/workflows/preview.yaml', true],
  ['pnpm-lock.yaml', false],
  ['package.json', false],
  ['tsconfig.base.json', false],
  ['.github/dependabot.yml', false],
  ['apps/site/public/logo.svg', false],
  ['docs/pipeline-map.md', false],
  ['.agents/skills/nx-import/references/VITE.md', false],
  ['.github/skills/nx-import/references/VITE.md', false],
  ['apps/site/dist/assets/index.js', false],
  ['node_modules/pkg/index.js', false],
  ['libs/ui/storybook-static/index.html', false],
];

const exception = (
  overrides: Partial<FileLengthException>,
): FileLengthException => ({
  path: 'docs/big.md',
  issue: 12,
  reason: 'Split planned with the pipeline rewrite.',
  owner: '@owner-login',
  created: '2026-09-20',
  expires: '2026-12-01',
  ...overrides,
});
const file = (path: string, lineCount: number): MeasuredFile => ({
  path,
  lineCount,
});

export const PROBLEM_CASES: Array<
  [string, MeasuredFile[], FileLengthException[], string[]]
> = [
  ['a file at the cap passes', [file('a.ts', 400)], [], []],
  ['a file under the cap passes', [file('a.ts', 12)], [], []],
  [
    'a file over the cap with no entry fails',
    [file('a.ts', 401)],
    [],
    ['a.ts: 401 lines, over the 400-line cap'],
  ],
  [
    'a file over the cap with an entry passes',
    [file('docs/big.md', 761)],
    [exception({})],
    [],
  ],
  [
    'an entry for a file that is now within the cap must be removed',
    [file('docs/big.md', 380)],
    [exception({})],
    ['docs/big.md: listed in the registry but now 380 lines'],
  ],
  [
    'an entry for a file that is not checked must be removed',
    [file('a.ts', 10)],
    [exception({})],
    ['docs/big.md: listed in the registry but not a checked file'],
  ],
  [
    'each oversized file is reported once, in order',
    [file('b.ts', 500), file('a.ts', 450)],
    [],
    ['b.ts: 500 lines', 'a.ts: 450 lines'],
  ],
];

const entryOf = (...entries: unknown[]) => entries;

export const REGISTRY_CASES: Array<[string, unknown, string[]]> = [
  ['an empty registry is valid', [], []],
  ['a complete entry is valid', entryOf(exception({})), []],
  ['a registry that is not an array', {}, ['must be a JSON array']],
  [
    'a missing path',
    entryOf(exception({ path: '' })),
    ['path must be a repo-relative file path'],
  ],
  [
    'the same path twice',
    entryOf(exception({}), exception({})),
    ['the path is listed twice'],
  ],
  [
    'a missing issue number',
    entryOf(exception({ issue: 0 })),
    ['issue must be an issue number'],
  ],
  [
    'a short reason',
    entryOf(exception({ reason: 'later' })),
    ['reason must be at least 20 characters'],
  ],
  [
    'an owner without @',
    entryOf(exception({ owner: 'someone' })),
    ['owner must be a GitHub @user'],
  ],
  [
    'a placeholder owner',
    entryOf(exception({ owner: '@your-github-user' })),
    ['owner must be a GitHub @user'],
  ],
  [
    'a bad created date',
    entryOf(exception({ created: '20/09/2026' })),
    ['created must be YYYY-MM-DD'],
  ],
  [
    'a created date in the future',
    entryOf(exception({ created: '2026-10-05' })),
    ['created is in the future'],
  ],
  [
    'an expiry more than 90 days after creation',
    entryOf(exception({ created: '2026-09-01', expires: '2026-12-31' })),
    ['expires more than 90 days after created'],
  ],
  [
    'an expiry that has passed',
    entryOf(exception({ created: '2026-07-01', expires: '2026-09-01' })),
    ['expired on 2026-09-01; split the file'],
  ],
  [
    'an expiry today is still valid',
    entryOf(exception({ created: '2026-09-20', expires: '2026-10-04' })),
    [],
  ],
];
