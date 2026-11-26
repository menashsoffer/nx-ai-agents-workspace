#!/usr/bin/env node
// Static server that behaves like GitHub Pages for a project site:
//   - files are served under the base path (e.g. /my-repo/)
//   - a directory serves its index.html
//   - any unknown path under the base returns <root>/404.html with status 404
//
//   node tools/pages/src/serve.mjs [--root dist/pages] [--base /repo/] [--port 4400] [--host 127.0.0.1]
// BASE_PATH is used when --base is not given.
import {
  close,
  createReadStream,
  existsSync,
  fstat,
  open,
  statSync,
} from 'node:fs';
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

  const sendPlainText = (response, status, message) => {
    response.writeHead(status, { 'content-type': 'text/plain' }).end(message);
  };

  // Opens the file and checks it is a regular file BEFORE any header is
  // written, so every open failure (missing, directory, permission denied)
  // can still be answered with a clean response. Calls onUnavailable() then.
  const sendFile = (response, status, file, onUnavailable) => {
    open(file, 'r', (openError, descriptor) => {
      if (openError) return onUnavailable();
      fstat(descriptor, (statError, stats) => {
        if (statError || !stats.isFile()) {
          close(descriptor);
          return onUnavailable();
        }
        const stream = createReadStream(file, { fd: descriptor });
        // After headers are out the only safe reaction is to drop the response.
        stream.on('error', () => response.destroy());
        response.writeHead(status, {
          'content-type':
            CONTENT_TYPES_BY_EXTENSION[extname(file)] ??
            'application/octet-stream',
        });
        stream.pipe(response);
      });
    });
  };

  const sendNotFound = (response) => {
    sendFile(response, 404, join(rootDirectory, '404.html'), () =>
      sendPlainText(response, 404, 'Not Found'),
    );
  };

  const handleRequest = (request, response) => {
    const pathname = decodeURIComponent(
      new URL(request.url ?? '/', 'http://x').pathname,
    );
    if (pathname.includes('\0'))
      return sendPlainText(response, 400, 'Bad Request');
    if (!pathname.startsWith(prefix) && pathname !== prefix.slice(0, -1))
      return sendPlainText(response, 404, 'Not Found');
    const relativePath = normalize(pathname.slice(prefix.length - 1));
    let file = join(rootDirectory, relativePath);
    if (file !== rootDirectory && !file.startsWith(rootDirectory + sep))
      return sendPlainText(response, 400, 'Bad Request');
    if (existsSync(file) && statSync(file).isDirectory())
      file = join(file, 'index.html');
    sendFile(response, 200, file, () => sendNotFound(response));
  };

  return createServer((request, response) => {
    try {
      handleRequest(request, response);
    } catch {
      // Malformed percent-escape (URIError) or any other synchronous routing failure.
      if (!response.headersSent) sendPlainText(response, 400, 'Bad Request');
      else response.destroy();
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
  const announce = () => {
    const { address, port } = server.address();
    console.log(
      `Pages preview: http://localhost:${port}${values.base} (listening on ${address} port ${port})`,
    );
  };
  if (values.host) server.listen(Number(values.port), values.host, announce);
  else server.listen(Number(values.port), announce);
}
