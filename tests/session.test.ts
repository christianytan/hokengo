import { describe, expect, it } from "vitest";
import { buildSession, EMPTY_FILTERS, filterEntries } from "../src/lib/session";
import { QuestionGenerator, QUESTION_MODES } from "../src/lib/questionGenerator";
import { BUILT_IN_VOCABULARY } from "../src/data";
import { applyReview, createProgress } from "../src/lib/scheduler";
import { searchVocabulary } from "../src/lib/text";
import type { TermProgress } from "../src/types/progress";
import type { QuestionMode } from "../src/types/vocabulary";

const generator = new QuestionGenerator(BUILT_IN_VOCABULARY);
const T0 = new Date("2026-04-10T09:00:00.000Z");
const ALL_MODES: QuestionMode[] = [...QUESTION_MODES];

function options(overrides: Record<string, unknown> = {}) {
  return {
    kind: "mixed",
    filters: { ...EMPTY_FILTERS },
    modes: ALL_MODES,
    size: 10,
    seed: 1234,
    ...overrides,
  } as Parameters<typeof buildSession>[3];
}

function makeProgress(count: number, correct: number, wrong: number): Record<string, TermProgress> {
  const progress: Record<string, TermProgress> = {};
  for (const entry of BUILT_IN_VOCABULARY.slice(0, count)) {
    let record: TermProgress | undefined;
    let clock = T0;
    for (let i = 0; i < correct; i++) {
      record = applyReview(record, entry.id, true, "jp-to-en", clock);
      clock = new Date(record?.dueAt ?? clock.getTime());
    }
    for (let i = 0; i < wrong; i++) record = applyReview(record, entry.id, false, "jp-to-en", clock);
    if (record) progress[entry.id] = record;
  }
  return progress;
}

function assertValidItems(items: { question: ReturnType<QuestionGenerator["generate"]> }[]) {
  for (const item of items) {
    const q = item.question!;
    expect(q.choices).toHaveLength(4);
    expect(q.choices.filter((c) => c.correct)).toHaveLength(1);
  }
}

