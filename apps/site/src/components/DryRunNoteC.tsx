const NOTE_C_HTML = '<b>dry run C</b>';

export function DryRunNoteC() {
  return <p dangerouslySetInnerHTML={{ __html: NOTE_C_HTML }} />;
}
