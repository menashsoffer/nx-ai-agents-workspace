import { describe, expect, it } from 'vitest';
import { applyRepoLinks, resolveRepoUrl } from './repo-links.ts';
import { createTestRenderer } from './test-renderer.ts';

describe('resolveRepoUrl', () => {
  it('prefers GITHUB_REPOSITORY', () => {
    expect(resolveRepoUrl('me/repo', 'git@github.com:other/x.git')).toBe(
      'https://github.com/me/repo',
    );
  });

  it.each([
    'https://github.com/me/repo.git',
    'https://github.com/me/repo',
    'git@github.com:me/repo.git\n',
  ])('reads the GitHub remote %s', (remote) => {
    expect(resolveRepoUrl(undefined, remote)).toBe(
      'https://github.com/me/repo',
    );
  });

  it('knows nothing about other hosts or garbage', () => {
    expect(resolveRepoUrl(undefined, 'http://127.0.0.1:1234/git/me/repo')).toBe(
      undefined,
    );
    expect(resolveRepoUrl('not a repo', undefined)).toBe(undefined);
  });
});

const docsDirectory = '/work/docs';
const sourceFilePath = '/work/docs/security.md';

async function render(markdown: string, repoUrl: string | undefined) {
  const markdownRenderer = await createTestRenderer(
    (renderer) =>
      applyRepoLinks(renderer, { docsDirectory, repoRoot: '/work', repoUrl }),
    docsDirectory,
  );
  return markdownRenderer.render(markdown, {
    path: sourceFilePath,
    relativePath: 'security.md',
  });
}

describe('applyRepoLinks', () => {
  const markdownText =
    '[the list](../tools/security/exceptions.json#top) and [guide](pipeline.md) and [web](https://example.com) and [here](#x)';

  it('points links that leave docs/ at the file on GitHub', async () => {
    const html = await render(markdownText, 'https://github.com/me/repo');
    expect(html).toContain(
      'href="https://github.com/me/repo/blob/HEAD/tools/security/exceptions.json#top"',
    );
  });

  it('leaves links inside docs/, external links and anchors alone', async () => {
    const html = await render(markdownText, 'https://github.com/me/repo');
    expect(html).toContain('href="./pipeline.html"');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('href="#x"');
  });

  it('turns them into plain text when the repository is unknown', async () => {
    const html = await render(markdownText, undefined);
    expect(html).toContain('<span class="repo-file">the list</span>');
    expect(html).not.toContain('exceptions.json');
    expect(html).toContain('href="./pipeline.html"');
  });
});
