#!/usr/bin/env node
// Mints a short-lived GitHub App installation access token so local Claude
// Code sessions push commits and open PRs as the pipeline bot instead of the
// developer's own GitHub account. Reads APP_ID and PEM_PATH from .env.local
// (never committed) and prints only the token to stdout; everything else
// goes to stderr so stdout stays safe to capture as a credential.

import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_OWNER = 'menashsoffer';
const REPO_NAME = 'nx-ai-agents-workspace';
const GITHUB_API = 'https://api.github.com';

function readEnvLocal(path) {
  const text = readFileSync(path, 'utf8');
  const env = {};
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function buildAppJwt(appId, privateKeyPem) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  // Backdate iat by 60s to tolerate clock drift, as GitHub recommends.
  const payload = { iat: now - 60, exp: now + 10 * 60, iss: appId };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = createSign('RSA-SHA256')
    .update(unsigned)
    .sign(privateKeyPem);
  return `${unsigned}.${base64url(signature)}`;
}

async function githubRequest(url, jwt, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...init.headers,
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `${init.method ?? 'GET'} ${url} -> ${response.status}: ${body}`,
    );
  }
  return response.json();
}

async function main() {
  const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const envPath = resolve(projectDir, '.env.local');

  let env;
  try {
    env = readEnvLocal(envPath);
  } catch {
    throw new Error(
      `.env.local not found at ${envPath}; set APP_ID and PEM_PATH there to mint a bot token`,
    );
  }

  const appId = env.APP_ID;
  const pemPath = env.PEM_PATH;
  if (!appId || !pemPath) {
    throw new Error('.env.local must set both APP_ID and PEM_PATH');
  }

  const privateKey = readFileSync(resolve(pemPath), 'utf8');
  const jwt = buildAppJwt(appId, privateKey);

  const installation = await githubRequest(
    `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/installation`,
    jwt,
  );

  const { token } = await githubRequest(
    `${GITHUB_API}/app/installations/${installation.id}/access_tokens`,
    jwt,
    { method: 'POST' },
  );

  process.stdout.write(token);
}

main().catch((error) => {
  console.error(`mint-app-token: ${error.message}`);
  process.exitCode = 1;
});
