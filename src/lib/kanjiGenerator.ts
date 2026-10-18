import type { KanjiEntry } from "../types/kanji";
import { normalizeForSearch } from "./text";
import { shuffle, type Rng } from "./random";

export const KANJI_CHOICES_PER_QUESTION = 4;

export interface KanjiChoice {
  key: string;
  text: string;
  subtext?: string;
  correct: boolean;
}

export interface GeneratedKanjiQuestion {
  id: string;
  kanjiId: string;
  mode: "kanji";
  kind: "meaning" | "reading" | "completion";
  prompt: string;
  promptDetail?: string;
  choices: KanjiChoice[];
  explanation: string;
}

function sameText(a: string, b: string): boolean {
  return normalizeForSearch(a) === normalizeForSearch(b);
}

function hasSameReading(a: KanjiEntry, b: KanjiEntry): boolean {
  return !!a.reading && !!b.reading && sameText(a.reading, b.reading);
}

function hasSameMeaning(a: KanjiEntry, b: KanjiEntry): boolean {
  return !!a.meaning && !!b.meaning && sameText(a.meaning, b.meaning);
}

function blankExample(entry: KanjiEntry): string | null {
  for (const example of entry.examples ?? []) {
    if (example.includes(entry.kanji)) {
      return example.replace(entry.kanji, "＿＿");
    }
  }
  return null;
}

export class KanjiGenerator {
  private entries: KanjiEntry[];
  private byId = new Map<string, KanjiEntry>();

  constructor(entries: readonly KanjiEntry[]) {
    this.entries = entries.filter((e) => e.kanji.length === 1);
    for (const entry of this.entries) this.byId.set(entry.id, entry);
  }

  get size(): number {
    return this.byId.size;
  }

  supports(kanjiId: string): boolean {
    return this.byId.has(kanjiId);
  }

  private buildChoices(target: KanjiEntry, kind: GeneratedKanjiQuestion["kind"], rng: Rng): KanjiChoice[] | null {
    const chosen: KanjiEntry[] = [];
    const seen = new Set<string>([target.kanji]);
    const ordered = shuffle(this.entries.filter((e) => e.id !== target.id), rng);

    for (const candidate of ordered) {
      if (chosen.length >= KANJI_CHOICES_PER_QUESTION - 1) break;
      if (seen.has(candidate.kanji)) continue;
      if (hasSameMeaning(target, candidate)) continue;
      if (kind === "reading" && hasSameReading(target, candidate)) continue;
      if (kind === "completion" && (candidate.examples ?? []).some((ex) => ex.includes(target.kanji))) {
        // Avoid candidates that would also complete the same example.
        continue;
      }
      chosen.push(candidate);
      seen.add(candidate.kanji);
    }

    if (chosen.length < KANJI_CHOICES_PER_QUESTION - 1) return null;

    const choices: KanjiChoice[] = [
      {
        key: target.id,
        text: target.kanji,
        subtext: `${target.reading} — ${target.meaning}`,
        correct: true,
      },
      ...chosen.map((c) => ({
        key: c.id,
        text: c.kanji,
        subtext: `${c.reading} — ${c.meaning}`,
        correct: false,
      })),
    ];
    return shuffle(choices, rng);
  }

  generate(kanjiId: string, rng: Rng, kind?: GeneratedKanjiQuestion["kind"]): GeneratedKanjiQuestion | null {
    const target = this.byId.get(kanjiId);
    if (!target) return null;

    const kinds: GeneratedKanjiQuestion["kind"][] = kind ? [kind] : ["meaning", "reading", "completion"];
    for (const k of shuffle(kinds, rng)) {
      const choices = this.buildChoices(target, k, rng);
      if (!choices) continue;

      if (k === "meaning") {
        return {
          id: `kanji:${target.id}:meaning`,
          kanjiId: target.id,
          mode: "kanji",
          kind: k,
          prompt: `Which kanji means: ${target.meaning}?`,
          promptDetail: `Reading used in this trainer: ${target.reading}`,
          choices,
          explanation: `${target.kanji} is read ${target.reading} in this context and carries the meaning "${target.meaning}".`,
        };
      }

      if (k === "reading") {
        return {
          id: `kanji:${target.id}:reading`,
          kanjiId: target.id,
          mode: "kanji",
          kind: k,
          prompt: `Which kanji has the reading ${target.reading} in insurance/business words?`,
          promptDetail: `Core meaning: ${target.meaning}`,
          choices,
          explanation: `${target.kanji} is read ${target.reading} here and means "${target.meaning}".`,
        };
      }

      const blanked = blankExample(target);
      if (!blanked) continue;
      return {
        id: `kanji:${target.id}:completion`,
        kanjiId: target.id,
        mode: "kanji",
        kind: k,
        prompt: `Fill the missing kanji: ${blanked}`,
        promptDetail: `Meaning hint: ${target.meaning}`,
        choices,
        explanation: `${target.kanji} completes the example and contributes the meaning "${target.meaning}".`,
      };
    }

    return null;
  }
}
