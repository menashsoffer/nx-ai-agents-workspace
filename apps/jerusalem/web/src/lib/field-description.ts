export interface FieldLabel {
  label: string;
  hint?: string;
  /** Guidance behind an info icon beside the label, for fields whose rule most people know. */
  info?: string;
  error?: string | undefined;
}
export function describedBy(id: string, parts: { hint?: string; error?: string; extra?: string }) {
  const values = [parts.extra, parts.hint ? `${id}-hint` : '', parts.error ? `${id}-error` : ''];
  return values.filter(Boolean).join(' ') || undefined;
}
