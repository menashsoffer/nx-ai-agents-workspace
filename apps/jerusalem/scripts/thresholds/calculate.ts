import {
  cbsIndex,
  thresholdInsert,
  thresholdsFromCbs,
} from '../../supabase/functions/_shared/procurement/cbs.ts';

async function main(): Promise<void> {
  const [yearArg, monthArg, ...extra] = process.argv.slice(2);
  if (
    !yearArg ||
    !monthArg ||
    extra.length ||
    !/^\d{4}$/.test(yearArg) ||
    !/^\d{1,2}$/.test(monthArg)
  ) {
    throw new Error('Usage: node scripts/thresholds/calculate.ts YEAR MONTH');
  }
  const year = Number(yearArg);
  const month = Number(monthArg);
  thresholdsFromCbs(1, year, month);
  const period = `${String(month).padStart(2, '0')}-${String(year)}`;
  const url = new URL('https://api.cbs.gov.il/index/data/price');
  url.search = new URLSearchParams({
    id: '120010',
    format: 'json',
    startPeriod: period,
    endPeriod: period,
    coef: 'true',
  }).toString();
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`CBS request failed: ${String(response.status)}`);
  const data: unknown = await response.json();
  const index = cbsIndex(data, year, month);
  console.log(thresholdInsert(index, year, month));
  console.error('Verify that this was the latest CPI published before the update date.');
  console.error('Calculated amounts are unofficial; no database changes were made.');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Calculation failed');
  process.exitCode = 1;
});
