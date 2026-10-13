// Patch metadata the engine never publishes: symbolic links, submodules,
// mode changes, executable or unusual new files, and binary content. Each
// is a way to make a "one Markdown line" patch do something else (a link to
// /etc/hostname, a script that becomes executable, a gitlink). Checked on
// the patch text before it is applied; engine-checks.mjs checks the
// applied files again with lstat.
//
// Pure: no I/O.

const REGULAR_FILE_MODE = '100644';

/** Problems with one patch's headers (empty when every file stays a plain file). */
export function patchMetadataProblems(patch) {
  const problems = [];
  let file = '(unknown file)';
  for (const rawLine of String(patch).split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    let match;
    if ((match = /^diff --git a\/(.*) b\//.exec(line))) file = match[1];
    else if ((match = /^new file mode (\d+)$/.exec(line))) {
      if (match[1] !== REGULAR_FILE_MODE)
        problems.push(
          `${file}: new file with mode ${match[1]} (only ${REGULAR_FILE_MODE})`,
        );
    } else if (/^(?:old|new) mode \d+$/.test(line))
      problems.push(`${file}: changes the file mode`);
    else if ((match = /^deleted file mode (\d+)$/.exec(line))) {
      if (match[1] !== REGULAR_FILE_MODE)
        problems.push(`${file}: deletes a file with mode ${match[1]}`);
    } else if ((match = /^index [0-9a-f]+\.\.[0-9a-f]+ (\d+)$/.exec(line))) {
      if (match[1] !== REGULAR_FILE_MODE)
        problems.push(
          `${file}: file mode ${match[1]} (symbolic link, submodule or executable)`,
        );
    } else if (/^GIT binary patch$|^Binary files .* differ$/.test(line))
      problems.push(`${file}: binary content`);
  }
  return [...new Set(problems)];
}
