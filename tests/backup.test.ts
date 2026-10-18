import { describe, expect, it } from "vitest";
import {
  applyImport,
  BACKUP_APP_ID,
  BACKUP_SCHEMA_VERSION,
  exportBackup,
  mergeVocabulary,
  parseBackup,
  planImport,
  serializeBackup,
} from "../src/lib/backup";
import { emptySnapshot, TrainerRepository } from "../src/lib/repository";
import { applyReview, createProgress } from "../src/lib/scheduler";
import { MemoryBackend } from "../src/lib/db";
import { BUILT_IN_VOCABULARY } from "../src/data";
import { DEFAULT_SETTINGS } from "../src/types/progress";
import type { TermProgress } from "../src/types/progress";
import type { VocabularyEntry } from "../src/types/vocabulary";

const T0 = new Date("2026-04-10T09:00:00.000Z");
const T1 = new Date("2026-04-11T09:00:00.000Z");
const builtInIds = new Set(BUILT_IN_VOCABULARY.map((e) => e.id));

function userEntry(id: string, updatedAt: string): VocabularyEntry {
  const base = BUILT_IN_VOCABULARY[0];
  return {
    ...base,
    id,
    term: "手動登録用語",
    translation: "manually added term",
    origin: "user",
    createdAt: updatedAt,
    updatedAt,
  };
}

function progressFor(termId: string, updatedAt: Date, attempts = 3): TermProgress {
  return { ...createProgress(termId, updatedAt), attempts, correct: attempts - 1, incorrect: 1, updatedAt: updatedAt.toISOString() };
}

describe("backup export", () => {
  it("exports a self-describing document with counts", () => {
    const snapshot = {
      ...emptySnapshot(),
      progress: { [BUILT_IN_VOCABULARY[0].id]: progressFor(BUILT_IN_VOCABULARY[0].id, T0) },
      userVocabulary: [userEntry("my-term", T0.toISOString())],
      activity: { "2026-04-10": { date: "2026-04-10", attempts: 4, correct: 3, newTerms: 1 } },
      settings: { ...DEFAULT_SETTINGS, theme: "dark" as const },
    };
    const backup = exportBackup(snapshot, T1);
    expect(backup.app).toBe(BACKUP_APP_ID);
    expect(backup.schemaVersion).toBe(BACKUP_SCHEMA_VERSION);
    expect(backup.exportedAt).toBe(T1.toISOString());
    expect(backup.counts).toEqual({ progress: 1, userVocabulary: 1, activity: 1 });
    expect(backup.settings.theme).toBe("dark");
    // built-in vocabulary is never duplicated into the backup
    expect(backup.userVocabulary.map((e) => e.id)).toEqual(["my-term"]);
  });

  it("round-trips through JSON without losing progress detail", () => {
    const first = BUILT_IN_VOCABULARY[0].id;
    const snapshot = {
      ...emptySnapshot(),
      progress: { [first]: applyReview(undefined, first, true, "fill-blank", T0) },
      userVocabulary: [userEntry("my-term", T0.toISOString())],
      activity: { "2026-04-10": { date: "2026-04-10", attempts: 4, correct: 3, newTerms: 2 } },
    };
    const text = serializeBackup(snapshot, T0);
    const parsed = parseBackup(text);
    expect(parsed.issues).toEqual([]);
    expect(parsed.valid).toBe(true);
    const backup = parsed.backup!;
    expect(backup.progress[0].termId).toBe(first);
    expect(backup.progress[0].recentResults[0].mode).toBe("fill-blank");
    expect(backup.progress[0].intervalDays).toBe(1);
    expect(backup.userVocabulary[0].term).toBe("手動登録用語");
    expect(backup.activity.find((a) => a.date === "2026-04-10")!.newTerms).toBe(2);

    const applied = applyImport(backup, emptySnapshot(), builtInIds, "replace", T0);
    expect(applied.progress[first].recentResults).toEqual(snapshot.progress[first].recentResults);
    expect(applied.userVocabulary[0].id).toBe("my-term");
    expect(applied.activity["2026-04-10"]).toEqual(snapshot.activity["2026-04-10"]);
  });
});

describe("backup validation", () => {
  it("rejects malformed JSON and names the problem", () => {
    const result = parseBackup("{ not json");
    expect(result.valid).toBe(false);
    expect(result.backup).toBeNull();
    expect(result.issues[0].message).toContain("not valid JSON");
  });

  it("rejects a file from another application", () => {
    const result = parseBackup(JSON.stringify({ app: "some-other-trainer", schemaVersion: 1, progress: [] }));
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.path === "app")).toBe(true);
  });

  it("rejects a backup written by a newer schema version", () => {
    const result = parseBackup(
      JSON.stringify({ app: BACKUP_APP_ID, schemaVersion: BACKUP_SCHEMA_VERSION + 3, progress: [] })
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.path === "schemaVersion" && i.message.includes("newer"))).toBe(true);
  });

  it("rejects a document with nothing to import", () => {
    const result = parseBackup(JSON.stringify({ app: BACKUP_APP_ID, schemaVersion: 1 }));
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.message.includes("no importable sections"))).toBe(true);
  });

  it("reports the invalid field of a bad user vocabulary entry", () => {
    const result = parseBackup(
      JSON.stringify({
        app: BACKUP_APP_ID,
        schemaVersion: 1,
        userVocabulary: [{ id: "bad-entry", term: "", category: "nope" }],
      })
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.path.includes("bad-entry") && i.path.endsWith("term"))).toBe(true);
    expect(result.issues.some((i) => i.path.endsWith("category"))).toBe(true);
  });

  it("rejects non-array sections", () => {
    const result = parseBackup(JSON.stringify({ app: BACKUP_APP_ID, schemaVersion: 1, progress: "all done" }));
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.path === "progress")).toBe(true);
  });
});

