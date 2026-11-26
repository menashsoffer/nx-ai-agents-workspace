import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';

// Cascade layers rank in the order they are first named. The build splits CSS into chunks and
// links shared chunks (buttons, panels) before the main stylesheet, so a layer order declared
// inside the bundle comes too late and `base` beats `ui` (purple text on purple buttons). The
// order therefore lives in an unprocessed public file that the page links before everything.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

it('declares the layer order in a public file', () => {
  assert.equal(
    read('../../../public/layers.css').trim(),
    '@layer reset, base, ui, features, utilities;',
  );
});

it('links the layer order before the app script and its stylesheets', () => {
  const html = read('../../../index.html');
  const layers = html.indexOf('<link rel="stylesheet" href="/layers.css" />');
  assert.ok(layers > 0);
  assert.ok(layers < html.indexOf('<script'));
});
