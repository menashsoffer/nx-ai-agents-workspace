// dry-run: scenario 4, this comment shifts the code below by one line.
const NOTE_A_HTML = '<b>dry run A</b>';

export function DryRunNoteA() {
  return <p dangerouslySetInnerHTML={{ __html: NOTE_A_HTML }} />;
}
