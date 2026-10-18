export interface KanjiEntry {
  id: string;
  kanji: string;
  reading: string;
  meaning: string;
  examples?: string[];
  source?: string;
}

export const KANJI_PROGRESS_PREFIX = "kanji:";

export function kanjiProgressId(kanjiId: string): string {
  return `${KANJI_PROGRESS_PREFIX}${kanjiId}`;
}

export function isKanjiProgressId(termId: string): boolean {
  return termId.startsWith(KANJI_PROGRESS_PREFIX);
}
