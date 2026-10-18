import {
  DEFAULT_PROGRESS,
  type AnswerGrade,
  type AttemptRecord,
  type LearningStatus,
  type TermProgress,
} from "../types/progress";
import type { QuestionMode } from "../types/vocabulary";

/**
 * Spaced repetition scheduler (SM-2 inspired, deliberately simple and documented).
 *
 * Rules
 *  - ease factor starts at 2.5 and is clamped to [1.3, 3.0]
 *  - the learner's self-assessment (AnswerGrade) is what drives the schedule:
 *      again  -> SM-2 quality 1: reset the streak, interval 0, requeue in
 *                RELEARN_DELAY_MINUTES (10 minutes) so the term comes back
 *                inside the same study session
 *      hard   -> quality 3 (lowers ease) and the streak is kept, but the next gap
 *                is deliberately short: 1 day, then 2 days, then previous * 1.3
 *      good   -> quality 4, then 5 from the third repetition on (the historical
 *                behaviour, kept so existing schedules do not shift):
 *                  1st correct -> 1 day, 2nd -> 3 days,
 *                  3rd and later -> round(previous interval * ease)
 *      easy   -> quality 5 and a 30% longer gap than "good" would give
 *    All intervals are capped at MAX_INTERVAL_DAYS (180 days).
 *  - status: new -> learning -> review (>= 7 days) -> mastered (>= 21 days and >= 4 repetitions)
 *
 * A plain boolean is still accepted for callers (and stored backups) that predate
 * self-grading: true maps to "good", false maps to "again".
 *
 * Everything is local: no server, no clock synchronisation, no accounts.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;
export const RELEARN_DELAY_MINUTES = 10;
export const MIN_EASE = 1.3;
export const MAX_EASE = 3.0;
export const MAX_INTERVAL_DAYS = 180;
export const HISTORY_LIMIT = 20;
/** A "hard" answer never grows the gap by more than this factor. */
export const HARD_INTERVAL_FACTOR = 1.3;
/** An "easy" answer gets this multiplier on top of the normal interval. */
export const EASY_INTERVAL_BONUS = 1.3;

/** SM-2 quality for each self-assessment grade. */
export const GRADE_QUALITY: Record<AnswerGrade, number> = {
  again: 1,
  hard: 3,
  good: 4,
  easy: 5,
};

/** Backwards-compatible mapping for callers that still pass a boolean. */
export function gradeFromCorrect(correct: boolean): AnswerGrade {
  return correct ? "good" : "again";
}

