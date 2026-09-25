// dry-run: scenario 4, this comment shifts the code below by one line.
const NOTE_B_HTML = '<b>dry run B</b>';

export function DryRunNoteB() {
  return <p dangerouslySetInnerHTML={{ __html: NOTE_B_HTML }} />;
}
