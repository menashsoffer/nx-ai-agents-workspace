import { execFileSync } from 'node:child_process';
import { dirname, relative, resolve } from 'node:path';
import type { MarkdownRenderer } from 'vitepress';

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * `https://github.com/<owner>/<repo>` from `GITHUB_REPOSITORY` (set in CI) or
 * from a GitHub `origin` remote. Anything else: undefined.
 */
export function repoUrlFrom(
  githubRepository: string | undefined,
  remote: string | undefined,
): string | undefined {
  if (githubRepository && /^[\w.-]+\/[\w.-]+$/.test(githubRepository)) {
    return `https://github.com/${githubRepository}`;
  }
  const match =
    /^(?:https:\/\/github\.com\/|git@github\.com:)([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(
      remote?.trim() ?? '',
    );
  return match ? `https://github.com/${match[1]}` : undefined;
}

export function detectRepoUrl(): string | undefined {
  let remote: string | undefined;
  try {
    remote = execFileSync('git', ['remote', 'get-url', 'origin'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    // Not a git checkout, or no origin: only GITHUB_REPOSITORY can help.
  }
  return repoUrlFrom(process.env['GITHUB_REPOSITORY'], remote);
}

export interface RepoLinkOptions {
  docsDir: string;
  repoRoot: string;
  repoUrl: string | undefined;
}

/**
 * Links from `docs/` to files outside it (`../tools/...`) can't resolve on the
 * docs site. They point at the file on GitHub, or become plain text when the
 * repository URL is unknown, so the build never ships a dead link.
 */
export function repoLinks(
  md: MarkdownRenderer,
  { docsDir, repoRoot, repoUrl }: RepoLinkOptions,
): void {
  md.core.ruler.push('repo-links', (state) => {
    const file = String(state.env.path);

    /** The repo-relative path of a link leaving `docs/`, else undefined. */
    const outsidePath = (href: string | null) => {
      if (!href || SCHEME.test(href) || /^[#/]/.test(href)) return undefined;
      const target = resolve(dirname(file), href.split(/[?#]/)[0]);
      if (!relative(docsDir, target).startsWith('..')) return undefined;
      return relative(repoRoot, target).replaceAll('\\', '/');
    };

    for (const block of state.tokens) {
      // Whether each open link was turned into a <span>, to match its close.
      const toSpan: boolean[] = [];
      for (const token of block.children ?? []) {
        if (token.type === 'link_open') {
          const path = outsidePath(token.attrGet('href'));
          if (path && repoUrl) {
            const hash = /#.*$/.exec(token.attrGet('href') ?? '')?.[0] ?? '';
            token.attrSet('href', `${repoUrl}/blob/HEAD/${path}${hash}`);
          } else if (path) {
            token.type = 'repo_ref_open';
            token.tag = 'span';
            token.attrs = [['class', 'repo-file']];
          }
          toSpan.push(!!path && !repoUrl);
        } else if (token.type === 'link_close' && toSpan.pop()) {
          token.type = 'repo_ref_close';
          token.tag = 'span';
        }
      }
    }
  });
}
