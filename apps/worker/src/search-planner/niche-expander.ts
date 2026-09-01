const DENTIST_EXPANSION = [
  'Dentist',
  'Dental Clinic',
  'Family Dentist',
  'Cosmetic Dentist',
  'Orthodontist',
  'Pediatric Dentist',
  'Emergency Dentist',
] as const;

const NICHE_EXPANSIONS = new Map<string, readonly string[]>([
  ['dentist', DENTIST_EXPANSION],
  ['dentists', DENTIST_EXPANSION],
]);

export function expandNiche(niche: string): string[] {
  const trimmed = niche.trim();
  if (!trimmed) return [];

  const candidates = NICHE_EXPANSIONS.get(trimmed.toLowerCase()) ?? [trimmed];
  const seen = new Set<string>();
  const queries: string[] = [];

  for (const candidate of candidates) {
    const query = candidate.trim();
    const key = query.toLowerCase();
    if (!query || seen.has(key)) continue;
    seen.add(key);
    queries.push(query);
  }

  return queries;
}
