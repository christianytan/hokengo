import {
  DEFAULT_PROGRESS,
  DEFAULT_SETTINGS,
  type AttemptRecord,
  type DailyActivity,
  type Settings,
  type TermProgress,
} from "../types/progress";
import type { VocabularyEntry } from "../types/vocabulary";
import { createBackend, MemoryBackend, STORES, type StorageBackend } from "./db";
import { validateVocabularyEntry } from "./schema";
import { createProgress, gradeFromCorrect, HISTORY_LIMIT } from "./scheduler";
import { dateKey, isValidDateKey } from "./time";

/**
 * Typed facade over the storage backend.
 *
 * Everything read from storage is treated as untrusted: records are normalised
 * before use so that a schema change or a hand-edited backup can never crash the
 * app. Unknown fields are dropped, missing fields fall back to defaults.
 */

export interface TrainerSnapshot {
  progress: Record<string, TermProgress>;
  userVocabulary: VocabularyEntry[];
  settings: Settings;
  activity: Record<string, DailyActivity>;
}

export function emptySnapshot(): TrainerSnapshot {
  return { progress: {}, userVocabulary: [], settings: { ...DEFAULT_SETTINGS, enabledModes: [...DEFAULT_SETTINGS.enabledModes] }, activity: {} };
}

const MODE_VALUES = ["jp-to-en", "en-to-jp", "context", "fill-blank", "distinction"] as const;
const GRADE_VALUES = ["again", "hard", "good", "easy"] as const;

/**
 * One stored attempt. Records written before self-grading existed have no
 * `grade`, so it is derived from the boolean they do have — that keeps old
 * backups importable without inventing information they never contained.
 */
function normalizeAttempt(raw: Record<string, unknown>): AttemptRecord {
  const mode = MODE_VALUES.includes(raw.mode as (typeof MODE_VALUES)[number])
    ? (raw.mode as (typeof MODE_VALUES)[number])
    : "jp-to-en";
  const correct = raw.correct === true;
  const grade = GRADE_VALUES.includes(raw.grade as (typeof GRADE_VALUES)[number])
    ? (raw.grade as (typeof GRADE_VALUES)[number])
    : typeof raw.correct === "boolean"
      ? gradeFromCorrect(correct)
      : undefined;
  return { at: String(raw.at), correct, mode, ...(grade ? { grade } : {}) };
}

export function normalizeSettings(raw: unknown): Settings {
  const base = { ...DEFAULT_SETTINGS, enabledModes: [...DEFAULT_SETTINGS.enabledModes] };
  if (!raw || typeof raw !== "object") return base;
  const value = raw as Record<string, unknown>;
  if (value.theme === "light" || value.theme === "dark" || value.theme === "system") base.theme = value.theme;
  for (const flag of [
    "showRomaji",
    "showKana",
    "showEnglishExamples",
    "selfGrading",
    "speechEnabled",
    "speechAuto",
  ] as const) {
    if (typeof value[flag] === "boolean") base[flag] = value[flag];
  }
  if (typeof value.sessionSize === "number" && Number.isFinite(value.sessionSize)) {
    base.sessionSize = Math.min(50, Math.max(5, Math.round(value.sessionSize)));
  }
  if (typeof value.dailyGoal === "number" && Number.isFinite(value.dailyGoal)) {
    base.dailyGoal = Math.min(500, Math.max(5, Math.round(value.dailyGoal)));
  }
  if (Array.isArray(value.enabledModes)) {
    const modes = value.enabledModes.filter((m): m is (typeof MODE_VALUES)[number] => MODE_VALUES.includes(m as never));
    if (modes.length > 0) base.enabledModes = [...new Set(modes)];
  }
  return base;
}

export function normalizeProgress(raw: unknown): TermProgress | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.termId !== "string" || !value.termId) return null;
  const num = (v: unknown, fallback: number): number =>
    typeof v === "number" && Number.isFinite(v) ? v : fallback;
  const status = value.status;
  const base = createProgress(value.termId);
  return {
    termId: value.termId,
    attempts: Math.max(0, Math.round(num(value.attempts, 0))),
    correct: Math.max(0, Math.round(num(value.correct, 0))),
    incorrect: Math.max(0, Math.round(num(value.incorrect, 0))),
    repetitions: Math.max(0, Math.round(num(value.repetitions, 0))),
    maxStreak: Math.max(0, Math.round(num(value.maxStreak, 0))),
    lastReviewedAt: typeof value.lastReviewedAt === "string" ? value.lastReviewedAt : null,
    intervalDays: Math.max(0, num(value.intervalDays, 0)),
    easeFactor: Math.min(3.0, Math.max(1.3, num(value.easeFactor, DEFAULT_PROGRESS.easeFactor))),
    dueAt: typeof value.dueAt === "string" ? value.dueAt : null,
    status:
      status === "new" || status === "learning" || status === "relearning" || status === "review" || status === "mastered"
        ? status
        : base.status,
    bookmarked: value.bookmarked === true,
    recentResults: Array.isArray(value.recentResults)
      ? value.recentResults
          .filter((r): r is Record<string, unknown> => !!r && typeof r === "object" && typeof (r as Record<string, unknown>).at === "string")
          .slice(-HISTORY_LIMIT)
          .map(normalizeAttempt)
      : [],
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : base.updatedAt,
  };
}

