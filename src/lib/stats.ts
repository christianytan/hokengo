import type { CategoryId, QuestionMode, VocabularyEntry } from "../types/vocabulary";
import type { DailyActivity, LearningStatus, TermProgress } from "../types/progress";
import { CATEGORIES } from "../data/categories";
import { accuracyOf, isDue, isNewTerm, isWeakTerm, weaknessScore } from "./scheduler";
import { currentStreak, dateKey, lastNDays, longestStreak } from "./time";

/** Aggregations for the dashboard and statistics screens. Read-only. */

export interface StudySummary {
  totalTerms: number;
  seenTerms: number;
  newTerms: number;
  dueTerms: number;
  weakTerms: number;
  learningTerms: number;
  reviewTerms: number;
  masteredTerms: number;
  bookmarks: number;
  totalAttempts: number;
  totalCorrect: number;
  accuracy: number | null;
  streak: number;
  longestStreak: number;
  todayAttempts: number;
  todayCorrect: number;
  dailyGoal: number;
}

/**
 * `dailyGoal` is passed as a number rather than as the whole settings object so
 * that changing the theme or the reading display does not recompute the
 * dashboard totals.
 */
export function summarize(
  entries: readonly VocabularyEntry[],
  progress: Record<string, TermProgress>,
  dailyGoal: number,
  activity: Record<string, DailyActivity>,
  now: Date = new Date()
): StudySummary {
  const summary: StudySummary = {
    totalTerms: entries.length,
    seenTerms: 0,
    newTerms: 0,
    dueTerms: 0,
    weakTerms: 0,
    learningTerms: 0,
    reviewTerms: 0,
    masteredTerms: 0,
    bookmarks: 0,
    totalAttempts: 0,
    totalCorrect: 0,
    accuracy: null,
    streak: currentStreak(activity, now),
    longestStreak: longestStreak(activity),
    todayAttempts: 0,
    todayCorrect: 0,
    dailyGoal,
  };

  for (const entry of entries) {
    const record = progress[entry.id];
    if (!record || record.attempts === 0) {
      summary.newTerms++;
      continue;
    }
    summary.seenTerms++;
    if (isDue(record, now)) summary.dueTerms++;
    if (isWeakTerm(record, now)) summary.weakTerms++;
    if (record.bookmarked) summary.bookmarks++;
    if (record.status === "learning") summary.learningTerms++;
    if (record.status === "review") summary.reviewTerms++;
    if (record.status === "mastered") summary.masteredTerms++;
    summary.totalAttempts += record.attempts;
    summary.totalCorrect += record.correct;
  }

  summary.accuracy = summary.totalAttempts ? summary.totalCorrect / summary.totalAttempts : null;

  const today = activity[dateKey(now)];
  if (today) {
    summary.todayAttempts = today.attempts;
    summary.todayCorrect = today.correct;
  }
  return summary;
}

export interface CategoryBreakdown {
  category: CategoryId;
  label: string;
  total: number;
  seen: number;
  due: number;
  weak: number;
  mastered: number;
  attempts: number;
  correct: number;
  accuracy: number | null;
}

export function categoryBreakdown(
  entries: readonly VocabularyEntry[],
  progress: Record<string, TermProgress>,
  now: Date = new Date()
): CategoryBreakdown[] {
  return CATEGORIES.map((meta) => {
    const inCategory = entries.filter((e) => e.category === meta.id);
    let seen = 0;
    let due = 0;
    let weak = 0;
    let mastered = 0;
    let attempts = 0;
    let correct = 0;
    for (const entry of inCategory) {
      const record = progress[entry.id];
      if (!record || record.attempts === 0) continue;
      seen++;
      if (isDue(record, now)) due++;
      if (isWeakTerm(record, now)) weak++;
      if (record.status === "mastered") mastered++;
      attempts += record.attempts;
      correct += record.correct;
    }
    return {
      category: meta.id,
      label: meta.en,
      total: inCategory.length,
      seen,
      due,
      weak,
      mastered,
      attempts,
      correct,
      accuracy: attempts ? correct / attempts : null,
    };
  });
}

export interface ModeBreakdown {
  mode: QuestionMode;
  attempts: number;
  correct: number;
  accuracy: number | null;
}

export function modeBreakdown(progress: Record<string, TermProgress>): ModeBreakdown[] {
  const totals = new Map<QuestionMode, { attempts: number; correct: number }>();
  for (const record of Object.values(progress)) {
    for (const attempt of record.recentResults) {
      const entry = totals.get(attempt.mode) ?? { attempts: 0, correct: 0 };
      entry.attempts++;
      if (attempt.correct) entry.correct++;
      totals.set(attempt.mode, entry);
    }
  }
  return [...totals.entries()]
    .map(([mode, t]) => ({ mode, attempts: t.attempts, correct: t.correct, accuracy: t.attempts ? t.correct / t.attempts : null }))
    .sort((a, b) => b.attempts - a.attempts);
}

export interface DailyPoint {
  date: string;
  attempts: number;
  correct: number;
}

export function dailySeries(activity: Record<string, DailyActivity>, days = 30, now: Date = new Date()): DailyPoint[] {
  return lastNDays(days, now).map((date) => {
    const record = activity[date];
    return { date, attempts: record?.attempts ?? 0, correct: record?.correct ?? 0 };
  });
}

export interface WeakTermRow {
  entry: VocabularyEntry;
  progress: TermProgress;
  score: number;
  accuracy: number | null;
}

export function weakTermRows(
  entries: readonly VocabularyEntry[],
  progress: Record<string, TermProgress>,
  now: Date = new Date(),
  limit = 20
): WeakTermRow[] {
  const rows: WeakTermRow[] = [];
  for (const entry of entries) {
    const record = progress[entry.id];
    if (!record || isNewTerm(record)) continue;
    const score = weaknessScore(record, now);
    if (score <= 0) continue;
    rows.push({ entry, progress: record, score, accuracy: accuracyOf(record) });
  }
  return rows.sort((a, b) => b.score - a.score).slice(0, limit);
}

export interface StatusCount {
  status: LearningStatus;
  count: number;
}

/** How many terms sit in each learning state, including terms never studied. */
export function statusBreakdown(
  entries: readonly VocabularyEntry[],
  progress: Record<string, TermProgress>
): StatusCount[] {
  const counts = new Map<LearningStatus, number>([
    ["new", 0],
    ["learning", 0],
    ["relearning", 0],
    ["review", 0],
    ["mastered", 0],
  ]);
  for (const entry of entries) {
    const record = progress[entry.id];
    const status = record && record.attempts > 0 ? record.status : "new";
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  return [...counts.entries()].map(([status, count]) => ({ status, count }));
}
