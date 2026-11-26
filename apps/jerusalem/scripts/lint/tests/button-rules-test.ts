import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { buttonRestrictions } from '../button-rules.ts';

const linter = new Linter({ configType: 'flat' });
const config = [
  {
    files: ['**/*.tsx'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: { 'no-restricted-syntax': ['error', ...buttonRestrictions] },
  },
] as Linter.Config[];

function messages(code: string): string[] {
  return linter.verify(code, config, 'web/src/x.tsx').map((message) => message.message);
}

describe('button guard (DESIGN.md 6.2)', () => {
  it('catches a raw button, a button-typed input and a role="button"', () => {
    assert.equal(messages('const a = <button type="button">x</button>;').length, 1);
    assert.equal(messages('const a = <input type="submit" />;').length, 1);
    assert.equal(messages('const a = <div role="button">x</div>;').length, 1);
  });
  it('catches an icon placed by hand inside a Button', () => {
    const found = messages('const a = <Button><Icon name="pencil" />עריכה</Button>;');
    assert.match(found[0] ?? '', /icon prop/u);
  });
  it('lets the shared components and ordinary inputs through', () => {
    assert.deepEqual(messages('const a = <Button icon="pencil">עריכה</Button>;'), []);
    assert.deepEqual(messages('const a = <IconButton icon="close" label="סגירה" />;'), []);
    assert.deepEqual(messages('const a = <input type="text" />;'), []);
  });
});
