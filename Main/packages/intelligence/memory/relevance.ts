/**
 * Lightweight local relevance ranking for saved memories (BM25-style).
 * No embeddings, no network, deterministic. Good enough to pick the handful
 * of user notes that relate to a chat message.
 */

import type { MemoryEntry } from "./MemoryManager";

const STOPWORDS = new Set((
  "a an and are as at be but by can could do does for from had has have how i if in into is it its " +
  "me my of on or our please should so than that the their them then there these they this to too " +
  "us was we what when where which who why will with would you your yours about just also any some " +
  "tell know want need like get make let give"
).split(" "));

export function tokenize(text: string): string[] {
  return (text.toLowerCase().normalize("NFKD").match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter(token => token.length > 1 && !STOPWORDS.has(token))
    .map(stem);
}

/** Tiny suffix stripper so "projects"/"project" and "running"/"run" meet. */
function stem(token: string): string {
  if (token.length > 5 && token.endsWith("ing")) return token.slice(0, -3);
  if (token.length > 4 && token.endsWith("ed")) return token.slice(0, -2);
  if (token.length > 4 && token.endsWith("ies")) return token.slice(0, -3) + "y";
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

export interface RankedMemory {
  entry: MemoryEntry;
  score: number;
}

export function rankMemories(
  entries: readonly MemoryEntry[],
  query: string,
  options: { limit?: number; minScore?: number } = {}
): RankedMemory[] {
  const limit = options.limit ?? 4;
  const minScore = options.minScore ?? 0.6;
  const queryTerms = [...new Set(tokenize(query))];
  if (queryTerms.length === 0 || entries.length === 0) return [];

  const docs = entries.map(entry => tokenize(entry.content));
  const avgLength = docs.reduce((sum, doc) => sum + doc.length, 0) / docs.length || 1;
  const documentFrequency = new Map<string, number>();
  for (const doc of docs) {
    for (const term of new Set(doc)) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
  }

  const k1 = 1.4;
  const b = 0.75;
  const ranked: RankedMemory[] = [];
  docs.forEach((doc, index) => {
    if (doc.length === 0) return;
    const counts = new Map<string, number>();
    for (const term of doc) counts.set(term, (counts.get(term) ?? 0) + 1);
    let score = 0;
    for (const term of queryTerms) {
      const tf = counts.get(term);
      if (!tf) continue;
      const df = documentFrequency.get(term) ?? 0;
      const idf = Math.log(1 + (docs.length + 1) / (df + 0.5));
      score += idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * doc.length / avgLength));
    }
    if (score >= minScore) ranked.push({ entry: entries[index], score });
  });
  ranked.sort((left, right) => right.score - left.score || right.entry.createdAt.localeCompare(left.entry.createdAt));
  return ranked.slice(0, limit);
}
