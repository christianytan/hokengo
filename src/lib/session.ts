import type { CategoryId, Difficulty, Domain, QuestionMode, VocabularyEntry } from "../types/vocabulary";
import type { TermProgress } from "../types/progress";
import { QuestionGenerator, type GeneratedQuestion } from "./questionGenerator";
import { createRng, randomSeed, shuffle, type Rng } from "./random";
import { isNewTerm, isDue, isWeakTerm, weaknessScore } from "./scheduler";
import { searchVocabulary } from "./text";

/**
 * Session construction.
 *
 * A session is a list of ready-made questions. Questions are generated up front
 * so the UI can show progress and so a session can be reproduced from its seed.
 * If a term cannot produce a valid four-choice question in any enabled mode it is
 * reported in `skipped` rather than being padded with made-up options.
 */

export type SessionKind = "mixed" | "due" | "new" | "weak" | "bookmarked" | "selected";

export interface SessionFilters {
  categories: CategoryId[];
  domains: Domain[];
  difficulties: Difficulty[];
  search: string;
  termIds?: string[];
}

export interface SessionOptions {
  kind: SessionKind;
  filters: SessionFilters;
  modes: QuestionMode[];
  size: number;
  seed?: number;
}

export interface QuizItem {
  question: GeneratedQuestion;
  termId: string;
}

export interface Session {
  id: string;
  kind: SessionKind;
  seed: number;
  items: QuizItem[];
  skipped: string[];
  requestedSize: number;
}

export const EMPTY_FILTERS: SessionFilters = {
  categories: [],
  domains: [],
  difficulties: [],
  search: "",
};

export function filterEntries(
  entries: readonly VocabularyEntry[],
  filters: SessionFilters,
  progress: Record<string, TermProgress> = {}
): VocabularyEntry[] {
  let pool = entries.slice();
  if (filters.categories.length) pool = pool.filter((e) => filters.categories.includes(e.category));
  if (filters.domains.length) pool = pool.filter((e) => e.domains.some((d) => filters.domains.includes(d)));
  if (filters.difficulties.length) pool = pool.filter((e) => filters.difficulties.includes(e.difficulty));
  if (filters.search.trim()) pool = searchVocabulary(pool, filters.search);
  if (filters.termIds?.length) {
    const wanted = new Set(filters.termIds);
    pool = pool.filter((e) => wanted.has(e.id));
  }
  void progress;
  return pool;
}

function orderForKind(
  kind: SessionKind,
  pool: VocabularyEntry[],
  progress: Record<string, TermProgress>,
  rng: Rng,
  now: Date
): VocabularyEntry[] {
  switch (kind) {
    case "new":
      return shuffle(pool.filter((e) => isNewTerm(progress[e.id])), rng);
    case "due":
      return pool
        .filter((e) => isDue(progress[e.id], now))
        .sort((a, b) => weaknessScore(progress[b.id], now) - weaknessScore(progress[a.id], now));
    case "weak":
      return pool
        .filter((e) => isWeakTerm(progress[e.id], now))
        .sort((a, b) => weaknessScore(progress[b.id], now) - weaknessScore(progress[a.id], now));
    case "bookmarked":
      return shuffle(pool.filter((e) => progress[e.id]?.bookmarked), rng);
    case "selected":
      return shuffle(pool, rng);
    case "mixed":
    default: {
      const due = pool
        .filter((e) => isDue(progress[e.id], now))
        .sort((a, b) => weaknessScore(progress[b.id], now) - weaknessScore(progress[a.id], now));
      const fresh = shuffle(pool.filter((e) => isNewTerm(progress[e.id])), rng);
      const weak = pool
        .filter((e) => isWeakTerm(progress[e.id], now) && !isDue(progress[e.id], now))
        .sort((a, b) => weaknessScore(progress[b.id], now) - weaknessScore(progress[a.id], now));
      const rest = shuffle(
        pool.filter((e) => !isNewTerm(progress[e.id]) && !isDue(progress[e.id], now) && !isWeakTerm(progress[e.id], now)),
        rng
      );
      // Interleave so a mixed session is never one long block of the same kind.
      const buckets = [due, fresh, weak, rest].filter((b) => b.length);
      const out: VocabularyEntry[] = [];
      let added = true;
      let index = 0;
      while (added) {
        added = false;
        for (const bucket of buckets) {
          if (index < bucket.length) {
            out.push(bucket[index]);
            added = true;
          }
        }
        index++;
      }
      return out;
    }
  }
}

export function buildSession(
  entries: readonly VocabularyEntry[],
  progress: Record<string, TermProgress>,
  generator: QuestionGenerator,
  options: SessionOptions,
  now: Date = new Date()
): Session {
  const seed = options.seed ?? randomSeed();
  const rng = createRng(seed);
  const modes = options.modes.length ? options.modes : [];
  const pool = filterEntries(entries, options.filters, progress);
  const ordered = orderForKind(options.kind, pool, progress, rng, now);
  const size = Math.max(1, Math.min(50, Math.round(options.size)));

  const items: QuizItem[] = [];
  const skipped = new Set<string>();
  const usedModesByTerm = new Map<string, Set<string>>();

  const tryAppend = (entry: VocabularyEntry): boolean => {
    if (items.length >= size) return false;
    const used = usedModesByTerm.get(entry.id) ?? new Set<string>();
    const available = modes.filter((m) => generator.supports(entry.id, m) && !used.has(m));
    if (available.length === 0) {
      if (used.size === 0) skipped.add(entry.id);
      return false;
    }
    const shuffled = shuffle(available, rng);
    const question = generator.generateForTerm(entry.id, shuffled, rng);
    if (!question) {
      skipped.add(entry.id);
      return false;
    }
    used.add(question.mode);
    usedModesByTerm.set(entry.id, used);
    items.push({ question, termId: entry.id });
    return true;
  };

  for (const entry of ordered) {
    if (items.length >= size) break;
    tryAppend(entry);
  }

  // Small selections: repeat terms (in another mode) so the session still reaches
  // the requested length instead of ending after two questions.
  if (items.length < size && ordered.length > 0) {
    let guard = 0;
    while (items.length < size && guard < size * 4) {
      const entry = ordered[guard % ordered.length];
      tryAppend(entry);
      guard++;
    }
  }

  return {
    id: `${options.kind}:${seed}`,
    kind: options.kind,
    seed,
    items,
    skipped: [...skipped],
    requestedSize: size,
  };
}
