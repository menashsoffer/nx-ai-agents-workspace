/**
 * Some registries publish several fields as one ";"-separated text. Each becomes its own tag,
 * trimmed, without empty parts. Returns null when the text holds no field at all.
 */
export function splitFields(text: string): string[] | null {
  const parts = text
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length ? parts : null;
}
