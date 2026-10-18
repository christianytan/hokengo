import { describe, expect, it } from "vitest";
import { TrainerRepository, normalizeProgress, normalizeSettings } from "../src/lib/repository";
import { applyReview, createProgress } from "../src/lib/scheduler";
import { DEFAULT_SETTINGS } from "../src/types/progress";
import { BUILT_IN_VOCABULARY } from "../src/data";
import type { VocabularyEntry } from "../src/types/vocabulary";
import { MemoryBackend, STORES, type StorageBackend } from "../src/lib/db";

const T0 = new Date("2026-04-10T09:00:00.000Z");

function userEntry(id: string): VocabularyEntry {
  const base = BUILT_IN_VOCABULARY[0];
  return { ...base, id, term: "手動登録用語", kana: "てんこう", romaji: "tenkou", translation: "manually added term" };
}

async function openMemoryRepository() {
  const backend = new MemoryBackend();
  const repo = await TrainerRepository.open(backend);
  await repo.clearAll();
  return { backend, repo };
}

describe("repository normalisation", () => {
  it("ignores unknown settings and clamps out-of-range numbers", () => {
    const settings = normalizeSettings({
      theme: "gruvbox",
      showRomaji: "yes",
      sessionSize: 9999,
      dailyGoal: -5,
      enabledModes: ["jp-to-en", "telepathy", "jp-to-en"],
      futureField: 1,
    });
    expect(settings.theme).toBe(DEFAULT_SETTINGS.theme);
    expect(settings.showRomaji).toBe(true);
    expect(settings.sessionSize).toBe(50);
    expect(settings.dailyGoal).toBe(5);
    expect(settings.enabledModes).toEqual(["jp-to-en"]);
    expect((settings as Record<string, unknown>).futureField).toBeUndefined();
  });

  it("keeps valid settings", () => {
    const settings = normalizeSettings({
      theme: "dark",
      showKana: false,
      sessionSize: 15,
      dailyGoal: 40,
      enabledModes: ["context"],
    });
    expect(settings.theme).toBe("dark");
    expect(settings.showKana).toBe(false);
    expect(settings.sessionSize).toBe(15);
    expect(settings.enabledModes).toEqual(["context"]);
  });

  it("drops malformed progress and repairs partial records", () => {
    expect(normalizeProgress(null)).toBeNull();
    expect(normalizeProgress({ attempts: 3 })).toBeNull();
    const repaired = normalizeProgress({
      termId: "x",
      attempts: 4,
      easeFactor: 99,
      status: "banana",
      recentResults: [1, { at: "2026-01-01", correct: true, mode: "jp-to-en" }],
    });
    expect(repaired?.termId).toBe("x");
    expect(repaired?.easeFactor).toBe(3.0);
    expect(repaired?.status).toBe("new");
    expect(repaired?.recentResults.length).toBe(1);
  });

  it("adds the self-grading and read-aloud defaults to settings saved before them", () => {
    const settings = normalizeSettings({ theme: "dark", sessionSize: 10 });
    expect(settings.selfGrading).toBe(true);
    expect(settings.speechEnabled).toBe(true);
    expect(settings.speechAuto).toBe(false);
  });

  it("keeps the self-grading and read-aloud switches as the learner left them", () => {
    const settings = normalizeSettings({ selfGrading: false, speechEnabled: false, speechAuto: true });
    expect(settings.selfGrading).toBe(false);
    expect(settings.speechEnabled).toBe(false);
    expect(settings.speechAuto).toBe(true);
  });

  it("derives a grade for attempts recorded before self-grading existed", () => {
    const repaired = normalizeProgress({
      termId: "x",
      attempts: 2,
      recentResults: [
        { at: "2026-01-01T00:00:00.000Z", correct: true, mode: "jp-to-en" },
        { at: "2026-01-02T00:00:00.000Z", correct: false, mode: "context" },
      ],
    });
    expect(repaired?.recentResults.map((a) => a.grade)).toEqual(["good", "again"]);
  });

  it("keeps a stored grade and falls back for an unknown one", () => {
    const repaired = normalizeProgress({
      termId: "x",
      attempts: 2,
      recentResults: [
        { at: "2026-01-01T00:00:00.000Z", correct: true, mode: "jp-to-en", grade: "hard" },
        { at: "2026-01-02T00:00:00.000Z", correct: true, mode: "jp-to-en", grade: "telepathy" },
      ],
    });
    expect(repaired?.recentResults.map((a) => a.grade)).toEqual(["hard", "good"]);
  });
});

