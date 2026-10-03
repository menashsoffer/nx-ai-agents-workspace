import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readDocEntries } from './docs-source.ts';
import { testRenderer } from './test-renderer.ts';

const docsDir = resolve(import.meta.dirname, '../../../docs');

/**
 * The docs are plain Markdown for GitHub, but VitePress compiles each file to
 * a Vue template. Raw HTML in them (a hard-wrapped code span that starts a
 * line with `<stage>`, say) breaks the docs build with an error that points at
 * generated code. This points at the file and line instead.
 */
describe('docs/ content', () => {
  it('has raw HTML only as comments', async () => {
    const md = await testRenderer(undefined, docsDir);
    const offenders: string[] = [];
    for (const { path, content } of readDocEntries(docsDir)) {
      const tokens = md.parse(content, { path: join(docsDir, path) });
      const html = tokens.flatMap((t) => [t, ...(t.children ?? [])]);
      for (const token of html) {
        if (!['html_block', 'html_inline'].includes(token.type)) continue;
        // VitePress inserts zero-width spaces itself (inline `{{ }}` escaping).
        if (/^(&#8203;|\s*<!--[\s\S]*-->\s*)$/.test(token.content)) continue;
        const line = (token.map?.[0] ?? 0) + 1;
        offenders.push(
          `${path}:${line} ${JSON.stringify(token.content.slice(0, 40))}`,
        );
      }
    }
    expect(offenders).toEqual([]);
  });

  it('is found', () => {
    const paths = readDocEntries(docsDir).map((e) => e.path);
    expect(paths).toContain('architecture.md');
    expect(paths).toContain('decisions/README.md');
  });
});
