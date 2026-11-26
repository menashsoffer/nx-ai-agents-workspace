import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SERVE_ENTRY_POINT = fileURLToPath(
  new URL('./serve.mjs', import.meta.url),
);
const STARTUP_PATTERN = /listening on (\S+) port (\d+)/;
const STOP_GRACE_MILLISECONDS = 2000;

/**
 * Spawns the real serve.mjs CLI on an ephemeral port and resolves once it
 * prints its startup line. A child that exits early or stays silent past
 * the timeout is killed and reaped, and the error carries its stderr.
 */
export function startServerProcess({
  root,
  base = '/',
  host,
  entryPoint = SERVE_ENTRY_POINT,
  startupTimeoutMilliseconds = 10_000,
}) {
  const hostArguments = host ? ['--host', host] : [];
  const child = spawn(
    process.execPath,
    [
      entryPoint,
      '--root',
      root,
      '--base',
      base,
      '--port',
      '0',
      ...hostArguments,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let standardOutput = '';
  let standardError = '';
  child.stderr.on('data', (chunk) => (standardError += chunk));

  const hasExited = () => child.exitCode !== null || child.signalCode !== null;
  const waitForExit = () =>
    hasExited()
      ? Promise.resolve()
      : new Promise((resolve) => child.once('exit', resolve));

  const stop = async () => {
    if (hasExited()) return;
    child.kill('SIGTERM');
    const forceTimer = setTimeout(
      () => child.kill('SIGKILL'),
      STOP_GRACE_MILLISECONDS,
    );
    await waitForExit();
    clearTimeout(forceTimer);
  };

  return new Promise((resolve, reject) => {
    const fail = async (reason) => {
      child.removeAllListeners('exit');
      clearTimeout(startupTimer);
      await stop();
      reject(
        new Error(`${reason}\nstderr: ${standardError.trim() || '(empty)'}`),
      );
    };
    const startupTimer = setTimeout(
      () =>
        fail(`serve.mjs did not start within ${startupTimeoutMilliseconds}ms`),
      startupTimeoutMilliseconds,
    );
    child.once('exit', (code) =>
      fail(`serve.mjs exited early with code ${code}`),
    );
    child.stdout.on('data', (chunk) => {
      standardOutput += chunk;
      const match = STARTUP_PATTERN.exec(standardOutput);
      if (!match) return;
      clearTimeout(startupTimer);
      child.removeAllListeners('exit');
      resolve({
        boundAddress: match[1],
        baseUrl: `http://127.0.0.1:${match[2]}`,
        hasExited,
        stop,
      });
    });
  });
}
