import type { KanjiEntry } from "../types/kanji";
import { kanjiProgressId } from "../types/kanji";
import type { TermProgress } from "../types/progress";
import { KanjiGenerator, type GeneratedKanjiQuestion } from "./kanjiGenerator";
import { createRng, randomSeed, shuffle } from "./random";
import { isNewTerm, weaknessScore } from "./scheduler";

export const NEW_KANJI_PER_TAKE = 2;

export interface KanjiQuizItem {
  question: GeneratedKanjiQuestion;
  kanjiId: string;
}

export interface KanjiSession {
  id: string;
  seed: number;
  newKanjiIds: string[];
  items: KanjiQuizItem[];
  skipped: string[];
  requestedSize: number;
}

export interface KanjiSessionOptions {
  size: number;
  seed?: number;
}

function isKanjiNew(progress: Record<string, TermProgress>, entry: KanjiEntry): boolean {
  return isNewTerm(progress[kanjiProgressId(entry.id)]);
}

export function buildKanjiSession(
  entries: readonly KanjiEntry[],
  progress: Record<string, TermProgress>,
  generator: KanjiGenerator,
  options: KanjiSessionOptions,
  now: Date = new Date()
): KanjiSession {
  const seed = options.seed ?? randomSeed();
  const rng = createRng(seed);
  const size = Math.max(4, Math.min(50, Math.round(options.size)));

  const newPool = shuffle(entries.filter((e) => isKanjiNew(progress, e)), rng);
  const newKanjiIds = newPool.slice(0, NEW_KANJI_PER_TAKE).map((e) => e.id);
  const reviewPool = entries
    .filter((e) => !isKanjiNew(progress, e))
    .sort((a, b) => weaknessScore(progress[kanjiProgressId(b.id)], now) - weaknessScore(progress[kanjiProgressId(a.id)], now));

  const items: KanjiQuizItem[] = [];
  const skipped = new Set<string>();
  const usedKinds = new Map<string, Set<string>>();

  const tryAppend = (kanjiId: string, kind?: "meaning" | "reading" | "completion"): boolean => {
    if (items.length >= size) return false;
    const used = usedKinds.get(kanjiId) ?? new Set<string>();
    const question = generator.generate(kanjiId, rng, kind);
    if (!question) {
      skipped.add(kanjiId);
      return false;
    }
    if (used.has(question.kind)) return false;
    used.add(question.kind);
    usedKinds.set(kanjiId, used);
    items.push({ question, kanjiId });
    return true;
  };

  // First, introduce and immediately quiz the two new kanji.
  for (const id of newKanjiIds) {
    tryAppend(id, "meaning");
    tryAppend(id, "reading");
    tryAppend(id, "completion");
  }

  // Then fill the rest with review questions, or with additional new-kanji
  // questions if the learner has no kanji history yet.
  const review = shuffle(reviewPool, rng);
  let guard = 0;
  while (items.length < size && guard < size * 8) {
    const candidate = review[guard % Math.max(1, review.length)];
    if (candidate) {
      tryAppend(candidate.id);
    } else if (newKanjiIds.length) {
      tryAppend(newKanjiIds[guard % newKanjiIds.length]);
    } else {
      break;
    }
    guard++;
  }

  return {
    id: `kanji:${seed}`,
    seed,
    newKanjiIds,
    items,
    skipped: [...skipped],
    requestedSize: size,
  };
}
