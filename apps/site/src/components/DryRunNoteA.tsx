const NOTE_A_HTML = '<b>dry run A</b>';

export function DryRunNoteA() {
  return <p dangerouslySetInnerHTML={{ __html: NOTE_A_HTML }} />;
}
