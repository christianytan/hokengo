import type { QuestionMode } from "./vocabulary";

export type LearningStatus = "new" | "learning" | "relearning" | "review" | "mastered";

/**
 * How the learner rated their own recall after answering.
 *
 * The option that was clicked decides `correct`; the grade is what the scheduler
 * actually uses, because "right, but it cost me something" and "right without
 * thinking about it" must not produce the same next interval.
 */
export type AnswerGrade = "again" | "hard" | "good" | "easy";

export interface AttemptRecord {
  at: string; // ISO timestamp
  correct: boolean;
  mode: QuestionMode;
  /** Absent on records written before self-grading existed. */
  grade?: AnswerGrade;
}

export interface TermProgress {
  termId: string;
  attempts: number;
  correct: number;
  incorrect: number;
  /** Consecutive correct answers (streak). */
  repetitions: number;
  maxStreak: number;
  lastReviewedAt: string | null;
  /** Current scheduled gap in days (0 = requeue same session). */
  intervalDays: number;
  /** SM-2 style ease factor, clamped to [1.3, 3.0]. */
  easeFactor: number;
  dueAt: string | null;
  status: LearningStatus;
  bookmarked: boolean;
  /** Capped history of the most recent attempts (newest last). */
  recentResults: AttemptRecord[];
  updatedAt: string;
}

export interface DailyActivity {
  /** Local date key, YYYY-MM-DD. */
  date: string;
  attempts: number;
  correct: number;
  newTerms: number;
}

export interface Settings {
  theme: "light" | "dark" | "system";
  showRomaji: boolean;
  showKana: boolean;
  showEnglishExamples: boolean;
  sessionSize: number;
  enabledModes: QuestionMode[];
  dailyGoal: number;
  /** Ask for a self-assessment (もう一度 / 難しい / 正しい / 簡単) after each answer. */
  selfGrading: boolean;
  /** Show the 再生 / read-aloud buttons, using the browser's own Japanese voice. */
  speechEnabled: boolean;
  /** Read the prompt aloud as soon as a question appears. */
  speechAuto: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  showRomaji: true,
  showKana: true,
  showEnglishExamples: true,
  sessionSize: 10,
  enabledModes: ["jp-to-en", "en-to-jp", "context", "fill-blank", "distinction"],
  dailyGoal: 20,
  selfGrading: true,
  speechEnabled: true,
  speechAuto: false,
};

export const DEFAULT_PROGRESS: Omit<TermProgress, "termId"> = {
  attempts: 0,
  correct: 0,
  incorrect: 0,
  repetitions: 0,
  maxStreak: 0,
  lastReviewedAt: null,
  intervalDays: 0,
  easeFactor: 2.5,
  dueAt: null,
  status: "new",
  bookmarked: false,
  recentResults: [],
  updatedAt: "",
};
