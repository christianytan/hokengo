import { describe, expect, it } from "vitest";
import { BUILT_IN_VOCABULARY, getBuiltInVocabulary } from "../src/data";
import { validateVocabularyEntry, validateVocabularyList } from "../src/lib/schema";
import { CATEGORY_IDS } from "../src/data/categories";

describe("built-in vocabulary", () => {
  it("loads the generated corpus without a fixed 1000-entry cap", () => {
    expect(BUILT_IN_VOCABULARY.length).toBeGreaterThanOrEqual(1000);
    expect(getBuiltInVocabulary()).toBe(BUILT_IN_VOCABULARY);
  });

  it("covers every category with at least 10 entries", () => {
    for (const category of CATEGORY_IDS) {
      const count = BUILT_IN_VOCABULARY.filter((e) => e.category === category).length;
      expect(count, `category ${category}`).toBeGreaterThanOrEqual(10);
    }
  });

  it("has unique ids and complete required fields", () => {
    const ids = new Set<string>();
    for (const entry of BUILT_IN_VOCABULARY) {
      expect(ids.has(entry.id), `duplicate id ${entry.id}`).toBe(false);
      ids.add(entry.id);
      const result = validateVocabularyEntry(entry);
      expect(result.issues, `${entry.id} invalid`).toEqual([]);
      expect(result.valid).toBe(true);
    }
  });

  it("every example sentence actually contains the term or a blank variant", () => {
    for (const entry of BUILT_IN_VOCABULARY) {
      const surfaces = [entry.term, ...(entry.blankVariants ?? [])];
      expect(surfaces.some((s) => entry.example.ja.includes(s)), entry.id).toBe(true);
    }
  });

  it("confused term cross-references resolve to real entries", () => {
    const ids = new Set(BUILT_IN_VOCABULARY.map((e) => e.id));
    for (const entry of BUILT_IN_VOCABULARY) {
      for (const c of entry.confusedTerms) {
        if (c.termId) expect(ids.has(c.termId), `${entry.id} -> ${c.termId}`).toBe(true);
      }
      for (const related of entry.relatedTerms ?? []) {
        expect(ids.has(related), `${entry.id} related -> ${related}`).toBe(true);
      }
    }
  });

  it("provides at least one distinction-capable pair per category", () => {
    for (const category of CATEGORY_IDS) {
      const pairs = BUILT_IN_VOCABULARY.filter(
        (e) => e.category === category && e.confusedTerms.some((c) => c.termId)
      );
      expect(pairs.length, `no confusable pairs in ${category}`).toBeGreaterThan(0);
    }
  });

  it("keeps the externally sourced terminology attributed", () => {
    // 共済 terminology comes from the JA共済用語集; the extra IT terminology
    // comes from the IPSJ list redistributed in code4fukui/ipsj-words.
    const kyosai = BUILT_IN_VOCABULARY.filter((e) => e.category === "kyosai");
    expect(kyosai.length).toBeGreaterThanOrEqual(10);
    const fromKyosaiGlossary = kyosai.filter(
      (e) => e.verification === "verified" && (e.sourceUrl ?? "").includes("ja-kyosai.or.jp")
    );
    expect(fromKyosaiGlossary.length).toBeGreaterThanOrEqual(10);

    const fromIpsj = BUILT_IN_VOCABULARY.filter((e) => (e.sourceUrl ?? "").includes("code4fukui/ipsj-words"));
    expect(fromIpsj.length).toBeGreaterThanOrEqual(10);
    // Headwords the IPSJ list publishes without a definition must say so.
    for (const entry of fromIpsj) {
      expect(entry.verificationNote, `${entry.id} needs a provenance note`).toBeTruthy();
    }
  });
});

describe("schema validation", () => {
  const validEntry = BUILT_IN_VOCABULARY[0];

  it("accepts a well-formed entry", () => {
    const result = validateVocabularyEntry(validEntry);
    expect(result.valid).toBe(true);
    expect(result.entry?.id).toBe(validEntry.id);
  });

  it("reports the missing field when a required field is absent", () => {
    const broken = { ...validEntry } as Record<string, unknown>;
    delete broken.explanationEn;
    delete broken.example;
    const result = validateVocabularyEntry(broken);
    expect(result.valid).toBe(false);
    const paths = result.issues.map((i) => i.path);
    expect(paths).toContain("explanationEn");
    expect(paths).toContain("example");
  });

  it("rejects unknown enum values and names the allowed ones", () => {
    const result = validateVocabularyEntry({ ...validEntry, category: "not-a-category" });
    expect(result.valid).toBe(false);
    const issue = result.issues.find((i) => i.path === "category");
    expect(issue?.message).toContain("allowed: contract-fundamentals");
  });

  it("rejects malformed ids and non-array confusedTerms", () => {
    const badId = validateVocabularyEntry({ ...validEntry, id: "Bad ID!" });
    expect(badId.issues.some((i) => i.path === "id")).toBe(true);
    const badConfused = validateVocabularyEntry({ ...validEntry, confusedTerms: "nope" });
    expect(badConfused.issues.some((i) => i.path === "confusedTerms")).toBe(true);
  });

  it("rejects blank text and non-string tags", () => {
    const result = validateVocabularyEntry({ ...validEntry, term: "   ", tags: ["ok", 3] });
    expect(result.issues.some((i) => i.path === "term")).toBe(true);
    expect(result.issues.some((i) => i.path === "tags")).toBe(true);
  });

  it("rejects duplicate ids inside one imported list", () => {
    const result = validateVocabularyList([validEntry, { ...validEntry }]);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.message.includes("duplicate"))).toBe(true);
    expect(result.entries.length).toBe(1);
  });

  it("keeps valid entries when a list also contains invalid ones", () => {
    const result = validateVocabularyList([validEntry, { id: "x" }]);
    expect(result.entries.length).toBe(1);
    expect(result.issues.length).toBeGreaterThan(0);
  });
});
