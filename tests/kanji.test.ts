import { describe, expect, it } from "vitest";
import { BUILT_IN_KANJI } from "../src/data/kanji";
import { KanjiGenerator } from "../src/lib/kanjiGenerator";
import { buildKanjiSession, NEW_KANJI_PER_TAKE } from "../src/lib/kanjiSession";
import { createRng, hashString } from "../src/lib/random";

const generator = new KanjiGenerator(BUILT_IN_KANJI);

describe("kanji generator", () => {
  it("loads a usable kanji pack", () => {
    expect(BUILT_IN_KANJI.length).toBeGreaterThanOrEqual(100);
    expect(new Set(BUILT_IN_KANJI.map((k) => k.kanji)).size).toBe(BUILT_IN_KANJI.length);
  });

  it("generates four distinct kanji choices for every supported kanji", () => {
    for (const entry of BUILT_IN_KANJI) {
      const q = generator.generate(entry.id, createRng(hashString(entry.id)));
      if (!q) continue;
      expect(q.choices).toHaveLength(4);
      expect(q.choices.filter((c) => c.correct)).toHaveLength(1);
      expect(new Set(q.choices.map((c) => c.text)).size).toBe(4);
      expect(q.choices.find((c) => c.correct)?.text).toBe(entry.kanji);
    }
  });

  it("builds a take that introduces two new kanji before quizzing", () => {
    const session = buildKanjiSession(BUILT_IN_KANJI, {}, generator, { size: 12, seed: 7 });
    expect(session.newKanjiIds).toHaveLength(NEW_KANJI_PER_TAKE);
    expect(session.items.length).toBeGreaterThanOrEqual(4);
    expect(session.items.slice(0, 4).every((item) => session.newKanjiIds.includes(item.kanjiId))).toBe(true);
    for (const item of session.items) {
      expect(item.question.choices).toHaveLength(4);
      expect(item.question.choices.filter((c) => c.correct)).toHaveLength(1);
    }
  });
});
