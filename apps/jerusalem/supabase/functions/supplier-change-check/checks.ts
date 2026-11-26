// All registry answers for a batch of numbers: the Companies Registrar, GuideStar, and the
// data.gov.il checks (nonprofit registrar, ניהול תקין, recent events). Each answer carries
// which checks ran, so the site lists what was checked and what was not (stage B, 25.11).
import type { Credentials } from '../supplier-identifiers/sources.ts';
import { checkDatagov, type Extra } from './datagov.ts';
import { checkGuidestar, checkRegistrar, type Checked, type Identifier } from './registry.ts';

export interface AllAnswers {
  readonly results: Checked[];
  readonly sources: Record<string, string>;
}

function merged(main: Checked | undefined, extra: Extra, ran: Record<string, string>): Checked[] {
  const checks = { ...ran, ...extra.checks };
  if (main) {
    return [{ ...main, details: { ...main.details, ...extra.details, checks } }];
  }
  // Without GuideStar, the nonprofit registrar's row stands in. A number it does not list is
  // not saved as "not found": a public-benefit company (חל"צ) is listed elsewhere.
  const nonprofit = extra.nonprofit;
  if (!nonprofit?.found) return [];
  const { name, status } = nonprofit;
  return [{ id: extra.id, found: true, name, status, details: { ...extra.details, checks } }];
}

export async function checkAll(
  items: Identifier[],
  guidestar: Credentials | null,
  fetcher: typeof fetch,
): Promise<AllAnswers> {
  const [registrar, gs, extras] = await Promise.all([
    checkRegistrar(items, fetcher),
    checkGuidestar(items, guidestar, fetcher),
    checkDatagov(items, fetcher),
  ]);
  const main = new Map([...registrar.results, ...gs.results].map((r) => [r.id, r]));
  const results = extras.flatMap((extra) => {
    const scheme = items.find((i) => i.id === extra.id)?.scheme;
    const own = scheme === 'company' ? { registrar: registrar.state } : { guidestar: gs.state };
    return merged(main.get(extra.id), extra, own);
  });
  const datagov = extras.every((e) => Object.values(e.checks).every((c) => c === 'ok'));
  return {
    results,
    sources: {
      companies_registrar: registrar.state,
      guidestar: gs.state,
      datagov: extras.length === 0 || datagov ? 'ok' : 'failed',
    },
  };
}
