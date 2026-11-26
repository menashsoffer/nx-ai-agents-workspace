/** Search by name or email, ignoring case and extra spaces. */
export function matchesPerson(
  person: { first_name: string; last_name: string; email: string },
  query: string,
): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const text = `${person.first_name} ${person.last_name} ${person.email}`.toLowerCase();
  return words.every((word) => text.includes(word));
}
