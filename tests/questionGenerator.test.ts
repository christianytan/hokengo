import { describe, expect, it } from "vitest";
import { BUILT_IN_VOCABULARY } from "../src/data";
import { QuestionGenerator, QUESTION_MODES, CHOICES_PER_QUESTION } from "../src/lib/questionGenerator";
import { createRng, hashString } from "../src/lib/random";
import type { CategoryId, QuestionMode } from "../src/types/vocabulary";
import { CATEGORY_IDS } from "../src/data/categories";

const generator = new QuestionGenerator(BUILT_IN_VOCABULARY);
const byId = new Map(BUILT_IN_VOCABULARY.map((e) => [e.id, e]));
const rngFor = (seed: number) => createRng(seed);
const BLANK = "\uFF3F\uFF3F\uFF3F";

describe("question generator - structural guarantees", () => {
  it("knows every entry", () => {
    expect(generator.size).toBe(BUILT_IN_VOCABULARY.length);
  });

  for (const mode of QUESTION_MODES) {
    it(mode + ": supported questions have 4 distinct choices and one correct answer", () => {
      let generated = 0;
      for (const entry of BUILT_IN_VOCABULARY) {
        if (!generator.supports(entry.id, mode)) continue;
        const question = generator.generate(entry.id, mode, rngFor(hashString(entry.id + mode)));
        expect(question, entry.id + " " + mode + " produced no question").not.toBeNull();
        generated++;
        const q = question!;
        expect(q.choices.length).toBe(CHOICES_PER_QUESTION);
        expect(q.choices.filter((c) => c.correct)).toHaveLength(1);
        const texts = q.choices.map((c) => c.text.trim().toLowerCase());
        expect(new Set(texts).size).toBe(CHOICES_PER_QUESTION);
        const correct = q.choices.find((c) => c.correct)!;
        if (mode === "jp-to-en" || mode === "context") {
          expect(correct.text).toBe(entry.translation);
        } else {
          expect(correct.text).toBe(entry.term);
        }
      }
      expect(generated, "no " + mode + " questions could be generated").toBeGreaterThan(20);
    });
  }

  it("does not always place the correct answer in the same position", () => {
    const positions = new Map<number, number>();
    for (const entry of BUILT_IN_VOCABULARY.slice(0, 40)) {
      const q = generator.generate(entry.id, "jp-to-en", rngFor(hashString(entry.id)));
      if (!q) continue;
      const index = q.choices.findIndex((c) => c.correct);
      positions.set(index, (positions.get(index) ?? 0) + 1);
    }
    expect(positions.size).toBeGreaterThanOrEqual(3);
  });

  it("is deterministic for a given seed", () => {
    const id = BUILT_IN_VOCABULARY[0].id;
    const a = generator.generate(id, "jp-to-en", rngFor(42));
    const b = generator.generate(id, "jp-to-en", rngFor(42));
    expect(a!.choices.map((x) => x.key)).toEqual(b!.choices.map((x) => x.key));
    const c = generator.generate(id, "jp-to-en", rngFor(9001))!.choices.map((x) => x.key);
    expect(a!.choices.map((x) => x.key).join()).not.toBe(c.join());
  });

  it("fill-in-the-blank hides the term and never leaks a distractor into the sentence", () => {
    for (const entry of BUILT_IN_VOCABULARY) {
      if (!generator.supports(entry.id, "fill-blank")) continue;
      const q = generator.generate(entry.id, "fill-blank", rngFor(hashString(entry.id)))!;
      const shown = q.sentenceParts!.map((p) => p.text).join("");
      expect(shown).toContain(BLANK);
      expect(shown).not.toContain(entry.term);
      for (const distractor of q.choices.filter((c) => !c.correct)) {
        expect(shown.includes(distractor.text), entry.id + " leaks " + distractor.text).toBe(false);
      }
    }
  });

  it("context mode highlights the term inside the original sentence", () => {
    for (const entry of BUILT_IN_VOCABULARY) {
      if (!generator.supports(entry.id, "context")) continue;
      const q = generator.generate(entry.id, "context", rngFor(hashString(entry.id)))!;
      const parts = q.sentenceParts!;
      expect(parts.map((p) => p.text).join("")).toBe(entry.example.ja);
      expect(parts.some((p) => p.match && p.text.length > 0)).toBe(true);
    }
  });

  it("distinction mode includes a confusable partner and its explanation", () => {
    for (const entry of BUILT_IN_VOCABULARY) {
      if (!generator.supports(entry.id, "distinction")) continue;
      const q = generator.generate(entry.id, "distinction", rngFor(hashString(entry.id)))!;
      const wrongKeys = q.choices.filter((c) => !c.correct).map((c) => c.key);
      const partners = entry.confusedTerms.map((c) => c.termId).filter(Boolean) as string[];
      expect(wrongKeys.some((k) => partners.includes(k)), entry.id).toBe(true);
      expect(q.distinctionNotes.length).toBeGreaterThan(0);
    }
  });

  it("confusable terms are never distractors in modes A/B/C", () => {
    for (const entry of BUILT_IN_VOCABULARY) {
      const partners = new Set(entry.confusedTerms.map((c) => c.termId).filter(Boolean));
      for (const mode of ["jp-to-en", "en-to-jp", "context"] as QuestionMode[]) {
        if (!generator.supports(entry.id, mode)) continue;
        const q = generator.generate(entry.id, mode, rngFor(hashString(entry.id + mode)))!;
        for (const choice of q.choices.filter((c) => !c.correct)) {
          expect(partners.has(choice.key), entry.id + " " + mode + " used confusable " + choice.key).toBe(false);
        }
      }
    }
  });

  it("every category supports every mode", () => {
    for (const category of CATEGORY_IDS as CategoryId[]) {
      for (const mode of QUESTION_MODES) {
        const usable = BUILT_IN_VOCABULARY.filter((e) => e.category === category && generator.supports(e.id, mode));
        expect(usable.length, category + " has no " + mode + " support").toBeGreaterThanOrEqual(5);
        const q = generator.generate(usable[0].id, mode, rngFor(1));
        expect(q, category + " " + mode + " generation failed").not.toBeNull();
      }
    }
  });

  it("reports per-mode coverage of the dataset", () => {
    const rows: string[] = [];
    for (const mode of QUESTION_MODES) {
      const supported = BUILT_IN_VOCABULARY.filter((e) => generator.supports(e.id, mode));
      let generated = 0;
      for (const entry of supported) {
        if (generator.generate(entry.id, mode, rngFor(hashString(entry.id + mode)))) generated++;
      }
      rows.push(mode.padEnd(12) + " supported " + String(supported.length).padStart(3) + " / " + BUILT_IN_VOCABULARY.length + "   generated " + generated);
      expect(generated, mode + ": a supported term produced no question").toBe(supported.length);
      // Every built-in term must be usable in every mode: the dataset is written so
      // that each example sentence contains the term exactly once and each entry has
      // at least one confusable partner whose meaning is clearly different.
      expect(supported.length, mode + ": these terms cannot produce that question type: " + BUILT_IN_VOCABULARY.filter((e) => !generator.supports(e.id, mode)).map((e) => e.id).join(", ")).toBe(BUILT_IN_VOCABULARY.length);
    }
    console.log("\nmode coverage:\n" + rows.join("\n"));
  });

  it("returns null for unknown terms", () => {
    expect(generator.generate("does-not-exist", "jp-to-en", rngFor(1))).toBeNull();
    expect(generator.supports("does-not-exist", "jp-to-en")).toBe(false);
  });

  it("generateForTerm falls back to another mode when one is unsupported", () => {
    const entry = byId.get("hihokensha") ?? BUILT_IN_VOCABULARY[0];
    const question = generator.generateForTerm(entry.id, ["fill-blank", "jp-to-en"], rngFor(3));
    expect(question).not.toBeNull();
    expect(question!.termId).toBe(entry.id);
  });
});
