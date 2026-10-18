import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import { BUILT_IN_VOCABULARY } from "../data";
import { TrainerRepository, emptySnapshot, type TrainerSnapshot } from "../lib/repository";
import {
  applyImport,
  mergeVocabulary,
  parseBackup,
  planImport,
  serializeBackup,
  type ImportMode,
  type ImportPlan,
} from "../lib/backup";
import { applyReview, createProgress, gradeFromCorrect, isCorrectGrade, isNewTerm } from "../lib/scheduler";
import { dateKey } from "../lib/time";
import {
  DEFAULT_SETTINGS,
  type AnswerGrade,
  type DailyActivity,
  type Settings,
  type TermProgress,
} from "../types/progress";
import type { QuestionMode, VocabularyEntry } from "../types/vocabulary";

type Status = "loading" | "ready" | "error";

interface State {
  status: Status;
  error: string | null;
  snapshot: TrainerSnapshot;
  storageKind: "indexeddb" | "memory";
  storageWarning: string | null;
}

type Action =
  | { type: "loading" }
  | { type: "loaded"; snapshot: TrainerSnapshot; kind: State["storageKind"]; warning: string | null }
  | { type: "error"; message: string }
  | { type: "patchProgress"; record: TermProgress }
  | { type: "dropProgress"; termId: string }
  | { type: "patchActivity"; record: DailyActivity }
  | { type: "patchUserEntry"; entry: VocabularyEntry }
  | { type: "dropUserEntry"; id: string }
  | { type: "settings"; settings: Settings };

const initialState: State = {
  status: "loading",
  error: null,
  snapshot: emptySnapshot(),
  storageKind: "memory",
  storageWarning: null,
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "loading":
      return { ...state, status: "loading", error: null };
    case "loaded":
      return {
        status: "ready",
        error: null,
        snapshot: action.snapshot,
        storageKind: action.kind,
        storageWarning: action.warning,
      };
    case "error":
      return { ...state, status: "error", error: action.message };
    case "patchProgress":
      return {
        ...state,
        snapshot: {
          ...state.snapshot,
          progress: { ...state.snapshot.progress, [action.record.termId]: action.record },
        },
      };
    case "dropProgress": {
      const next = { ...state.snapshot.progress };
      delete next[action.termId];
      return { ...state, snapshot: { ...state.snapshot, progress: next } };
    }
    case "patchActivity":
      return {
        ...state,
        snapshot: {
          ...state.snapshot,
          activity: { ...state.snapshot.activity, [action.record.date]: action.record },
        },
      };
    case "patchUserEntry": {
      const others = state.snapshot.userVocabulary.filter((e) => e.id !== action.entry.id);
      return { ...state, snapshot: { ...state.snapshot, userVocabulary: [...others, action.entry] } };
    }
    case "dropUserEntry":
      return {
        ...state,
        snapshot: {
          ...state.snapshot,
          userVocabulary: state.snapshot.userVocabulary.filter((e) => e.id !== action.id),
        },
      };
    case "settings":
      return { ...state, snapshot: { ...state.snapshot, settings: action.settings } };
    default:
      return state;
  }
}

export interface AnswerResult {
  progress: TermProgress;
  wasNew: boolean;
}

export interface FieldIssueLike {
  path: string;
  message: string;
}

export interface StoreValue {
  status: Status;
  error: string | null;
  storageKind: "indexeddb" | "memory";
  storageWarning: string | null;
  entries: VocabularyEntry[];
  userEntries: VocabularyEntry[];
  builtInIds: ReadonlySet<string>;
  progress: Record<string, TermProgress>;
  settings: Settings;
  activity: Record<string, DailyActivity>;
  entryById: (id: string) => VocabularyEntry | undefined;
  progressFor: (id: string) => TermProgress | undefined;
  /**
   * Record one answer. `grade` is the learner's self-assessment; a plain boolean
   * is still accepted for callers that do not ask for one.
   */
  answer: (termId: string, grade: AnswerGrade | boolean, mode: QuestionMode) => Promise<AnswerResult>;
  toggleBookmark: (termId: string) => Promise<void>;
  resetTerm: (termId: string) => Promise<void>;
  saveUserEntry: (entry: VocabularyEntry) => Promise<void>;
  deleteUserEntry: (id: string) => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  exportJson: () => string;
  previewImport: (text: string, mode: ImportMode) => { plan: ImportPlan | null; issues: FieldIssueLike[] };
  commitImport: (text: string, mode: ImportMode) => Promise<void>;
  resetEverything: () => Promise<void>;
  reload: () => Promise<void>;
}

const StoreContext = createContext<StoreValue | null>(null);

