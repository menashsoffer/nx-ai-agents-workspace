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

  ...[
    'a{background:url(/img/*);margin-left:4px}',
    String.raw`a{background:URL(/img/\20/*);margin-left:4px}`,
    String.raw`a{background:\75rl(/img/\9/*);margin-left:4px}`,
    '@IMPORT/**/url(/img/*);a{margin-left:4px}',
    'a{background:url(a(b);margin-left:4px}',
    'a{content:"/*";margin-left:4px}',
  ].map((cssText): PhysicalCssCase => ({
    category: 'css url',
    cssText,
    expectedFindings: ['margin-left'],
  })),
  {
    category: 'css escape',
    cssText: String.raw`a{m\61rgin-left:4px}`,
    expectedFindings: ['margin-left'],
  },
  {
    category: 'css escape',
    cssText: String.raw`a{clear:l\65 ft}`,
    expectedFindings: ['clear: left'],
  },
  {
    category: 'css escape',
    cssText: String.raw`a{margin\3b left:1px}`,
    expectedFindings: [],
  },
  {
    category: 'four-value shorthand',
    cssText: 'a{scroll-margin:0 0 0 4px;scroll-padding:0 0 0 4px}',
    expectedFindings: [
      'scroll-margin: four values',
      'scroll-padding: four values',
    ],
  },
];
