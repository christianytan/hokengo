/** Local-date helpers. Everything in this app is local-time; there is no server. */

export function dateKey(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function isValidDateKey(key: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(key);
}

export function addDays(now: Date, days: number): Date {
  const copy = new Date(now.getTime());
  copy.setDate(copy.getDate() + days);
  return copy;
}

/** Ascending list of the last `n` local date keys, today included. */
export function lastNDays(n: number, now: Date = new Date()): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(dateKey(addDays(now, -i)));
  return out;
}

/** Consecutive days ending today with at least one attempt. */
export function currentStreak(activity: Record<string, { attempts: number }>, now: Date = new Date()): number {
  let streak = 0;
  for (let i = 0; ; i++) {
    const key = dateKey(addDays(now, -i));
    const record = activity[key];
    if (record && record.attempts > 0) streak++;
    else if (i === 0) continue; // today has no activity yet - the streak is not broken
    else break;
  }
  return streak;
}

/** Longest run of consecutive days (anywhere in the history) with at least one attempt. */
export function longestStreak(activity: Record<string, { attempts: number }>): number {
  const days = Object.keys(activity)
    .filter((key) => isValidDateKey(key) && (activity[key]?.attempts ?? 0) > 0)
    .sort();
  let best = 0;
  let run = 0;
  let previous: number | null = null;
  for (const key of days) {
    const [y, m, d] = key.split("-").map(Number);
    const serial = Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
    run = previous !== null && serial === previous + 1 ? run + 1 : 1;
    previous = serial;
    if (run > best) best = run;
  }
  return best;
}

export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} min`;
}
