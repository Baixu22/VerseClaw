export function filterSettingsSections<T extends { title: string; description: string }>(
  sections: readonly T[],
  query: string,
): T[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return [...sections];
  return sections.filter((section) => (
    `${section.title} ${section.description}`.toLocaleLowerCase().includes(normalizedQuery)
  ));
}
