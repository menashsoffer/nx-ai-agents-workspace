#!/usr/bin/env node
// Static server that behaves like GitHub Pages for a project site:
//   - files are served under the base path (e.g. /my-repo/)
//   - a directory serves its index.html
//   - any unknown path under the base returns <root>/404.html with status 404
//
//   node tools/pages/src/serve.mjs [--root dist/pages] [--base /repo/] [--port 4400] [--host 127.0.0.1]
// BASE_PATH is used when --base is not given. Without --host, the server
// binds every interface, same as before --host existed.
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

function isRegularFile(file) {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

function sendPlainText(response, status, body) {
  response.writeHead(status, { 'content-type': 'text/plain' }).end(body);
}

export function createPagesServer({ root, base = '/' }) {
  const prefix = base.endsWith('/') ? base : `${base}/`;
  const rootDirectory = resolve(root);

  const sendFile = (response, status, file) => {
    if (!isRegularFile(file)) {
      sendPlainText(response, 404, 'Not Found');
      return;
    }
    response.writeHead(status, {
      'content-type':
        CONTENT_TYPES_BY_EXTENSION[extname(file)] ?? 'application/octet-stream',
    });
    const stream = createReadStream(file);
    stream.on('error', () => {
      if (response.headersSent) response.destroy();
      else sendPlainText(response, 404, 'Not Found');
    });
    stream.pipe(response);
  };

  return createServer((request, response) => {
    let pathname;
    try {
      pathname = decodeURIComponent(
        new URL(request.url ?? '/', 'http://x').pathname,
      );
    } catch {
      sendPlainText(response, 400, 'Bad Request');
      return;
    }
    if (pathname.includes('\u0000')) {
      sendPlainText(response, 400, 'Bad Request');
      return;
    }
    if (!pathname.startsWith(prefix) && pathname !== prefix.slice(0, -1)) {
      sendPlainText(response, 404, 'Not Found');
      return;
    }
    const relativePath = normalize(pathname.slice(prefix.length - 1));
    let file = join(rootDirectory, relativePath);
    if (file !== rootDirectory && !file.startsWith(rootDirectory + sep)) {
      sendPlainText(response, 400, 'Bad Request');
      return;
    }
    if (existsSync(file) && statSync(file).isDirectory())
      file = join(file, 'index.html');
    if (isRegularFile(file)) return sendFile(response, 200, file);
    sendFile(response, 404, join(rootDirectory, '404.html'));
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
  server.listen(Number(values.port), values.host, () => {
    const address = server.address();
    console.log(
      `Pages preview listening on ${address.address} port ${address.port}, base ${values.base}`,
    );
  });
}