describe("session builder", () => {
  it("builds a full session of valid questions", () => {
    const session = buildSession(BUILT_IN_VOCABULARY, {}, generator, options());
    expect(session.items).toHaveLength(10);
    assertValidItems(session.items);
    expect(new Set(session.items.map((i) => i.question!.id)).size).toBe(session.items.length);
  });

  it("is reproducible from the seed and different for another seed", () => {
    const a = buildSession(BUILT_IN_VOCABULARY, {}, generator, options({ seed: 7 }));
    const b = buildSession(BUILT_IN_VOCABULARY, {}, generator, options({ seed: 7 }));
    const c = buildSession(BUILT_IN_VOCABULARY, {}, generator, options({ seed: 8 }));
    expect(a.items.map((i) => i.termId)).toEqual(b.items.map((i) => i.termId));
    expect(a.items.map((i) => i.termId)).not.toEqual(c.items.map((i) => i.termId));
  });

  it("restricts a session to the selected category", () => {
    const session = buildSession(BUILT_IN_VOCABULARY, {}, generator, {
      ...options(),
      filters: { ...EMPTY_FILTERS, categories: ["insurance-it"] },
    });
    expect(session.items.length).toBeGreaterThan(0);
    const byId = new Map(BUILT_IN_VOCABULARY.map((e) => [e.id, e]));
    for (const item of session.items) expect(byId.get(item.termId)!.category).toBe("insurance-it");
  });

  it("honours search, domain and difficulty filters", () => {
    const byId = new Map(BUILT_IN_VOCABULARY.map((e) => [e.id, e]));
    const searched = buildSession(BUILT_IN_VOCABULARY, {}, generator, {
      ...options(),
      filters: { ...EMPTY_FILTERS, search: "解約" },
    });
    const matching = new Set(searchVocabulary(BUILT_IN_VOCABULARY, "解約").map((e) => e.id));
    expect(matching.size).toBeGreaterThan(0);
    expect(searched.items.length).toBeGreaterThan(0);
    for (const item of searched.items) expect(matching.has(item.termId)).toBe(true);

    const difficult = buildSession(BUILT_IN_VOCABULARY, {}, generator, {
      ...options(),
      filters: { ...EMPTY_FILTERS, difficulties: ["n3-bridge"] },
    });
    for (const item of difficult.items) expect(byId.get(item.termId)!.difficulty).toBe("n3-bridge");

    const itDomain = buildSession(BUILT_IN_VOCABULARY, {}, generator, {
      ...options(),
      filters: { ...EMPTY_FILTERS, domains: ["it"] },
    });
    for (const item of itDomain.items) expect(byId.get(item.termId)!.domains).toContain("it");
  });

  it("practises an explicit selection of terms", () => {
    const selection = BUILT_IN_VOCABULARY.slice(0, 4).map((e) => e.id);
    const session = buildSession(BUILT_IN_VOCABULARY, {}, generator, {
      ...options({ size: 8, kind: "selected" }),
      filters: { ...EMPTY_FILTERS, termIds: selection },
    });
    expect(session.items).toHaveLength(8); // small pool repeats in other modes
    expect(new Set(session.items.map((i) => i.termId))).toEqual(new Set(selection));
    const pairs = session.items.map((i) => i.termId + "|" + i.question!.mode);
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it("new sessions only contain terms that were never studied", () => {
    const progress = makeProgress(20, 1, 0);
    const session = buildSession(BUILT_IN_VOCABULARY, progress, generator, options({ kind: "new" }));
    expect(session.items).toHaveLength(10);
    for (const item of session.items) expect(progress[item.termId]).toBeUndefined();
  });

  it("review sessions only contain due terms", () => {
    const progress = makeProgress(30, 1, 0);
    const later = new Date(T0.getTime() + 5 * 24 * 60 * 60 * 1000);
    const session = buildSession(BUILT_IN_VOCABULARY, progress, generator, options({ kind: "due", size: 5 }), later);
    expect(session.items).toHaveLength(5);
    for (const item of session.items) expect(progress[item.termId].dueAt).toBeTruthy();
  });

  it("weak-term sessions surface missed terms", () => {
    const progress = makeProgress(10, 1, 2);
    const session = buildSession(BUILT_IN_VOCABULARY, progress, generator, options({ kind: "weak", size: 5 }));
    expect(session.items.length).toBeGreaterThan(0);
    for (const item of session.items) expect(progress[item.termId].incorrect).toBeGreaterThan(0);
  });

  it("bookmarked sessions only use bookmarked terms", () => {
    const progress: Record<string, TermProgress> = {};
    for (const entry of BUILT_IN_VOCABULARY.slice(0, 6)) {
      progress[entry.id] = { ...createProgress(entry.id, T0), bookmarked: true };
    }
    const session = buildSession(BUILT_IN_VOCABULARY, progress, generator, options({ kind: "bookmarked", size: 6 }));
    expect(session.items).toHaveLength(6);
    for (const item of session.items) expect(progress[item.termId].bookmarked).toBe(true);
  });

  it("reports terms that cannot produce a question instead of padding with fake options", () => {
    const session = buildSession(BUILT_IN_VOCABULARY, {}, generator, options({ modes: [] }));
    expect(session.items).toHaveLength(0);
    expect(session.skipped.length).toBeGreaterThan(0);

    const singleMode = buildSession(BUILT_IN_VOCABULARY, {}, generator, options({ modes: ["distinction"], size: 5 }));
    expect(singleMode.items).toHaveLength(5);
    for (const item of singleMode.items) expect(item.question!.mode).toBe("distinction");
  });

  it("only uses modes the learner enabled", () => {
    const session = buildSession(BUILT_IN_VOCABULARY, {}, generator, options({ modes: ["jp-to-en", "en-to-jp"] }));
    expect(session.items).toHaveLength(10);
    for (const item of session.items) expect(["jp-to-en", "en-to-jp"]).toContain(item.question!.mode);
  });

  it("filterEntries is reusable by the browser UI", () => {
    const all = filterEntries(BUILT_IN_VOCABULARY, EMPTY_FILTERS);
    expect(all.length).toBe(BUILT_IN_VOCABULARY.length);
    const none = filterEntries(BUILT_IN_VOCABULARY, { ...EMPTY_FILTERS, search: "zzzz-no-such-term" });
    expect(none).toEqual([]);
  });
});

