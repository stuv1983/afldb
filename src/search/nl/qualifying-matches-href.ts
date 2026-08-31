/**
 * Returns the exact drill-down URL for a qualifying team-aggregate count.
 * If the plan token is absent (e.g. legacy or unanswerable paths), returns null
 * to indicate the rendering should fall back to plain text.
 */
export function getQualifyingMatchesHref(planToken: string | null | undefined, clubSlug: string): string | null {
  if (!planToken) return null;
  return `/search/qualifying-matches?plan=${planToken}&club=${clubSlug}`;
}
