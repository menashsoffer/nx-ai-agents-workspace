export interface ColourCase {
  category: string;
  sourceText: string;
  isReported: boolean;
}

const functionCall = (name: string): ColourCase => ({
  category: 'colour function',
  sourceText: `const tint = \`${name}(0 0 0)\`;`,
  isReported: true,
});

export const COLOUR_CASES: ColourCase[] = [
  ...[
    'rgb',
    'rgba',
    'hsl',
    'hsla',
    'hwb',
    'lab',
    'lch',
    'oklab',
    'oklch',
    'color',
    'color-mix',
  ].map(functionCall),
  {
    category: 'hex colour',
    sourceText: "const a = '#fade';",
    isReported: true,
  },
  {
    category: 'hex colour',
    sourceText: '<i className="bg-[#fff]" />',
    isReported: true,
  },
  {
    category: 'hex colour',
    sourceText: 'const a = "#AABBCC80";',
    isReported: true,
  },
  {
    category: 'named colour',
    sourceText: "<i style={{ color: 'rebeccapurple' }} />",
    isReported: true,
  },
  {
    category: 'named colour',
    sourceText: '<i className="bg-[red]" />',
    isReported: true,
  },
  {
    category: 'anchor and id',
    sourceText: '<a href="#add">x</a>',
    isReported: false,
  },
  {
    category: 'anchor and id',
    sourceText: '<a href="#cafe">x</a>',
    isReported: false,
  },
  {
    category: 'anchor and id',
    sourceText: '<i id="#fade" />',
    isReported: false,
  },
  {
    category: 'hex length',
    sourceText: "const a = '#12345'; const b = '#1234567';",
    isReported: false,
  },
  {
    category: 'colour word in text',
    sourceText: '<p>red</p>',
    isReported: false,
  },
  {
    category: 'token class',
    sourceText: '<i className="bg-brand-600" />',
    isReported: false,
  },
];
