import { describe, expect, it } from 'vitest';
import { tokenizeCss } from './css-tokens.mjs';

const describeTokens = (css) =>
  tokenizeCss(css).map((token) => `${token.type}:${token.value}`);

describe('tokenizeCss', () => {
  it('drops comments and joins neighbours', () => {
    expect(describeTokens('@import/**/"a.css" /* x */ ;')).toEqual([
      'at-keyword:import',
      'string:a.css',
      'delim:;',
    ]);
  });

  it('does not read a comment opener inside a string or a url()', () => {
    expect(describeTokens('a{content:"/*"}')).toContain('string:/*');
    expect(describeTokens('url(a/*b)')).toEqual(['url:a/*b']);
  });

  it('ends a string at its own quote, whatever else it holds', () => {
    expect(describeTokens(`"a(b)'c" 'd"e)'`)).toEqual([
      "string:a(b)'c",
      'string:d"e)',
    ]);
  });

  it('decodes escapes in strings, names and urls', () => {
    expect(describeTokens(String.raw`"\68 ttps:\2f\2f x"`)).toEqual([
      'string:https://x',
    ]);
    expect(describeTokens(String.raw`@\69mport`)).toEqual([
      'at-keyword:import',
    ]);
    expect(describeTokens(String.raw`\75rl(a.png)`)).toEqual(['url:a.png']);
    expect(describeTokens(String.raw`url(https:\2f\2f x.test/a)`)).toEqual([
      'url:https://x.test/a',
    ]);
  });

  it('turns an invalid or zero code point into U+FFFD', () => {
    expect(describeTokens(String.raw`"\0 \110000 \d800 "`)).toEqual([
      'string:���',
    ]);
  });

  it('joins a string over an escaped newline and ends it at a bare one', () => {
    expect(describeTokens('"a\\\nb"')).toEqual(['string:ab']);
    expect(tokenizeCss('"a\nb"')[0].type).toBe('bad-string');
  });

  it('reads url( as a function when a quote follows, case-insensitively', () => {
    expect(describeTokens('URL( "a.png" )')).toEqual([
      'function:url',
      'string:a.png',
      'delim:)',
    ]);
    expect(describeTokens('Url( a.png )')).toEqual(['url:a.png']);
  });

  it('keeps the contents of a bad url, raw', () => {
    expect(describeTokens('url(a(b).png)')).toEqual([
      'bad-url:a(b',
      'delim:.',
      'ident:png',
      'delim:)',
    ]);
    expect(describeTokens('url(a b)')).toEqual(['bad-url:a b']);
    expect(describeTokens('url(a\u0001b)')).toEqual(['bad-url:a\u0001b']);
  });

  it('handles an unterminated comment, string and url', () => {
    expect(describeTokens('a /* never closed')).toEqual(['ident:a']);
    expect(describeTokens('"abc')).toEqual(['string:abc']);
    expect(describeTokens('url(abc')).toEqual(['url:abc']);
  });
});
