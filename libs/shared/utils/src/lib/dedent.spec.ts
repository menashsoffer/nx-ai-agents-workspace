import dedent from 'dedent';

describe('dedent', () => {
  it('strips common leading whitespace from a multi-line template literal', () => {
    const result = dedent`
      line one
      line two
        line three
    `;

    expect(result).toBe('line one\nline two\n  line three');
  });
});
