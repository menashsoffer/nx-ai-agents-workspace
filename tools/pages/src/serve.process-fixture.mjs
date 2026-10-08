// Spawns the real serve.mjs CLI as a child process, so tests exercise the
// actual entry point (argument parsing, listen() call) instead of only the
// in-process createPagesServer() + .listen() path.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SERVE_SCRIPT_PATH = fileURLToPath(
  new URL('./serve.mjs', import.meta.url),
);
const STARTUP_LOG_PATTERN = /listening on (\S+) port (\d+)/;
const STARTUP_TIMEOUT_MS = 10_000;

/** Starts `serve.mjs` on an ephemeral port and resolves once it is ready. */
export async function startPagesServerProcess({ root, base = '/', host }) {
  const args = ['--root', root, '--base', base, '--port', '0'];
  if (host !== undefined) args.push('--host', host);

  const child = spawn(process.execPath, [SERVE_SCRIPT_PATH, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const { boundAddress, port } = await new Promise(
    (resolveStartup, rejectStartup) => {
      let output = '';
      const timer = setTimeout(() => {
        rejectStartup(
          new Error(`Pages server did not start in time. Output: ${output}`),
        );
      }, STARTUP_TIMEOUT_MS);

      const onData = (chunk) => {
        output += chunk.toString();
        const match = STARTUP_LOG_PATTERN.exec(output);
        if (match) {
          clearTimeout(timer);
          child.stdout.off('data', onData);
          resolveStartup({ boundAddress: match[1], port: Number(match[2]) });
        }
      };
      child.stdout.on('data', onData);
      child.once('error', (error) => {
        clearTimeout(timer);
        rejectStartup(error);
      });
      child.once('exit', (code) => {
        clearTimeout(timer);
        rejectStartup(
          new Error(
            `Pages server exited early with code ${code}. Output: ${output}`,
          ),
        );
      });
    },
  );

  return {
    boundAddress,
    baseUrl: `http://127.0.0.1:${port}`,
    async stop() {
      child.kill();
      await new Promise((resolveExit) => child.once('exit', resolveExit));
    },
  };
}
