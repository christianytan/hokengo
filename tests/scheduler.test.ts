import { describe, expect, it } from "vitest";
import {
  applyReview,
  createProgress,
  accuracyOf,
  daysUntilReview,
  gradeFromCorrect,
  GRADE_QUALITY,
  isCorrectGrade,
  isDue,
  isNewTerm,
  isWeakTerm,
  MAX_EASE,
  MAX_INTERVAL_DAYS,
  MIN_EASE,
  RELEARN_DELAY_MINUTES,
  resetProgress,
  weaknessScore,
} from "../src/lib/scheduler";
import { DAY_MS } from "../src/lib/scheduler";

const T0 = new Date("2026-04-10T09:00:00.000Z");
const at = (iso: string | number) => new Date(iso);

function review(progress: ReturnType<typeof createProgress>, correct: boolean, atMs: Date) {
  return applyReview(progress, progress.termId, correct, "jp-to-en", atMs);
}

describe("spaced repetition scheduler", () => {
  it("starts a term as new with a neutral ease factor", () => {
    const p = createProgress("hoken-hiken", T0);
    expect(p.attempts).toBe(0);
    expect(p.status).toBe("new");
    expect(p.easeFactor).toBe(2.5);
    expect(p.dueAt).toBeNull();
    expect(isNewTerm(p)).toBe(true);
    expect(isDue(p, T0)).toBe(false);
    expect(accuracyOf(p)).toBeNull();
  });

  it("schedules 1 day, then 3 days, then an ease-scaled gap", () => {
    let p = createProgress("hoken-hiken", T0);
    p = review(p, true, T0);
    expect(p.intervalDays).toBe(1);
    expect(p.dueAt).toBe(at(T0.getTime() + DAY_MS).toISOString());
    expect(p.status).toBe("learning");
    expect(p.easeFactor).toBeCloseTo(2.48, 2);

    p = review(p, true, at(T0.getTime() + DAY_MS));
    expect(p.intervalDays).toBe(3);
    expect(p.status).toBe("learning");

    p = review(p, true, at(T0.getTime() + 3 * DAY_MS));
    expect(p.intervalDays).toBe(8); // round(3 * 2.56)
    expect(p.status).toBe("review");
  });

  it("marks a term mastered once the gap is long enough", () => {
    let p = createProgress("hoken-hiken", T0);
    let clock = T0;
    for (let i = 0; i < 4; i++) {
      p = review(p, true, clock);
      clock = new Date(new Date(p.dueAt!).getTime());
    }
    expect(p.repetitions).toBe(4);
    expect(p.intervalDays).toBeGreaterThanOrEqual(21);
    expect(p.status).toBe("mastered");
    expect(p.maxStreak).toBe(4);
    expect(accuracyOf(p)).toBe(1);
  });

  it("a wrong answer resets the streak and requeues the term in 10 minutes", () => {
    let p = createProgress("hoken-hiken", T0);
    p = review(p, true, T0);
    p = review(p, true, at(T0.getTime() + DAY_MS));
    expect(p.repetitions).toBe(2);

    const before = p.easeFactor;
    p = review(p, false, at(T0.getTime() + 2 * DAY_MS));
    expect(p.repetitions).toBe(0);
    expect(p.intervalDays).toBe(0);
    expect(p.status).toBe("relearning");
    expect(p.dueAt).toBe(at(T0.getTime() + 2 * DAY_MS + RELEARN_DELAY_MINUTES * 60_000).toISOString());
    expect(p.easeFactor).toBeLessThan(before);
    expect(isDue(p, at(T0.getTime() + 2 * DAY_MS + RELEARN_DELAY_MINUTES * 60_000))).toBe(true);
    expect(isDue(p, at(T0.getTime() + 2 * DAY_MS + 60_000))).toBe(false);
  });

  it("clamps the ease factor and caps the interval", () => {
    let p = createProgress("hoken-hiken", T0);
    let clock = T0;
    for (let i = 0; i < 30; i++) {
      p = review(p, true, clock);
      clock = new Date(p.dueAt!);
    }
    expect(p.easeFactor).toBeLessThanOrEqual(MAX_EASE);
    expect(p.intervalDays).toBeLessThanOrEqual(MAX_INTERVAL_DAYS);

    let q = createProgress("hoken-hiken", T0);
    for (let i = 0; i < 10; i++) q = review(q, false, T0);
    expect(q.easeFactor).toBeGreaterThanOrEqual(MIN_EASE);
    expect(q.status).toBe("relearning");
    expect(q.correct).toBe(0);
    expect(q.incorrect).toBe(10);
  });

  it("keeps only the most recent attempts", () => {
    let p = createProgress("hoken-hiken", T0);
    for (let i = 0; i < 40; i++) p = review(p, i % 3 !== 0, T0);
    expect(p.recentResults.length).toBeLessThanOrEqual(20);
    expect(p.attempts).toBe(40);
    expect(p.correct + p.incorrect).toBe(40);
    expect(accuracyOf(p)).toBeCloseTo(p.correct / 40, 5);
  });

  it("records the mode of every attempt", () => {
    let p = createProgress("hoken-hiken", T0);
    p = applyReview(p, p.termId, true, "fill-blank", T0);
    p = applyReview(p, p.termId, false, "distinction", T0);
    expect(p.recentResults.map((r) => r.mode)).toEqual(["fill-blank", "distinction"]);
  });

  it("treats an undefined record as a new term", () => {
    expect(isNewTerm(undefined)).toBe(true);
    expect(isDue(undefined, T0)).toBe(false);
    expect(weaknessScore(undefined, T0)).toBe(0);
    const created = applyReview(undefined, "hoken-hiken", true, "jp-to-en", T0);
    expect(created.termId).toBe("hoken-hiken");
    expect(created.attempts).toBe(1);
  });

  it("prioritises overdue and frequently-missed terms", () => {
    let overdue = createProgress("a", T0);
    overdue = review(overdue, true, T0);
    const later = at(T0.getTime() + 5 * DAY_MS);
    expect(isDue(overdue, later)).toBe(true);

    let fresh = createProgress("b", T0);
    fresh = review(fresh, true, later);
    expect(isDue(fresh, later)).toBe(false);

    expect(weaknessScore(overdue, later)).toBeGreaterThan(weaknessScore(fresh, later));
    expect(isWeakTerm(overdue, later)).toBe(true);

    let missed = createProgress("c", T0);
    missed = review(missed, true, T0);
    missed = review(missed, false, T0);
    missed = review(missed, false, T0);
    expect(weaknessScore(missed, T0)).toBeGreaterThan(weaknessScore(overdue, T0));
  });

  it("daysUntilReview and resetProgress behave as documented", () => {
    let p = createProgress("hoken-hiken", T0);
    expect(daysUntilReview(p, T0)).toBeNull();
    p = review(p, true, T0);
    expect(daysUntilReview(p, T0)).toBeCloseTo(1, 5);

    const reset = resetProgress("hoken-hiken", T0);
    expect(reset.attempts).toBe(0);
    expect(reset.status).toBe("new");
    expect(reset.easeFactor).toBe(2.5);
  });
});

