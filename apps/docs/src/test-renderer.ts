import {
  createMarkdownRenderer,
  disposeMdItInstance,
  type MarkdownRenderer,
} from 'vitepress';

/**
 * A fresh VitePress markdown renderer. VitePress keeps one renderer per
 * process, so each call disposes the previous one before applying `setup`.
 */
export async function createTestRenderer(
  setup?: (md: MarkdownRenderer) => void,
  sourceDirectory = '/docs',
): Promise<MarkdownRenderer> {
  disposeMdItInstance();
  return createMarkdownRenderer(
    sourceDirectory,
    { config: setup },
    '/docs/',
    undefined,
  );
}
