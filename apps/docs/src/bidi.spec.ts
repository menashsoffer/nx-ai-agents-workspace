import { describe, expect, it } from 'vitest';
import { bidiBlocks } from './bidi.ts';
import { testRenderer } from './test-renderer.ts';

async function render(markdown: string) {
  return (await testRenderer(bidiBlocks)).render(markdown);
}

describe('bidiBlocks', () => {
  it('lets headings, paragraphs, list items and quotes pick their own direction', async () => {
    const html = await render(
      '# Title\n\nHello.\n\n- item\n\n> quote\n\n| a |\n| - |\n| b |\n',
    );
    expect(html).toMatch(/<h1[^>]* dir="auto"/);
    expect(html).toContain('<p dir="auto">Hello.</p>');
    expect(html).toContain('<li dir="auto">');
    expect(html).toContain('<blockquote dir="auto">');
    expect(html).toContain('<th dir="auto">');
    expect(html).toContain('<td dir="auto">');
  });

  it('does not touch code blocks', async () => {
    const html = await render('```ts\nconst x = 1;\n```\n');
    expect(html).not.toContain('dir="auto"');
  });
});
