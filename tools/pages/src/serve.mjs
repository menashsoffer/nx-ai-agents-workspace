#!/usr/bin/env node
// Static server that behaves like GitHub Pages for a project site:
//   - files are served under the base path (e.g. /my-repo/)
//   - a directory serves its index.html
//   - any unknown path under the base returns <root>/404.html with status 404
//
//   node tools/pages/src/serve.mjs [--root dist/pages] [--base /repo/] [--port 4400]
// BASE_PATH is used when --base is not given.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const CONTENT_TYPES_BY_EXTENSION = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain',
};

export function createPagesServer({ root, base = '/' }) {
  const prefix = base.endsWith('/') ? base : `${base}/`;
  const rootDirectory = resolve(root);

  const sendFile = (response, status, file) => {
    response.writeHead(status, {
      'content-type':
        CONTENT_TYPES_BY_EXTENSION[extname(file)] ?? 'application/octet-stream',
    });
    createReadStream(file).pipe(response);
  };

  return createServer((request, response) => {
    const pathname = decodeURIComponent(
      new URL(request.url ?? '/', 'http://x').pathname,
    );
    if (!pathname.startsWith(prefix) && pathname !== prefix.slice(0, -1)) {
      response
        .writeHead(404, { 'content-type': 'text/plain' })
        .end('Not Found');
      return;
    }
    const relativePath = normalize(pathname.slice(prefix.length - 1));
    let file = join(rootDirectory, relativePath);
    if (!file.startsWith(rootDirectory)) {
      response.writeHead(400).end();
      return;
    }
    if (existsSync(file) && statSync(file).isDirectory())
      file = join(file, 'index.html');
    if (existsSync(file)) return sendFile(response, 200, file);
    sendFile(response, 404, join(rootDirectory, '404.html'));
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      root: { type: 'string', default: 'dist/pages' },
      base: { type: 'string', default: process.env['BASE_PATH'] ?? '/' },
      port: { type: 'string', default: '4400' },
    },
  });
  createPagesServer({ root: values.root, base: values.base }).listen(
    Number(values.port),
    () =>
      console.log(
        `Pages preview: http://localhost:${values.port}${values.base}`,
      ),
  );
}
