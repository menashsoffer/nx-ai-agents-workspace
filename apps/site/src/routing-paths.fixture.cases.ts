export const FIXTURE_CASES: Array<[string, string, number]> = [
  [
    'flags a hard-coded root-absolute <a> href string literal',
    '<a href="/about">about</a>',
    1,
  ],
  [
    'flags an <a> href template literal that does not start with BASE_URL',
    '<a href={`/about`}>about</a>',
    1,
  ],
  [
    'passes an <a> href template literal built from BASE_URL',
    '<a href={`${import.meta.env.BASE_URL}code-map/`}>map</a>',
    0,
  ],
  [
    'passes internal navigation expressed with Link/NavLink',
    '<Link to="/about">about</Link><NavLink to="/">home</NavLink>',
    0,
  ],
  [
    'flags a hard-coded root-absolute img src string literal',
    '<img src="/logo.svg" alt="" />',
    1,
  ],
  [
    'flags a hard-coded root-absolute link href string literal',
    '<link href="/favicon.svg" rel="icon" />',
    1,
  ],
  [
    'passes an img src template literal built from BASE_URL',
    '<img src={`${import.meta.env.BASE_URL}logo.svg`} alt="" />',
    0,
  ],
  [
    'passes an asset reference through an import',
    'import logo from \'./logo.svg\';\n<img src={logo} alt="" />',
    0,
  ],
  [
    'flags a CSS url() that hard-codes a root-absolute path',
    "const backgroundImage = 'url(/bg.png)';",
    1,
  ],
  [
    'passes a CSS url() built from BASE_URL',
    'const backgroundImage = `url(${import.meta.env.BASE_URL}bg.png)`;',
    0,
  ],
];
