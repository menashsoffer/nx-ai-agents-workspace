#!/usr/bin/env node
// Static server that behaves like GitHub Pages for a project site:
//   - files are served under the base path (e.g. /my-repo/)
//   - a directory serves its index.html
//   - any unknown path under the base returns <root>/404.html with status 404
//
//   node tools/pages/src/serve.mjs [--root dist/pages] [--base /repo/] [--port 4400] [--host 127.0.0.1]
// BASE_PATH is used when --base is not given.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
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

  const sendText = (response, status, text) => {
    response.writeHead(status, { 'content-type': 'text/plain' }).end(text);
  };

  const isInsideRoot = (file) =>
    file === rootDirectory || file.startsWith(rootDirectory + sep);

  return createServer((request, response) => {
    let pathname;
    try {
      pathname = decodeURIComponent(
        new URL(request.url ?? '/', 'http://x').pathname,
      );
    } catch {
      sendText(response, 400, 'Bad Request');
      return;
    }
    if (!pathname.startsWith(prefix) && pathname !== prefix.slice(0, -1)) {
      sendText(response, 404, 'Not Found');
      return;
    }
    const relativePath = normalize(pathname.slice(prefix.length - 1));
    let file;
    try {
      file = join(rootDirectory, relativePath);
      if (!isInsideRoot(file)) {
        sendText(response, 400, 'Bad Request');
        return;
      }
      if (existsSync(file) && statSync(file).isDirectory())
        file = join(file, 'index.html');
      if (existsSync(file)) {
        sendFile(response, 200, file);
        return;
      }
    } catch {
      sendText(response, 400, 'Bad Request');
      return;
    }
    const notFoundFile = join(rootDirectory, '404.html');
    if (existsSync(notFoundFile)) {
      sendFile(response, 404, notFoundFile);
    } else {
      sendText(response, 404, 'Not Found');
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      root: { type: 'string', default: 'dist/pages' },
      base: { type: 'string', default: process.env['BASE_PATH'] ?? '/' },
      port: { type: 'string', default: '4400' },
      host: { type: 'string' },
    },
  });
  const server = createPagesServer({ root: values.root, base: values.base });
  const onListening = () =>
    console.log(`Pages preview: http://localhost:${values.port}${values.base}`);
  if (values.host) {
    server.listen(Number(values.port), values.host, onListening);
  } else {
    server.listen(Number(values.port), onListening);
  }
}