/** Grades that count as a correct answer for statistics and streaks. */
export function isCorrectGrade(grade: AnswerGrade): boolean {
  return grade !== "again";
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export function createProgress(termId: string, now: Date = new Date()): TermProgress {
  return {
    termId,
    ...DEFAULT_PROGRESS,
    recentResults: [],
    updatedAt: now.toISOString(),
  };
}

export function accuracyOf(progress: TermProgress | undefined): number | null {
  if (!progress || progress.attempts === 0) return null;
  return progress.correct / progress.attempts;
}

/** SM-2 ease update. quality: 0..5 (we use 1 for wrong, 4/5 for correct). */
function nextEase(current: number, quality: number): number {
  const q = clamp(quality, 0, 5);
  const delta = 0.1 - (5 - q) * (0.08 + (5 - q) * 0.04);
  return clamp(current + delta, MIN_EASE, MAX_EASE);
}

function nextInterval(repetitions: number, previousInterval: number, ease: number, grade: AnswerGrade): number {
  const previous = Math.max(1, previousInterval);
  if (grade === "hard") {
    // A term that felt hard must come back sooner whatever the ease factor says,
    // but the streak is still worth keeping.
    if (repetitions <= 1) return 1;
    if (repetitions === 2) return 2;
    return Math.min(MAX_INTERVAL_DAYS, Math.max(1, Math.round(previous * Math.min(ease, HARD_INTERVAL_FACTOR))));
  }
  let interval: number;
  if (repetitions <= 1) interval = 1;
  else if (repetitions === 2) interval = 3;
  else interval = Math.max(1, Math.round(previous * ease));
  if (grade === "easy") {
    interval = Math.max(interval + 1, Math.round(interval * EASY_INTERVAL_BONUS));
  }
  return Math.min(MAX_INTERVAL_DAYS, interval);
}

function statusFor(intervalDays: number, repetitions: number): LearningStatus {
  if (intervalDays >= 21 && repetitions >= 4) return "mastered";
  if (intervalDays >= 7) return "review";
  return "learning";
}

/** Apply one answer to a term's progress and return the updated record. */
export function applyReview(
  current: TermProgress | undefined,
  termId: string,
  grade: AnswerGrade | boolean,
  mode: QuestionMode,
  now: Date = new Date()
): TermProgress {
  const normalized = typeof grade === "boolean" ? gradeFromCorrect(grade) : grade;
  const correct = isCorrectGrade(normalized);
  const base = current ? { ...current, recentResults: current.recentResults.slice() } : createProgress(termId, now);
  const nowIso = now.toISOString();

  const attempt: AttemptRecord = { at: nowIso, correct, mode, grade: normalized };
  base.recentResults = [...base.recentResults, attempt].slice(-HISTORY_LIMIT);
  base.attempts += 1;
  base.lastReviewedAt = nowIso;
  base.updatedAt = nowIso;

  if (correct) {
    base.correct += 1;
    base.repetitions += 1;
    base.maxStreak = Math.max(base.maxStreak, base.repetitions);
    // "good" keeps the historical quality ramp (4, then 5 from the third
    // repetition on) so schedules written before self-grading did not shift;
    // "hard" and "easy" move the ease in the direction the learner signalled.
    const quality =
      normalized === "hard"
        ? GRADE_QUALITY.hard
        : normalized === "easy"
          ? GRADE_QUALITY.easy
          : base.repetitions >= 3
            ? 5
            : GRADE_QUALITY.good;
    base.easeFactor = nextEase(base.easeFactor, quality);
    base.intervalDays = nextInterval(base.repetitions, base.intervalDays, base.easeFactor, normalized);
    base.dueAt = new Date(now.getTime() + base.intervalDays * DAY_MS).toISOString();
    base.status = statusFor(base.intervalDays, base.repetitions);
  } else {
    base.incorrect += 1;
    base.repetitions = 0;
    base.easeFactor = nextEase(base.easeFactor, GRADE_QUALITY.again);
    base.intervalDays = 0;
    base.dueAt = new Date(now.getTime() + RELEARN_DELAY_MINUTES * 60 * 1000).toISOString();
    base.status = "relearning";
  }

  return base;
}

export function isNewTerm(progress: TermProgress | undefined): boolean {
  return !progress || progress.attempts === 0;
}

/** True when a studied term is scheduled for review at or before `now`. */
export function isDue(progress: TermProgress | undefined, now: Date = new Date()): boolean {
  if (!progress || progress.attempts === 0 || !progress.dueAt) return false;
  return new Date(progress.dueAt).getTime() <= now.getTime();
}

export function daysUntilReview(progress: TermProgress, now: Date = new Date()): number | null {
  if (!progress.dueAt) return null;
  return (new Date(progress.dueAt).getTime() - now.getTime()) / DAY_MS;
}

/**
 * Weak-term priority. Higher = study sooner.
 * Combines: how overdue it is, recent wrong answers, recent "that was hard"
 * answers, overall accuracy and streak loss.
 */
export function weaknessScore(progress: TermProgress | undefined, now: Date = new Date()): number {
  if (!progress || progress.attempts === 0) return 0;
  const overdueDays = progress.dueAt
    ? Math.max(0, (now.getTime() - new Date(progress.dueAt).getTime()) / DAY_MS)
    : 0;
  const recent = progress.recentResults.slice(-5);
  const recentWrong = recent.filter((r) => !r.correct).length;
  const recentHard = recent.filter((r) => r.grade === "hard").length;
  const acc = accuracyOf(progress) ?? 0;
  return (
    overdueDays * 2 +
    recentWrong * 3 +
    recentHard * 1 +
    (1 - acc) * 4 +
    (progress.status === "relearning" ? 2 : 0)
  );
}

export function isWeakTerm(progress: TermProgress | undefined, now: Date = new Date()): boolean {
  if (!progress || progress.attempts === 0) return false;
  return weaknessScore(progress, now) > 0 && (progress.incorrect > 0 || isDue(progress, now));
}

export function resetProgress(termId: string, now: Date = new Date()): TermProgress {
  const fresh = createProgress(termId, now);
  return fresh;
}

export function isBookmarked(progress: TermProgress | undefined): boolean {
  return !!progress?.bookmarked;
}