export function normalizeActivity(raw: unknown): DailyActivity | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.date !== "string" || !isValidDateKey(value.date)) return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0);
  return { date: value.date, attempts: num(value.attempts), correct: num(value.correct), newTerms: num(value.newTerms) };
}

export class TrainerRepository {
  private backend: StorageBackend;
  private storageKind: "indexeddb" | "memory" = "memory";
  private storageWarning: string | null = null;

  private constructor(backend: StorageBackend) {
    this.backend = backend;
  }

  /** Opens storage, falling back to memory when IndexedDB is unavailable or blocked. */
  static async open(preferred?: StorageBackend): Promise<TrainerRepository> {
    const repo = new TrainerRepository(createBackend(preferred));
    try {
      await repo.backend.getAll(STORES.settings);
      repo.storageKind = repo.backend.kind;
    } catch (error) {
      repo.storageWarning = error instanceof Error ? error.message : "Storage unavailable";
      repo.backend = new MemoryBackend();
      repo.storageKind = "memory";
    }
    return repo;
  }

  get kind(): "indexeddb" | "memory" {
    return this.storageKind;
  }

  get warning(): string | null {
    return this.storageWarning;
  }

  async loadSnapshot(): Promise<TrainerSnapshot> {
    const [progressRows, vocabularyRows, settingsRows, activityRows] = await Promise.all([
      this.backend.getAll<unknown>(STORES.progress),
      this.backend.getAll<unknown>(STORES.userVocabulary),
      this.backend.getAll<unknown>(STORES.settings),
      this.backend.getAll<unknown>(STORES.activity),
    ]);

    const snapshot = emptySnapshot();
    for (const row of progressRows) {
      const progress = normalizeProgress(row);
      if (progress) snapshot.progress[progress.termId] = progress;
    }
    for (const row of vocabularyRows) {
      const result = validateVocabularyEntry(row);
      if (result.valid && result.entry) snapshot.userVocabulary.push({ ...result.entry, origin: "user" });
    }
    if (settingsRows.length) snapshot.settings = normalizeSettings(settingsRows[settingsRows.length - 1]);
    for (const row of activityRows) {
      const activity = normalizeActivity(row);
      if (activity) snapshot.activity[activity.date] = activity;
    }
    return snapshot;
  }

  async saveProgress(progress: TermProgress): Promise<void> {
    await this.backend.put(STORES.progress, progress);
  }

  async saveProgressMany(records: Iterable<TermProgress>): Promise<void> {
    await this.backend.putMany(STORES.progress, [...records]);
  }

  async deleteProgress(termId: string): Promise<void> {
    await this.backend.remove(STORES.progress, termId);
  }

  async saveSettings(settings: Settings): Promise<void> {
    await this.backend.put(STORES.settings, { key: "settings", ...normalizeSettings(settings) });
  }

  async saveUserEntry(entry: VocabularyEntry): Promise<void> {
    await this.backend.put(STORES.userVocabulary, { ...entry, origin: "user" });
  }

  async deleteUserEntry(id: string): Promise<void> {
    await this.backend.remove(STORES.userVocabulary, id);
  }

  async saveActivity(record: DailyActivity): Promise<void> {
    await this.backend.put(STORES.activity, record);
  }

  /** Increment the counters for a local day; returns the updated record. */
  async recordActivity(
    day: string,
    delta: { attempts: number; correct: number; newTerms: number },
    existing?: DailyActivity
  ): Promise<DailyActivity> {
    const base: DailyActivity =
      existing ?? (await this.backend.get<DailyActivity>(STORES.activity, day)) ?? { date: day, attempts: 0, correct: 0, newTerms: 0 };
    const updated: DailyActivity = {
      date: day,
      attempts: base.attempts + delta.attempts,
      correct: base.correct + delta.correct,
      newTerms: base.newTerms + delta.newTerms,
    };
    await this.backend.put(STORES.activity, updated);
    return updated;
  }

  /** Replace every stored record - used by "replace" imports and by reset. */
  async replaceAll(snapshot: TrainerSnapshot): Promise<void> {
    await Promise.all([
      this.backend.clear(STORES.progress),
      this.backend.clear(STORES.userVocabulary),
      this.backend.clear(STORES.activity),
    ]);
    await this.backend.putMany(STORES.progress, Object.values(snapshot.progress));
    await this.backend.putMany(STORES.userVocabulary, snapshot.userVocabulary);
    await this.backend.putMany(STORES.activity, Object.values(snapshot.activity));
    await this.saveSettings(snapshot.settings);
  }

  async clearAll(): Promise<void> {
    for (const store of Object.values(STORES)) await this.backend.clear(store);
  }

  async close(): Promise<void> {
    await this.backend.close();
  }
}

export { dateKey };
