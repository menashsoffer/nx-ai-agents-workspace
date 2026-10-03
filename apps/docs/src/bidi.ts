import type { MarkdownRenderer } from 'vitepress';

/** Block elements whose direction follows their own text. */
const BLOCKS = [
  'paragraph_open',
  'heading_open',
  'list_item_open',
  'blockquote_open',
  'th_open',
  'td_open',
];

/**
 * The site is RTL, but the documents are mixed: Hebrew prose and English
 * prose (including code identifiers). `dir="auto"` lays each block out in the
 * direction of its first strong letter, so an English paragraph reads and
 * aligns left-to-right while a Hebrew one reads right-to-left, and trailing
 * punctuation lands on the correct side in both.
 */
export function bidiBlocks(md: MarkdownRenderer): void {
  md.core.ruler.push('bidi-blocks', (state) => {
    for (const token of state.tokens) {
      if (BLOCKS.includes(token.type)) token.attrSet('dir', 'auto');
    }
  });
}