describe("self-graded reviews (もう一度 / 難しい / 正しい / 簡単)", () => {
  /** Two successful reviews in: repetitions 2, a 3-day gap, neutral ease. */
  function twiceStudied() {
    let p = createProgress("hoken-hiken", T0);
    p = applyReview(p, "hoken-hiken", "good", "jp-to-en", T0);
    return applyReview(p, "hoken-hiken", "good", "jp-to-en", at(3 * DAY_MS));
  }

  it("maps each grade onto an SM-2 quality and a correct/incorrect flag", () => {
    expect(GRADE_QUALITY).toEqual({ again: 1, hard: 3, good: 4, easy: 5 });
    expect(gradeFromCorrect(true)).toBe("good");
    expect(gradeFromCorrect(false)).toBe("again");
    expect(isCorrectGrade("hard")).toBe(true);
    expect(isCorrectGrade("easy")).toBe(true);
    expect(isCorrectGrade("again")).toBe(false);
  });

  it("keeps the streak for 難しい but shortens the next gap", () => {
    const base = twiceStudied();
    const when = at(6 * DAY_MS);
    const hard = applyReview(base, "hoken-hiken", "hard", "jp-to-en", when);
    const good = applyReview(base, "hoken-hiken", "good", "jp-to-en", when);

    // The answer was right, so the streak and the accuracy still count.
    expect(hard.repetitions).toBe(3);
    expect(hard.correct).toBe(3);
    expect(hard.incorrect).toBe(0);
    // ...but a hard term comes back sooner and its ease drops.
    expect(hard.intervalDays).toBeLessThan(good.intervalDays);
    expect(hard.easeFactor).toBeLessThan(good.easeFactor);
    expect(hard.dueAt).toBe(new Date(when.getTime() + hard.intervalDays * DAY_MS).toISOString());
  });

  it("extends the gap further for 簡単", () => {
    const base = twiceStudied();
    const when = at(6 * DAY_MS);
    const good = applyReview(base, "hoken-hiken", "good", "jp-to-en", when);
    const easy = applyReview(base, "hoken-hiken", "easy", "jp-to-en", when);

    expect(easy.intervalDays).toBeGreaterThan(good.intervalDays);
    expect(easy.easeFactor).toBeGreaterThanOrEqual(good.easeFactor);
    expect(easy.status).toBe(good.status);
  });

  it("treats もう一度 on a clicked correct option as a miss", () => {
    const p = applyReview(undefined, "hoken-hiken", "again", "jp-to-en", T0);
    expect(p.correct).toBe(0);
    expect(p.repetitions).toBe(0);
    expect(p.intervalDays).toBe(0);
    expect(p.status).toBe("relearning");
    expect(p.easeFactor).toBeLessThan(2.5);
    // Back inside the same session rather than a day later.
    expect(p.dueAt).toBe(new Date(T0.getTime() + RELEARN_DELAY_MINUTES * 60_000).toISOString());
  });

  it("records the grade on the attempt so statistics can break results down", () => {
    const p = applyReview(undefined, "hoken-hiken", "easy", "context", T0);
    expect(p.recentResults[0]).toEqual({ at: T0.toISOString(), correct: true, mode: "context", grade: "easy" });
  });

  it("keeps a plain boolean call identical to good / again", () => {
    const base = twiceStudied();
    const when = at(6 * DAY_MS);
    expect(applyReview(base, "hoken-hiken", true, "jp-to-en", when)).toEqual(
      applyReview(base, "hoken-hiken", "good", "jp-to-en", when)
    );
    expect(applyReview(base, "hoken-hiken", false, "jp-to-en", when)).toEqual(
      applyReview(base, "hoken-hiken", "again", "jp-to-en", when)
    );
  });

  it("never lets a graded gap pass the cap", () => {
    let p = twiceStudied();
    for (let i = 0; i < 12; i++) p = applyReview(p, "hoken-hiken", "easy", "jp-to-en", at(p.dueAt ?? T0));
    expect(p.intervalDays).toBeLessThanOrEqual(MAX_INTERVAL_DAYS);
    expect(p.easeFactor).toBeLessThanOrEqual(MAX_EASE);
  });

  it("raises the priority of a term the learner keeps calling hard", () => {
    const when = at(6 * DAY_MS);
    const base = twiceStudied();
    const hard = applyReview(base, "hoken-hiken", "hard", "jp-to-en", when);
    const good = applyReview(base, "hoken-hiken", "good", "jp-to-en", when);
    // Same accuracy, same day: only the self-assessment differs.
    expect(weaknessScore(hard, when)).toBeGreaterThan(weaknessScore(good, when));
    // The hard term comes back first, and is due while the good one is not.
    const hardDue = new Date(hard.dueAt ?? when);
    expect(isWeakTerm(hard, hardDue)).toBe(true);
    expect(isDue(good, hardDue)).toBe(false);
  });
});
