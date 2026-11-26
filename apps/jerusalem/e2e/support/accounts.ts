import type { Page } from '@playwright/test';
import { env } from './env.ts';

export const PASSWORD = 'e2e-password';
export const ACCOUNTS = {
  admin: 'admin@e2e.test',
  editor: 'editor@e2e.test',
  supplier: 'supplier@e2e.test',
} as const;

interface Grant {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

/**
 * Signs in without the email round trip: a password grant (local accounts only), stored the
 * way the site stores a magic-link session. The magic link itself is covered in access-test.
 */
export async function signIn(page: Page, who: keyof typeof ACCOUNTS): Promise<void> {
  const response = await fetch(`${env('E2E_API_URL')}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: env('E2E_PUBLISHABLE_KEY'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ACCOUNTS[who], password: PASSWORD }),
  });
  if (!response.ok) throw new Error(`sign-in for ${who} failed: ${String(response.status)}`);
  const grant = (await response.json()) as Grant;
  const session = JSON.stringify({
    token: grant.access_token,
    exp: Date.now() + grant.expires_in * 1000,
    refresh: grant.refresh_token,
  });
  await page.addInitScript({
    content: `localStorage.setItem('consultants-session-v2', ${JSON.stringify(session)});`,
  });
}
