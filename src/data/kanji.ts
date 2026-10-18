import type { KanjiEntry } from "../types/kanji";
import rawKanji from "./kanji.json";

function isKanjiEntry(value: unknown): value is KanjiEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.kanji === "string" &&
    v.kanji.length === 1 &&
    typeof v.reading === "string" &&
    typeof v.meaning === "string"
  );
}

export const BUILT_IN_KANJI: KanjiEntry[] = (Array.isArray(rawKanji) ? rawKanji : []).filter(isKanjiEntry);

export function getBuiltInKanji(): KanjiEntry[] {
  return BUILT_IN_KANJI;
}
