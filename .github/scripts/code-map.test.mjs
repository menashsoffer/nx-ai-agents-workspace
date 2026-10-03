import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { findVisNetwork, localizeHtml, verifyIntegrity } from './code-map.mjs';

const TAG =
  '<script src="https://unpkg.com/vis-network@9.1.6/standalone/umd/vis-network.min.js"\n' +
  '        integrity="sha384-Ux6phic9PEHJ38YtrijhkzyJ8yQlH8i/+buBR8s3mAZOJrP1gwyvAcIYl3GWtpX1"\n' +
  '        crossorigin="anonymous"></script>';
const page = (extra = '') =>
  `<html><head><title>graphify - x</title>${TAG}${extra}</head><body></body></html>`;

test('findVisNetwork reads the pinned version and integrity', () => {
  assert.deepEqual(findVisNetwork(page()), {
    version: '9.1.6',
    integrity:
      'sha384-Ux6phic9PEHJ38YtrijhkzyJ8yQlH8i/+buBR8s3mAZOJrP1gwyvAcIYl3GWtpX1',
  });
});

test('findVisNetwork fails when graphify no longer emits the tag', () => {
  assert.throws(() => findVisNetwork('<html></html>'), /no pinned unpkg/);
});

test('localizeHtml swaps the CDN tag for a same-origin script and sets the title', () => {
  const html = localizeHtml(page());
  assert.match(html, /<script src="vis-network\.min\.js"><\/script>/);
  assert.match(html, /<title>מפת קוד<\/title>/);
  assert.doesNotMatch(html, /unpkg/);
});

test('localizeHtml rejects any other third-party asset', () => {
  assert.throws(
    () =>
      localizeHtml(page('<link rel="stylesheet" href="https://x.test/a.css">')),
    /third-party assets: https:\/\/x\.test\/a\.css/,
  );
});

test('localizeHtml rejects third-party assets written in other legal HTML', () => {
  for (const extra of [
    '<script src = "https://x.test/a.js"></script>',
    '<script src=https://x.test/a.js></script>',
    '<script src=//x.test/a.js></script>',
    '<link rel=stylesheet href = //x.test/a.css>',
    '<script src="http:x.test/a.js"></script>',
    '<script src="http://pages.invalid/a.js"></script>',
    '<script src="//pages.invalid/a.js"></script>',
  ]) {
    assert.throws(() => localizeHtml(page(extra)), /third-party assets/, extra);
  }
});

test('localizeHtml keeps a page with only local assets', () => {
  const html = localizeHtml(page('<link rel="icon" href="data:,">'));
  assert.match(html, /vis-network\.min\.js/);
});

test('verifyIntegrity accepts matching bytes and rejects others', () => {
  const bytes = Buffer.from('console.log(1)');
  const sri = `sha384-${createHash('sha384').update(bytes).digest('base64')}`;
  assert.doesNotThrow(() => verifyIntegrity(bytes, sri));
  assert.throws(() => verifyIntegrity(Buffer.from('other'), sri), /mismatch/);
});
