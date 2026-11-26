import { expect } from '@playwright/test';
import { env } from './env.ts';

interface Listing {
  messages: { ID: string }[];
}
interface Message {
  Text: string;
}

async function latest(email: string): Promise<string | null> {
  const query = encodeURIComponent(`to:"${email}"`);
  const list = (await (
    await fetch(`${env('E2E_MAILPIT_URL')}/api/v1/search?query=${query}&limit=1`)
  ).json()) as Listing;
  const id = list.messages[0]?.ID;
  if (!id) return null;
  const message = (await (
    await fetch(`${env('E2E_MAILPIT_URL')}/api/v1/message/${id}`)
  ).json()) as Message;
  return /https?:\/\/\S+\/auth\/v1\/verify\S+/.exec(message.Text)?.[0] ?? null;
}

/** The sign-in link from the newest email to this address, waiting until it arrives. */
export async function signInLink(email: string): Promise<string> {
  const found: string[] = [];
  const check = async (): Promise<string | null> => {
    const link = await latest(email);
    if (link) found.push(link);
    return link;
  };
  await expect.poll(check, { timeout: 15_000 }).not.toBeNull();
  return found.at(-1) ?? '';
}