export const DEFAULTS = DEFAULT_SETTINGS;

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const repoRef = useRef<TrainerRepository | null>(null);
  const snapshotRef = useRef(state.snapshot);
  snapshotRef.current = state.snapshot;

  const load = useCallback(async () => {
    dispatch({ type: "loading" });
    try {
      const repo = await TrainerRepository.open();
      repoRef.current = repo;
      const snapshot = await repo.loadSnapshot();
      dispatch({ type: "loaded", snapshot, kind: repo.kind, warning: repo.warning });
    } catch (error) {
      dispatch({ type: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const entries = useMemo(
    () => mergeVocabulary(BUILT_IN_VOCABULARY, state.snapshot.userVocabulary),
    [state.snapshot.userVocabulary]
  );
  const builtInIds = useMemo(() => new Set(BUILT_IN_VOCABULARY.map((e) => e.id)), []);

  const entriesById = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);

  const answer = useCallback<StoreValue["answer"]>(async (termId, grade, mode) => {
    const normalized = typeof grade === "boolean" ? gradeFromCorrect(grade) : grade;
    const correct = isCorrectGrade(normalized);
    const current = snapshotRef.current.progress[termId];
    const wasNew = isNewTerm(current);
    const record = applyReview(current, termId, normalized, mode, new Date());
    dispatch({ type: "patchProgress", record });
    const repo = repoRef.current;
    if (!repo) return { progress: record, wasNew };
    await repo.saveProgress(record);
    const activity = await repo.recordActivity(dateKey(), {
      attempts: 1,
      correct: correct ? 1 : 0,
      newTerms: wasNew ? 1 : 0,
    });
    dispatch({ type: "patchActivity", record: activity });
    return { progress: record, wasNew };
  }, []);

  const toggleBookmark = useCallback<StoreValue["toggleBookmark"]>(async (termId) => {
    const current = snapshotRef.current.progress[termId] ?? createProgress(termId);
    const record = { ...current, bookmarked: !current.bookmarked, updatedAt: new Date().toISOString() };
    dispatch({ type: "patchProgress", record });
    await repoRef.current?.saveProgress(record);
  }, []);

  const resetTerm = useCallback<StoreValue["resetTerm"]>(async (termId) => {
    dispatch({ type: "dropProgress", termId });
    await repoRef.current?.deleteProgress(termId);
  }, []);

  const saveUserEntry = useCallback<StoreValue["saveUserEntry"]>(async (entry) => {
    const stored = { ...entry, origin: "user" as const, updatedAt: new Date().toISOString() };
    dispatch({ type: "patchUserEntry", entry: stored });
    await repoRef.current?.saveUserEntry(stored);
  }, []);

  const deleteUserEntry = useCallback<StoreValue["deleteUserEntry"]>(async (id) => {
    dispatch({ type: "dropUserEntry", id });
    await repoRef.current?.deleteUserEntry(id);
  }, []);

  const updateSettings = useCallback<StoreValue["updateSettings"]>(async (patch) => {
    const settings = { ...snapshotRef.current.settings, ...patch };
    dispatch({ type: "settings", settings });
    await repoRef.current?.saveSettings(settings);
  }, []);

  const exportJson = useCallback(() => serializeBackup(snapshotRef.current), []);

  const previewImport = useCallback<StoreValue["previewImport"]>(
    (text, mode) => {
      const parsed = parseBackup(text);
      if (!parsed.valid || !parsed.backup) return { plan: null, issues: parsed.issues };
      return { plan: planImport(parsed.backup, snapshotRef.current, builtInIds, mode), issues: [] };
    },
    [builtInIds]
  );

  const commitImport = useCallback<StoreValue["commitImport"]>(
    async (text, mode) => {
      const parsed = parseBackup(text);
      if (!parsed.valid || !parsed.backup) {
        throw new Error(parsed.issues[0]?.message ?? "The file could not be read.");
      }
      const next = applyImport(parsed.backup, snapshotRef.current, builtInIds, mode);
      const repo = repoRef.current;
      if (!repo) throw new Error("Storage is not ready yet.");
      await repo.replaceAll(next);
      const snapshot = await repo.loadSnapshot();
      dispatch({ type: "loaded", snapshot, kind: repo.kind, warning: repo.warning });
    },
    [builtInIds]
  );

  const resetEverything = useCallback(async () => {
    const repo = repoRef.current;
    if (repo) {
      await repo.clearAll();
      const snapshot = await repo.loadSnapshot();
      dispatch({ type: "loaded", snapshot, kind: repo.kind, warning: repo.warning });
    } else {
      dispatch({ type: "loaded", snapshot: emptySnapshot(), kind: "memory", warning: null });
    }
  }, []);

  const value: StoreValue = {
    status: state.status,
    error: state.error,
    storageKind: state.storageKind,
    storageWarning: state.storageWarning,
    entries,
    userEntries: state.snapshot.userVocabulary,
    builtInIds,
    progress: state.snapshot.progress,
    settings: state.snapshot.settings,
    activity: state.snapshot.activity,
    entryById: (id) => entriesById.get(id),
    progressFor: (id) => state.snapshot.progress[id],
    answer,
    toggleBookmark,
    resetTerm,
    saveUserEntry,
    deleteUserEntry,
    updateSettings,
    exportJson,
    previewImport,
    commitImport,
    resetEverything,
    reload: load,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const value = useContext(StoreContext);
  if (!value) throw new Error("useStore must be used inside <StoreProvider>");
  return value;
}

