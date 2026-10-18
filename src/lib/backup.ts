import {
  VOCABULARY_SCHEMA_VERSION,
  type VocabularyEntry,
  type VocabularyEntryInput,
} from "../types/vocabulary";
import { type DailyActivity, type Settings, type TermProgress } from "../types/progress";
import { validateVocabularyEntry, type FieldIssue } from "./schema";
import { emptySnapshot, normalizeActivity, normalizeProgress, normalizeSettings, type TrainerSnapshot } from "./repository";
import { isValidDateKey } from "./time";

/**
 * JSON backup / restore.
 *
 * A backup is a plain, human-readable JSON document. Importing is a two-step
 * operation: `parseBackup` validates the file, `planImport` describes what would
 * change, and only `applyImport` produces a new snapshot that the caller then
 * persists. An invalid file therefore never touches stored data.
 */

export const BACKUP_APP_ID = "japanese-insurance-terminology-trainer";
export const BACKUP_SCHEMA_VERSION = 1;
export const MIN_SUPPORTED_BACKUP_VERSION = 1;

export interface BackupFile {
  app: string;
  schemaVersion: number;
  vocabularySchemaVersion: number;
  exportedAt: string;
  counts: { progress: number; userVocabulary: number; activity: number };
  settings: Settings;
  progress: TermProgress[];
  userVocabulary: VocabularyEntryInput[];
  activity: DailyActivity[];
}

export interface ParsedBackup {
  valid: boolean;
  backup: BackupFile | null;
  issues: FieldIssue[];
}

export type ImportMode = "merge" | "replace";

export interface ImportPlan {
  mode: ImportMode;
  progressAdd: number;
  progressUpdate: number;
  progressSkip: number;
  vocabularyAdd: number;
  vocabularyUpdate: number;
  vocabularyConflict: number;
  activityAdd: number;
  activityMerge: number;
  settingsReplaced: boolean;
  invalidRecords: number;
}

export function exportBackup(snapshot: TrainerSnapshot, now: Date = new Date()): BackupFile {
  const progress = Object.values(snapshot.progress).sort((a, b) => a.termId.localeCompare(b.termId));
  const userVocabulary = snapshot.userVocabulary
    .map(({ origin: _origin, ...rest }) => rest as VocabularyEntryInput)
    .sort((a, b) => a.id.localeCompare(b.id));
  const activity = Object.values(snapshot.activity).sort((a, b) => a.date.localeCompare(b.date));
  return {
    app: BACKUP_APP_ID,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    vocabularySchemaVersion: VOCABULARY_SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    counts: { progress: progress.length, userVocabulary: userVocabulary.length, activity: activity.length },
    settings: snapshot.settings,
    progress,
    userVocabulary,
    activity,
  };
}

export function serializeBackup(snapshot: TrainerSnapshot, now: Date = new Date()): string {
  return JSON.stringify(exportBackup(snapshot, now), null, 2);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseBackup(text: string): ParsedBackup {
  const issues: FieldIssue[] = [];
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return {
      valid: false,
      backup: null,
      issues: [{ path: "", message: "not valid JSON: " + (error instanceof Error ? error.message : String(error)) }],
    };
  }

  if (!isPlainObject(raw)) {
    return { valid: false, backup: null, issues: [{ path: "", message: "top level must be a JSON object" }] };
  }

  if (raw.app !== BACKUP_APP_ID) {
    issues.push({ path: "app", message: `expected "${BACKUP_APP_ID}", got ${JSON.stringify(raw.app ?? null)}` });
  }
  if (typeof raw.schemaVersion !== "number") {
    issues.push({ path: "schemaVersion", message: "missing or not a number" });
  } else if (raw.schemaVersion > BACKUP_SCHEMA_VERSION) {
    issues.push({
      path: "schemaVersion",
      message: `created by a newer version of this app (schema v${raw.schemaVersion}); this app supports up to v${BACKUP_SCHEMA_VERSION}`,
    });
  } else if (raw.schemaVersion < MIN_SUPPORTED_BACKUP_VERSION) {
    issues.push({ path: "schemaVersion", message: `schema v${raw.schemaVersion} is no longer supported` });
  }

  const sections = ["progress", "userVocabulary", "activity", "settings"] as const;
  const hasAnySection = sections.some((s) => raw[s] !== undefined);
  if (!hasAnySection) {
    issues.push({ path: "", message: "no importable sections (progress / userVocabulary / activity / settings)" });
  }

  const progress: TermProgress[] = [];
  if (raw.progress === undefined || raw.progress === null) {
    progress.push();
  } else if (!Array.isArray(raw.progress)) {
    issues.push({ path: "progress", message: "must be an array" });
  } else {
    raw.progress.forEach((item, i) => {
      const record = normalizeProgress(item);
      if (record) progress.push(record);
      else issues.push({ path: `progress[${i}]`, message: "invalid progress record" });
    });
  }

  const userVocabulary: VocabularyEntryInput[] = [];
  if (raw.userVocabulary !== undefined && raw.userVocabulary !== null) {
    if (!Array.isArray(raw.userVocabulary)) {
      issues.push({ path: "userVocabulary", message: "must be an array" });
    } else {
      raw.userVocabulary.forEach((item, i) => {
        const result = validateVocabularyEntry(item);
        if (result.valid && result.entry) {
          const { origin: _origin, ...rest } = result.entry;
          userVocabulary.push(rest as VocabularyEntryInput);
        } else {
          const label = isPlainObject(item) && typeof item.id === "string" ? item.id : `#${i + 1}`;
          result.issues.slice(0, 10).forEach((iss) =>
            issues.push({ path: `userVocabulary[${label}]${iss.path ? "." + iss.path : ""}`, message: iss.message })
          );
        }
      });
    }
  }

  const activity: DailyActivity[] = [];
  if (raw.activity !== undefined && raw.activity !== null) {
    if (!Array.isArray(raw.activity)) {
      issues.push({ path: "activity", message: "must be an array" });
    } else {
      raw.activity.forEach((item, i) => {
        const record = normalizeActivity(item);
        if (record && isValidDateKey(record.date)) activity.push(record);
        else issues.push({ path: `activity[${i}]`, message: "invalid activity record" });
      });
    }
  }

  const settings = normalizeSettings(raw.settings);

  if (issues.length) return { valid: false, backup: null, issues };

  return {
    valid: true,
    backup: {
      app: BACKUP_APP_ID,
      schemaVersion: raw.schemaVersion as number,
      vocabularySchemaVersion: typeof raw.vocabularySchemaVersion === "number" ? raw.vocabularySchemaVersion : VOCABULARY_SCHEMA_VERSION,
      exportedAt: typeof raw.exportedAt === "string" ? raw.exportedAt : "",
      counts: { progress: progress.length, userVocabulary: userVocabulary.length, activity: activity.length },
      settings,
      progress,
      userVocabulary,
      activity,
    },
    issues: [],
  };
}

