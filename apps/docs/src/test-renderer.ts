import {
  createMarkdownRenderer,
  disposeMdItInstance,
  type MarkdownRenderer,
} from 'vitepress';

/**
 * A fresh VitePress markdown renderer. VitePress keeps one renderer per
 * process, so each call disposes the previous one before applying `setup`.
 */
export async function testRenderer(
  setup?: (md: MarkdownRenderer) => void,
  srcDir = '/docs',
): Promise<MarkdownRenderer> {
  disposeMdItInstance();
  return createMarkdownRenderer(srcDir, { config: setup }, '/docs/', undefined);
}