describe("repository persistence (memory backend)", () => {
  it("round-trips progress, bookmarks, user vocabulary, settings and activity", async () => {
    const { backend, repo } = await openMemoryRepository();
    expect(repo.kind).toBe("memory");

    const first = BUILT_IN_VOCABULARY[0].id;
    const second = BUILT_IN_VOCABULARY[1].id;
    await repo.saveProgress(applyReview(undefined, first, true, "jp-to-en", T0));
    await repo.saveProgress({ ...createProgress(second, T0), bookmarked: true });
    await repo.saveUserEntry(userEntry("my-term"));
    await repo.saveSettings({ ...DEFAULT_SETTINGS, theme: "dark", sessionSize: 20 });
    await repo.recordActivity("2026-04-10", { attempts: 1, correct: 1, newTerms: 1 });
    await repo.recordActivity("2026-04-10", { attempts: 1, correct: 0, newTerms: 0 });

    const reopened = await TrainerRepository.open(backend);
    const snapshot = await reopened.loadSnapshot();
    expect(snapshot.progress[first].attempts).toBe(1);
    expect(snapshot.progress[first].status).toBe("learning");
    expect(snapshot.progress[second].bookmarked).toBe(true);
    expect(snapshot.userVocabulary.map((e) => e.id)).toEqual(["my-term"]);
    expect(snapshot.userVocabulary[0].origin).toBe("user");
    expect(snapshot.settings.theme).toBe("dark");
    expect(snapshot.settings.sessionSize).toBe(20);
    expect(snapshot.activity["2026-04-10"]).toEqual({ date: "2026-04-10", attempts: 2, correct: 1, newTerms: 1 });
  });

  it("deletes progress and user entries", async () => {
    const { repo } = await openMemoryRepository();
    const id = BUILT_IN_VOCABULARY[0].id;
    await repo.saveProgress(createProgress(id, T0));
    await repo.saveUserEntry(userEntry("temp-term"));
    await repo.deleteProgress(id);
    await repo.deleteUserEntry("temp-term");
    const snapshot = await repo.loadSnapshot();
    expect(snapshot.progress[id]).toBeUndefined();
    expect(snapshot.userVocabulary).toEqual([]);
  });

  it("drops invalid user vocabulary on load instead of crashing", async () => {
    const backend = new MemoryBackend();
    await backend.put(STORES.userVocabulary, { id: "broken", term: "" });
    await backend.put(STORES.userVocabulary, userEntry("good-term"));
    const repo = await TrainerRepository.open(backend);
    const snapshot = await repo.loadSnapshot();
    expect(snapshot.userVocabulary.map((e) => e.id)).toEqual(["good-term"]);
  });

  it("replaceAll and clearAll reset stored state", async () => {
    const { repo } = await openMemoryRepository();
    await repo.saveProgress(createProgress(BUILT_IN_VOCABULARY[0].id, T0));
    await repo.replaceAll({
      progress: { other: createProgress("other", T0) },
      userVocabulary: [],
      settings: { ...DEFAULT_SETTINGS, dailyGoal: 30 },
      activity: {},
    });
    let snapshot = await repo.loadSnapshot();
    expect(Object.keys(snapshot.progress)).toEqual(["other"]);
    expect(snapshot.settings.dailyGoal).toBe(30);

    await repo.clearAll();
    snapshot = await repo.loadSnapshot();
    expect(snapshot.progress).toEqual({});
  });
});

describe("repository persistence (IndexedDB backend)", () => {
  it("writes and reads back through IndexedDB", async () => {
    const repo = await TrainerRepository.open();
    expect(repo.kind).toBe("indexeddb");
    await repo.clearAll();

    const id = BUILT_IN_VOCABULARY[2].id;
    await repo.saveProgress(applyReview(undefined, id, false, "context", T0));
    await repo.saveUserEntry(userEntry("idb-term"));
    await repo.saveSettings({ ...DEFAULT_SETTINGS, showRomaji: false });
    await repo.saveActivity({ date: "2026-04-11", attempts: 3, correct: 2, newTerms: 1 });

    const snapshot = await repo.loadSnapshot();
    expect(snapshot.progress[id].status).toBe("relearning");
    expect(snapshot.userVocabulary[0].id).toBe("idb-term");
    expect(snapshot.settings.showRomaji).toBe(false);
    expect(snapshot.activity["2026-04-11"].attempts).toBe(3);

    await repo.clearAll();
    const empty = await repo.loadSnapshot();
    expect(empty.progress).toEqual({});
    expect(empty.userVocabulary).toEqual([]);
    await repo.close();
  });

  it("falls back to memory when the backend fails", async () => {
    const broken: StorageBackend = {
      kind: "indexeddb",
      async getAll() {
        throw new Error("quota exceeded");
      },
      async get() {
        throw new Error("quota exceeded");
      },
      async put() {},
      async putMany() {},
      async remove() {},
      async clear() {},
      async close() {},
    };
    const repo = await TrainerRepository.open(broken);
    expect(repo.kind).toBe("memory");
    expect(repo.warning).toContain("quota exceeded");
    const snapshot = await repo.loadSnapshot();
    expect(snapshot.settings.theme).toBe(DEFAULT_SETTINGS.theme);
  });
});

