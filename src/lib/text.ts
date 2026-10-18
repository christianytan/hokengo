import type { VocabularyEntry } from "../types/vocabulary";

/** Full-width -> half-width, case-fold, strip whitespace/punctuation. */
export function normalizeForSearch(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\u3000]+/g, " ")
    .replace(/[\u3001\u3002\uff0c\u3000]/g, "")
    .trim();
}

/** Convert full-width romaji macrons to plain ascii for tolerant matching. */
export function foldRomaji(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/gi, "")
    .toLowerCase();
}

export function entrySearchBlob(entry: VocabularyEntry): string {
  return normalizeForSearch(
    [
      entry.term,
      entry.kana,
      entry.romaji,
      entry.translation,
      ...(entry.alternativeTranslations ?? []),
      entry.definitionJa,
      entry.explanationEn,
      entry.tags.join(" "),
      entry.subcategory ?? "",
    ].join(" \u2022 ")
  );
}

/** Simple, dependency-free search: substring matching over the whole blob. */
export function searchVocabulary(entries: readonly VocabularyEntry[], query: string): VocabularyEntry[] {
  const q = normalizeForSearch(query);
  if (!q) return entries.slice();
  const terms = q.split(" ").filter(Boolean);
  return entries.filter((entry) => {
    const blob = entrySearchBlob(entry);
    return terms.every((t) => blob.includes(t) || foldRomaji(t).length > 0 && blob.includes(foldRomaji(t)));
  });
}

function tokenSet(value: string): Set<string> {
  const norm = normalizeForSearch(value);
  const words = norm.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1);
  const set = new Set<string>(words);
  // character bigrams handle Japanese and partial-word overlap
  const compact = norm.replace(/\s+/g, "");
  for (let i = 0; i + 1 < compact.length; i++) set.add(compact.slice(i, i + 2));
  return set;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const item of a) if (b.has(item)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * 0..1 similarity between two English phrases.
 * Used to keep near-synonyms out of multiple-choice distractor lists.
 */
export function phraseSimilarity(a: string, b: string): number {
  const na = normalizeForSearch(a);
  const nb = normalizeForSearch(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.length > 6 && nb.length > 6 && (na.includes(nb) || nb.includes(na))) return 0.9;
  return jaccard(tokenSet(na), tokenSet(nb));
}

/** True when two answer texts are too close to be used together as options. */
export function areAnswersTooSimilar(a: string, b: string, threshold = 0.34): boolean {
  return phraseSimilarity(a, b) >= threshold;
}

/** Split a sentence into matched / unmatched parts for highlighting a term. */
export function splitAroundTerm(
  sentence: string,
  surface: string
): { text: string; match: boolean }[] {
  const index = sentence.indexOf(surface);
  if (index < 0 || !surface) return [{ text: sentence, match: false }];
  const parts: { text: string; match: boolean }[] = [];
  if (index > 0) parts.push({ text: sentence.slice(0, index), match: false });
  parts.push({ text: surface, match: true });
  const rest = sentence.slice(index + surface.length);
  if (rest) parts.push({ text: rest, match: false });
  return parts;
}
