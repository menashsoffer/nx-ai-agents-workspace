// Checks tools/security/tools.json: complete, well-formed, recently reviewed.
import { SUPPORTED_PLATFORMS } from './platform.mjs';

export const MAX_REVIEW_AGE_DAYS = 120;

/** @returns {string[]} problems */
export function validateManifest(manifest, today = new Date()) {
  const problems = [];
  const reviewed = Date.parse(`${manifest.reviewed}T00:00:00Z`);
  if (Number.isNaN(reviewed)) {
    problems.push('tools.json: "reviewed" must be YYYY-MM-DD.');
  } else {
    const ageDays = Math.floor((today.getTime() - reviewed) / 86_400_000);
    if (ageDays > MAX_REVIEW_AGE_DAYS) {
      problems.push(
        `tools.json: last reviewed ${manifest.reviewed} (${ageDays} days ago, limit ${MAX_REVIEW_AGE_DAYS}). Check for new tool releases, bump versions + sha256, update "reviewed".`,
      );
    }
  }
  for (const [name, tool] of Object.entries(manifest.tools ?? {})) {
    if (!/^\d+\.\d+\.\d+$/.test(tool.version ?? ''))
      problems.push(`${name}: version must be x.y.z.`);
    for (const platform of SUPPORTED_PLATFORMS) {
      const entry = tool.platforms?.[platform];
      if (!entry) {
        problems.push(`${name}: missing ${platform} build.`);
        continue;
      }
      if (!/^https:\/\//.test(entry.url ?? ''))
        problems.push(`${name} ${platform}: url must be https.`);
      if (!/^[0-9a-f]{64}$/.test(entry.sha256 ?? ''))
        problems.push(`${name} ${platform}: sha256 must be 64 hex chars.`);
    }
  }
  return problems;
}