function newer(a: { updatedAt?: string | null } | undefined, b: { updatedAt?: string | null } | undefined): boolean {
  const at = (v?: string | null) => (typeof v === "string" && v ? new Date(v).getTime() : 0);
  return at(b?.updatedAt) > at(a?.updatedAt);
}

export function planImport(
  backup: BackupFile,
  current: TrainerSnapshot,
  builtInIds: ReadonlySet<string>,
  mode: ImportMode
): ImportPlan {
  const plan: ImportPlan = {
    mode,
    progressAdd: 0,
    progressUpdate: 0,
    progressSkip: 0,
    vocabularyAdd: 0,
    vocabularyUpdate: 0,
    vocabularyConflict: 0,
    activityAdd: 0,
    activityMerge: 0,
    settingsReplaced: true,
    invalidRecords: 0,
  };

  for (const record of backup.progress) {
    if (mode === "replace") {
      plan.progressAdd++;
      continue;
    }
    const existing = current.progress[record.termId];
    if (!existing) plan.progressAdd++;
    else if (newer(existing, record)) plan.progressUpdate++;
    else plan.progressSkip++;
  }

  for (const entry of backup.userVocabulary) {
    if (builtInIds.has(entry.id)) {
      plan.vocabularyConflict++;
      continue;
    }
    const existing = current.userVocabulary.find((e) => e.id === entry.id);
    if (!existing) plan.vocabularyAdd++;
    else if (newer(existing, entry)) plan.vocabularyUpdate++;
  }

  for (const record of backup.activity) {
    if (mode === "replace" || !current.activity[record.date]) plan.activityAdd++;
    else plan.activityMerge++;
  }

  return plan;
}

/** Produce the snapshot that should be stored after an import. */
export function applyImport(
  backup: BackupFile,
  current: TrainerSnapshot,
  builtInIds: ReadonlySet<string>,
  mode: ImportMode,
  now: Date = new Date()
): TrainerSnapshot {
  const next: TrainerSnapshot =
    mode === "replace"
      ? emptySnapshot()
      : {
          progress: { ...current.progress },
          userVocabulary: current.userVocabulary.slice(),
          settings: { ...current.settings },
          activity: { ...current.activity },
        };

  for (const record of backup.progress) {
    const existing = next.progress[record.termId];
    if (mode === "replace" || !existing || newer(existing, record)) {
      next.progress[record.termId] = { ...record };
    }
  }

  for (const entry of backup.userVocabulary) {
    if (mode === "merge" && builtInIds.has(entry.id)) continue; // built-in wins on merge
    const full = { ...entry, origin: "user" as const };
    const index = next.userVocabulary.findIndex((e) => e.id === entry.id);
    if (index >= 0) {
      if (mode === "replace" || newer(next.userVocabulary[index], entry)) next.userVocabulary[index] = full;
    } else {
      next.userVocabulary.push(full);
    }
  }

  for (const record of backup.activity) {
    const existing = next.activity[record.date];
    if (!existing) {
      next.activity[record.date] = { ...record };
    } else {
      // Never double-count a day that exists in both files.
      next.activity[record.date] = {
        date: record.date,
        attempts: Math.max(existing.attempts, record.attempts),
        correct: Math.max(existing.correct, record.correct),
        newTerms: Math.max(existing.newTerms, record.newTerms),
      };
    }
  }

  next.settings = { ...backup.settings };
  void now;
  return next;
}

/** Merge built-in and learner-created entries; user entries shadow built-in ids. */
export function mergeVocabulary(
  builtIn: readonly VocabularyEntry[],
  user: readonly VocabularyEntry[]
): VocabularyEntry[] {
  const userById = new Map(user.map((e) => [e.id, e]));
  return [...builtIn.filter((e) => !userById.has(e.id)), ...user.map((e) => ({ ...e, origin: "user" as const }))];
}
