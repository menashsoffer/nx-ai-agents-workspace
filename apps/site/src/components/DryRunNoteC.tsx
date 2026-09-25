// dry-run: scenario 4, this comment shifts the code below by one line.
const NOTE_C_HTML = '<b>dry run C</b>';

export function DryRunNoteC() {
  return <p dangerouslySetInnerHTML={{ __html: NOTE_C_HTML }} />;
}
