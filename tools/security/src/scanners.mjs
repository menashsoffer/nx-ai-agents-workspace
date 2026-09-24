// The binary scanners (actionlint, zizmor, gitleaks) that `pnpm security`
// downloads from tools.json and runs. They run only when the manifest passed
// validation: a manifest problem means nothing is downloaded or executed.
import { spawnSync } from 'node:child_process';
import { ensureTool } from './fetch-tool.mjs';

export const MANIFEST_BLOCKED =
  'Binary scanners (actionlint, zizmor, gitleaks) NOT run: tools.json failed validation, so nothing was downloaded or executed. Fix tools.json first.';

/** The scanner invocations, in order. */
export function scannerPlan({ online }) {
  return [
    { label: 'W7/W8: actionlint', tool: 'actionlint', args: [] },
    {
      label: `W1-W5: zizmor (${online ? 'online' : 'offline'})`,
      tool: 'zizmor',
      args: [
        ...(online ? [] : ['--offline']),
        '--min-severity',
        'low',
        '--no-progress',
        '.github',
      ],
    },
    {
      label: 'S1: gitleaks (git history)',
      tool: 'gitleaks',
      args: [
        'git',
        '--redact',
        '--no-banner',
        // gh-pages holds generated Pages/Storybook build artifacts, not source;
        // its orphan history is pure noise for secret scanning (minified JS
        // frequently trips entropy-based rules). Exclude it from source and
        // remote-tracking refs alike; source branches stay fully scanned.
        '--log-opts',
        '--exclude=refs/heads/gh-pages --exclude=refs/remotes/*/gh-pages --all',
        '.',
      ],
    },
  ];
}

/**
 * @returns {{ label: string, problems: string[] }[]}
 */
export function runScanners({
  manifest,
  manifestProblems,
  platformKey,
  cwd,
  online,
  ensure = ensureTool,
  spawn = spawnSync,
}) {
  if (manifestProblems.length) {
    return [{ label: 'Binary scanners', problems: [MANIFEST_BLOCKED] }];
  }
  return scannerPlan({ online }).map(({ label, tool, args }) => {
    let binary;
    try {
      binary = ensure(tool, platformKey, { manifest });
    } catch (error) {
      return { label, problems: [`${tool} NOT run: ${error.message}`] };
    }
    const result = spawn(binary, args, { cwd, stdio: 'inherit' });
    return {
      label,
      problems:
        result.status === 0 ? [] : [`${tool} exited with ${result.status}`],
    };
  });
}