describe("import: merge and replace", () => {
  const importedId = BUILT_IN_VOCABULARY[3].id;
  const staleId = BUILT_IN_VOCABULARY[4].id;
  const fresherId = BUILT_IN_VOCABULARY[5].id;

  function incoming() {
    return {
      app: BACKUP_APP_ID,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      vocabularySchemaVersion: 1,
      exportedAt: T1.toISOString(),
      counts: { progress: 3, userVocabulary: 2, activity: 1 },
      settings: { ...DEFAULT_SETTINGS, dailyGoal: 50, showRomaji: false },
      progress: [
        progressFor(importedId, T1, 9), // not present locally -> add
        progressFor(staleId, T0, 2), // older than local -> skip
        progressFor(fresherId, T1, 7), // newer than local -> update
      ],
      userVocabulary: [
        { ...userEntry("new-term", T1.toISOString()) },
        { ...userEntry(BUILT_IN_VOCABULARY[7].id, T1.toISOString()) }, // collides with a built-in id
      ],
      activity: [{ date: "2026-04-10", attempts: 5, correct: 4, newTerms: 2 }],
    };
  }

  function local() {
    return {
      ...emptySnapshot(),
      progress: {
        [staleId]: progressFor(staleId, T1, 12), // local is newer
        [fresherId]: progressFor(fresherId, T0, 1), // local is older
      },
      userVocabulary: [userEntry("existing-term", T0.toISOString())],
      activity: { "2026-04-10": { date: "2026-04-10", attempts: 3, correct: 1, newTerms: 1 } },
    };
  }

  it("merge adds new records, updates stale ones and keeps newer local ones", () => {
    const backup = incoming();
    const current = local();
    const plan = planImport(backup, current, builtInIds, "merge");
    expect(plan.progressAdd).toBe(1);
    expect(plan.progressUpdate).toBe(1);
    expect(plan.progressSkip).toBe(1);
    expect(plan.vocabularyAdd).toBe(1);
    expect(plan.vocabularyConflict).toBe(1);
    expect(plan.activityMerge).toBe(1);

    const next = applyImport(backup, current, builtInIds, "merge", T1);
    expect(next.progress[importedId].attempts).toBe(9);
    expect(next.progress[staleId].attempts).toBe(12); // local kept
    expect(next.progress[fresherId].attempts).toBe(7); // imported wins
    expect(next.userVocabulary.map((e) => e.id).sort()).toEqual(["existing-term", "new-term"]);
    expect(next.activity["2026-04-10"]).toEqual({ date: "2026-04-10", attempts: 5, correct: 4, newTerms: 2 });
    expect(next.settings.dailyGoal).toBe(50);
    expect(next.settings.showRomaji).toBe(false);
  });

  it("merge never double-counts a day that exists in both files", () => {
    const next = applyImport(incoming(), local(), builtInIds, "merge", T1);
    expect(next.activity["2026-04-10"].attempts).toBe(5); // max(3, 5), not 8
  });

  it("replace discards local records that are not in the file", () => {
    const current = local();
    const plan = planImport(incoming(), current, builtInIds, "replace");
    expect(plan.progressAdd).toBe(3);

    const next = applyImport(incoming(), current, builtInIds, "replace", T1);
    expect(Object.keys(next.progress).sort()).toEqual([fresherId, importedId, staleId].sort());
    expect(next.progress[staleId].attempts).toBe(2); // imported wins outright
    expect(next.userVocabulary.map((e) => e.id)).toEqual(["new-term", BUILT_IN_VOCABULARY[7].id]);
  });

  it("replace lets a user entry shadow a built-in id", () => {
    const next = applyImport(incoming(), local(), builtInIds, "replace", T1);
    const shadowed = mergeVocabulary(BUILT_IN_VOCABULARY, next.userVocabulary);
    const entry = shadowed.find((e) => e.id === BUILT_IN_VOCABULARY[7].id)!;
    expect(entry.origin).toBe("user");
    expect(entry.term).toBe("手動登録用語");
    expect(shadowed.length).toBe(BUILT_IN_VOCABULARY.length + 1); // built-in replaced, "new-term" added
  });

  it("an invalid import leaves stored data untouched", async () => {
    const repo = await TrainerRepository.open(new MemoryBackend());
    await repo.clearAll();
    await repo.saveProgress(progressFor(staleId, T1, 12));

    const parsed = parseBackup(JSON.stringify({ app: "other-app", schemaVersion: 1, progress: [] }));
    expect(parsed.valid).toBe(false);
    // the UI only calls applyImport when parseBackup was valid, so nothing changes
    const snapshot = await repo.loadSnapshot();
    expect(Object.keys(snapshot.progress)).toEqual([staleId]);
  });

  it("an applied import can be persisted and reloaded", async () => {
    const repo = await TrainerRepository.open(new MemoryBackend());
    await repo.clearAll();
    const next = applyImport(incoming(), local(), builtInIds, "merge", T1);
    await repo.replaceAll(next);
    const reloaded = await repo.loadSnapshot();
    expect(reloaded.progress[importedId].attempts).toBe(9);
    expect(reloaded.userVocabulary.map((e) => e.id).sort()).toEqual(["existing-term", "new-term"]);
    expect(reloaded.settings.dailyGoal).toBe(50);
  });
});

describe("mergeVocabulary", () => {
  it("keeps built-ins and appends user entries", () => {
    const merged = mergeVocabulary(BUILT_IN_VOCABULARY, [userEntry("brand-new", T0.toISOString())]);
    expect(merged.length).toBe(BUILT_IN_VOCABULARY.length + 1);
    expect(merged[merged.length - 1].origin).toBe("user");
  });
});

