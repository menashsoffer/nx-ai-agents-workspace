export interface PhysicalCssCase {
  category: string;
  cssText: string;
  expectedFindings: string[];
}

const longhand = (property: string, value: string): PhysicalCssCase => ({
  category: 'physical longhand',
  cssText: `a { ${property}: ${value}; }`,
  expectedFindings: [property],
});

export const PHYSICAL_CSS_CASES: PhysicalCssCase[] = [
  longhand('margin-left', '4px'),
  longhand('border-left-color', 'red'),
  longhand('border-right-width', '1px'),
  longhand('scroll-margin-left', '4px'),
  longhand('scroll-padding-right', '4px'),
  longhand('border-top-left-radius', '4px'),
  longhand('border-bottom-right-radius', '4px'),
  longhand('left', '0'),
  {
    category: 'physical keyword',
    cssText: 'a { clear: left; text-align: RIGHT !important; float: left }',
    expectedFindings: ['clear: left', 'text-align: right', 'float: left'],
  },
  {
    category: 'four-value shorthand',
    cssText:
      'a { margin: 0 0 0 4px; inset: 0 1px 0 2px; padding: 1px 2px 3px calc(1px + 2px) }',
    expectedFindings: [
      'margin: four values',
      'inset: four values',
      'padding: four values',
    ],
  },
  {
    category: 'logical equivalent',
    cssText:
      'a { border-inline-start-color: red; scroll-margin-inline-start: 4px; border-start-start-radius: 4px; text-align: start; float: inline-end }',
    expectedFindings: [],
  },
  {
    category: 'symmetric shorthand',
    cssText: 'a { margin: 0 4px; margin: 1px 2px 3px 2px; --left: 0 }',
    expectedFindings: [],
  },
  {
    category: 'css comment',
    cssText: '/* margin-left: old */ a { /* unclosed margin-right: 1px',
    expectedFindings: [],
  },
  {
    category: 'css string',
    cssText: 'a::after { content: "margin-left: x"; quotes: \'left: 1\' }',
    expectedFindings: [],
  },
];
