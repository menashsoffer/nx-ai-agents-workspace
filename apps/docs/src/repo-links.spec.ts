import { describe, expect, it } from 'vitest';
import { repoLinks, repoUrlFrom } from './repo-links.ts';
import { testRenderer } from './test-renderer.ts';

describe('repoUrlFrom', () => {
  it('prefers GITHUB_REPOSITORY', () => {
    expect(repoUrlFrom('me/repo', 'git@github.com:other/x.git')).toBe(
      'https://github.com/me/repo',
    );
  });

  it.each([
    'https://github.com/me/repo.git',
    'https://github.com/me/repo',
    'git@github.com:me/repo.git\n',
  ])('reads the GitHub remote %s', (remote) => {
    expect(repoUrlFrom(undefined, remote)).toBe('https://github.com/me/repo');
  });

  it('knows nothing about other hosts or garbage', () => {
    expect(repoUrlFrom(undefined, 'http://127.0.0.1:1234/git/me/repo')).toBe(
      undefined,
    );
    expect(repoUrlFrom('not a repo', undefined)).toBe(undefined);
  });
});

const docsDir = '/work/docs';
const file = '/work/docs/security.md';

async function render(markdown: string, repoUrl: string | undefined) {
  const md = await testRenderer(
    (md) => repoLinks(md, { docsDir, repoRoot: '/work', repoUrl }),
    docsDir,
  );
  return md.render(markdown, { path: file, relativePath: 'security.md' });
}

describe('repoLinks', () => {
  const text =
    '[the list](../tools/security/exceptions.json#top) and [guide](pipeline.md) and [web](https://example.com) and [here](#x)';

  it('points links that leave docs/ at the file on GitHub', async () => {
    const html = await render(text, 'https://github.com/me/repo');
    expect(html).toContain(
      'href="https://github.com/me/repo/blob/HEAD/tools/security/exceptions.json#top"',
    );
  });

  it('leaves links inside docs/, external links and anchors alone', async () => {
    const html = await render(text, 'https://github.com/me/repo');
    expect(html).toContain('href="./pipeline.html"');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('href="#x"');
  });

  it('turns them into plain text when the repository is unknown', async () => {
    const html = await render(text, undefined);
    expect(html).toContain('<span class="repo-file">the list</span>');
    expect(html).not.toContain('exceptions.json');
    expect(html).toContain('href="./pipeline.html"');
  });
});
