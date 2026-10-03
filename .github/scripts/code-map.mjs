#!/usr/bin/env node
// Turns graphify's output into the static /code-map/ folder of the Pages site
// (deploy.yml, docs/decisions/2026-10-03-code-map-on-pages.md):
//
//   node .github/scripts/code-map.mjs <graphify-out-dir> <dest-dir>
//
//   <dest>/index.html            graphify's graph.html, made self-contained
//   <dest>/graph.json            the graph data
//   <dest>/vis-network.min.js    the one script graph.html loads from unpkg
//
// The Pages artifact allows no third-party scripts (docs/security.md, P1), so
// the unpkg tag is replaced by a same-origin copy of the same file. The copy
// comes from the npm tarball and must match the SRI hash graphify pins in the
// tag; anything else fails the build.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const VIS_SCRIPT =
  /<script\s+src="https:\/\/unpkg\.com\/vis-network@(\d+\.\d+\.\d+)\/standalone\/umd\/vis-network\.min\.js"\s+integrity="(sha384-[A-Za-z0-9+/=]+)"[^>]*><\/script>/;

/** Absolute or protocol-relative URLs in <script src> / <link href>. */
const EXTERNAL_ASSET =
  /<(?:script[^>]*\ssrc|link[^>]*\shref)=["']((?:https?:)?\/\/[^"']+)["']/gi;

/** Finds graphify's pinned vis-network tag: `{ version, integrity }`. */
export function findVisNetwork(html) {
  const match = VIS_SCRIPT.exec(html);
  if (!match) {
    throw new Error(
      'graph.html has no pinned unpkg vis-network <script>; graphify changed its output, review code-map.mjs',
    );
  }
  return { version: match[1], integrity: match[2] };
}

/** Throws unless `bytes` hash to the `sha384-<base64>` SRI value. */
export function verifyIntegrity(bytes, integrity) {
  const actual = `sha384-${createHash('sha384').update(bytes).digest('base64')}`;
  if (actual !== integrity) {
    throw new Error(
      `vis-network integrity mismatch: ${actual} != ${integrity}`,
    );
  }
}

/** graph.html with the unpkg tag replaced by a same-origin one and a Hebrew title. */
export function localizeHtml(html) {
  findVisNetwork(html);
  const local = html
    .replace(VIS_SCRIPT, '<script src="vis-network.min.js"></script>')
    .replace(/<title>[^<]*<\/title>/, '<title>מפת קוד</title>');
  const external = [...local.matchAll(EXTERNAL_ASSET)].map(([, url]) => url);
  if (external.length) {
    throw new Error(
      `graph.html still loads third-party assets: ${external.join(', ')}`,
    );
  }
  return local;
}

/** Reads standalone/umd/vis-network.min.js out of the npm tarball. */
async function fetchVisNetwork(version) {
  const url = `https://registry.npmjs.org/vis-network/-/vis-network-${version}.tgz`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GET ${url}: ${response.status}`);
  const dir = mkdtempSync(join(tmpdir(), 'vis-network-'));
  const tarball = join(dir, 'vis-network.tgz');
  writeFileSync(tarball, Buffer.from(await response.arrayBuffer()));
  return execFileSync(
    'tar',
    ['-xzOf', tarball, 'package/standalone/umd/vis-network.min.js'],
    { maxBuffer: 64 * 1024 * 1024 },
  );
}

export async function buildCodeMap(graphifyOut, dest) {
  const html = readFileSync(join(graphifyOut, 'graph.html'), 'utf8');
  const { version, integrity } = findVisNetwork(html);
  const script = await fetchVisNetwork(version);
  verifyIntegrity(script, integrity);

  mkdirSync(dest, { recursive: true });
  writeFileSync(join(dest, 'index.html'), localizeHtml(html));
  writeFileSync(join(dest, 'vis-network.min.js'), script);
  writeFileSync(
    join(dest, 'graph.json'),
    readFileSync(join(graphifyOut, 'graph.json')),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [graphifyOut, dest] = process.argv.slice(2);
  if (!graphifyOut || !dest) {
    console.error('usage: code-map.mjs <graphify-out-dir> <dest-dir>');
    process.exit(2);
  }
  buildCodeMap(graphifyOut, dest).then(
    () => console.log(`code map written to ${dest}`),
    (error) => {
      console.error(error.message);
      process.exit(1);
    },
  );
}
