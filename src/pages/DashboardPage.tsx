import { useMemo } from "react";
import { CATEGORIES } from "../data/categories";
import { categoryBreakdown, dailySeries, weakTermRows, type StudySummary } from "../lib/stats";
import type { Nav } from "../App";
import type { StoreValue } from "../state/store";
import { Bar, Card, Stat, percent } from "../components/ui";

interface Props {
  store: StoreValue;
  summary: StudySummary;
  navigate: Nav;
}

export default function DashboardPage({ store, summary, navigate }: Props) {
  const categories = useMemo(() => categoryBreakdown(store.entries, store.progress), [store.entries, store.progress]);
  const weak = useMemo(() => weakTermRows(store.entries, store.progress, new Date(), 6), [store.entries, store.progress]);
  const days = useMemo(() => dailySeries(store.activity, 14), [store.activity]);
  const maxDay = Math.max(1, ...days.map((d) => d.attempts));
  const goalPct = Math.min(100, Math.round((summary.todayAttempts / Math.max(1, summary.dailyGoal)) * 100));

  return (
    <div className="page">
      <Card
        title="きょうの状況 / Today"
        subtitle={`Goal ${summary.dailyGoal} answers · ${summary.todayAttempts} done today · streak ${summary.streak} day(s)`}
        actions={
          <button className="btn primary" onClick={() => navigate("study", { kind: "mixed" })}>
            学習を始める / Study
          </button>
        }
      >
        <div className="stats">
          <Stat label="due for review now" value={summary.dueTerms} tone={summary.dueTerms ? "warn" : "good"} />
          <Stat label="weak terms" value={summary.weakTerms} tone={summary.weakTerms ? "bad" : ""} />
          <Stat label="never studied" value={summary.newTerms} />
          <Stat label="mastered" value={summary.masteredTerms} tone="good" />
          <Stat label="overall accuracy" value={percent(summary.accuracy)} hint={`${summary.totalAttempts} answers`} />
          <Stat label="bookmarked" value={summary.bookmarks} />
        </div>
        <div className="goal">
          <div className="bar big">
            <div className={`bar-fill ${goalPct >= 100 ? "good" : ""}`} style={{ width: `${goalPct}%` }} />
          </div>
          <span className="muted">
            daily goal {summary.todayAttempts}/{summary.dailyGoal} ({goalPct}%)
          </span>
        </div>
        <div className="row-actions">
          <button className="btn" onClick={() => navigate("study", { kind: "due" })} disabled={!summary.dueTerms}>
            復習 / review due ({summary.dueTerms})
          </button>
          <button className="btn" onClick={() => navigate("study", { kind: "weak" })} disabled={!summary.weakTerms}>
            苦手克服 / weak terms ({summary.weakTerms})
          </button>
          <button className="btn" onClick={() => navigate("study", { kind: "new" })} disabled={!summary.newTerms}>
            新規用語 / new terms ({summary.newTerms})
          </button>
          <button className="btn" onClick={() => navigate("study", { kind: "bookmarked" })} disabled={!summary.bookmarks}>
            ★ bookmarked ({summary.bookmarks})
          </button>
        </div>
      </Card>

      <div className="two-col">
        <Card title="カテゴリ別 / By category" subtitle="studied vs. total terms">
          <table className="table">
            <thead>
              <tr>
                <th>category</th>
                <th>seen</th>
                <th>due</th>
                <th>accuracy</th>
                <th>progress</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((row) => (
                <tr key={row.category}>
                  <td>
                    {CATEGORIES.find((c) => c.id === row.category)?.ja}
                    <span className="muted"> {row.label}</span>
                  </td>
                  <td>
                    {row.seen}/{row.total}
                  </td>
                  <td>{row.due}</td>
                  <td>{percent(row.accuracy)}</td>
                  <td className="barcell">
                    <Bar value={row.seen} max={row.total} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="最近の活動 / Last 14 days" subtitle="answers per day (green = correct share)">
          <div className="spark">
            {days.map((d) => (
              <div
                key={d.date}
                className="spark-col"
                title={`${d.date}: ${d.attempts} answers, ${d.correct} correct`}
              >
                <div className="spark-bar" style={{ height: `${(d.attempts / maxDay) * 100}%` }}>
                  <div
                    className="spark-correct"
                    style={{ height: `${d.attempts ? (d.correct / d.attempts) * 100 : 0}%` }}
                  />
                </div>
                <span className="spark-label">{d.date.slice(5)}</span>
              </div>
            ))}
          </div>
          <p className="muted">
            current streak: {summary.streak} day(s). All activity is stored locally on this device.
          </p>
        </Card>
      </div>

      <Card
        title="苦手な用語 / Terms to work on"
        subtitle="ranked by how overdue they are and how often they were missed"
        actions={
          <button className="btn" onClick={() => navigate("study", { kind: "weak" })}>
            practise these
          </button>
        }
      >
        {weak.length === 0 ? (
          <p className="muted">Nothing flagged yet — answer a few questions and weak terms will appear here.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>term</th>
                <th>meaning</th>
                <th>accuracy</th>
                <th>last seen</th>
                <th>next</th>
              </tr>
            </thead>
            <tbody>
              {weak.map(({ entry, progress, accuracy }) => (
                <tr key={entry.id}>
                  <td>
                    <button className="linklike" onClick={() => navigate("browser", { termId: entry.id })}>
                      {entry.term}
                    </button>
                  </td>
                  <td className="muted">{entry.translation}</td>
                  <td>{percent(accuracy)}</td>
                  <td className="muted">
                    {progress.lastReviewedAt ? new Date(progress.lastReviewedAt).toLocaleDateString() : "—"}
                  </td>
                  <td>{progress.dueAt && new Date(progress.dueAt) <= new Date() ? "now" : "scheduled"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

