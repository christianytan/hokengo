import { useMemo } from "react";
import { CATEGORIES, DIFFICULTY_LABELS, DOMAIN_LABELS, MODE_LABELS } from "../data/categories";
import {
  categoryBreakdown,
  dailySeries,
  modeBreakdown,
  statusBreakdown,
  summarize,
  weakTermRows,
} from "../lib/stats";
import type { Nav } from "../App";
import type { StoreValue } from "../state/store";
import { Bar, Card, Stat, StatusPill, percent } from "../components/ui";

interface Props {
  store: StoreValue;
  navigate: Nav;
}

export default function StatisticsPage({ store, navigate }: Props) {
  const dailyGoal = store.settings.dailyGoal;
  const summary = useMemo(
    () => summarize(store.entries, store.progress, dailyGoal, store.activity),
    [store.entries, store.progress, dailyGoal, store.activity]
  );
  const statuses = useMemo(() => statusBreakdown(store.entries, store.progress), [store.entries, store.progress]);
  const modes = useMemo(() => modeBreakdown(store.progress), [store.progress]);
  const categories = useMemo(() => categoryBreakdown(store.entries, store.progress), [store.entries, store.progress]);
  const days = useMemo(() => dailySeries(store.activity, 30), [store.activity]);
  const maxDay = Math.max(1, ...days.map((d) => d.attempts));
  const weak = useMemo(
    () => weakTermRows(store.entries, store.progress, new Date(), 25),
    [store.entries, store.progress]
  );

  return (
    <div className="page">
      <Card
        title="全体 / Overall"
        subtitle={`${summary.totalTerms} terms in the pool · ${summary.totalAttempts} answers recorded`}
      >
        <div className="stats">
          <Stat label="seen at least once" value={summary.seenTerms} hint={`of ${summary.totalTerms}`} />
          <Stat label="learning" value={summary.learningTerms} />
          <Stat label="in review" value={summary.reviewTerms} />
          <Stat label="mastered" value={summary.masteredTerms} tone="good" />
          <Stat label="overall accuracy" value={percent(summary.accuracy)} />
          <Stat label="longest streak" value={`${summary.longestStreak}d`} hint={`current ${summary.streak}d`} />
        </div>
        <div className="stackbar">
          {statuses.map((s) =>
            s.count ? (
              <div
                key={s.status}
                className={`stack seg-${s.status}`}
                style={{ width: `${(s.count / Math.max(1, summary.totalTerms)) * 100}%` }}
                title={`${s.status}: ${s.count}`}
              >
                {s.count >= 6 ? s.count : ""}
              </div>
            ) : null
          )}
        </div>
        <div className="legend">
          {statuses.map((s) => (
            <span key={s.status}>
              <StatusPill status={s.status} /> {s.count}
            </span>
          ))}
        </div>
      </Card>

      <div className="two-col">
        <Card title="出題形式別 / By question mode" subtitle="which skill is weakest">
          <table className="table">
            <thead>
              <tr>
                <th>mode</th>
                <th>answers</th>
                <th>accuracy</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {modes.map((m) => (
                <tr key={m.mode}>
                  <td>
                    {MODE_LABELS[m.mode].ja}
                    <span className="muted"> {MODE_LABELS[m.mode].en}</span>
                  </td>
                  <td>{m.attempts}</td>
                  <td>{percent(m.accuracy)}</td>
                  <td className="barcell">
                    <Bar value={m.correct} max={Math.max(1, m.attempts)} tone={m.attempts === 0 ? "muted" : ""} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="30日間の活動 / Last 30 days">
          <div className="spark tall">
            {days.map((d) => (
              <div key={d.date} className="spark-col" title={`${d.date}: ${d.attempts} answers, ${d.correct} correct`}>
                <div className="spark-bar" style={{ height: `${(d.attempts / maxDay) * 100}%` }}>
                  <div
                    className="spark-correct"
                    style={{ height: `${d.attempts ? (d.correct / d.attempts) * 100 : 0}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <p className="muted">
            days with activity: {days.filter((d) => d.attempts > 0).length} · answers in window:{" "}
            {days.reduce((n, d) => n + d.attempts, 0)}
          </p>
        </Card>
      </div>

      <Card title="カテゴリ別 / By category">
        <table className="table">
          <thead>
            <tr>
              <th>category</th>
              <th>terms</th>
              <th>seen</th>
              <th>due</th>
              <th>weak</th>
              <th>mastered</th>
              <th>accuracy</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {categories.map((row) => (
              <tr key={row.category}>
                <td>
                  {CATEGORIES.find((c) => c.id === row.category)?.ja}
                  <span className="muted"> {row.label}</span>
                </td>
                <td>{row.total}</td>
                <td>{row.seen}</td>
                <td>{row.due}</td>
                <td>{row.weak}</td>
                <td>{row.mastered}</td>
                <td>{percent(row.accuracy)}</td>
                <td className="barcell">
                  <Bar value={row.seen} max={row.total} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card
        title="苦手な用語 / Flagged terms"
        subtitle="missed twice or more, or answered below 60% accuracy"
        actions={
          <button className="btn primary" onClick={() => navigate("study", { kind: "weak" })}>
            study these
          </button>
        }
      >
        {weak.length === 0 ? (
          <p className="muted">No terms are currently flagged as weak.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>term</th>
                <th>reading</th>
                <th>meaning</th>
                <th>difficulty</th>
                <th>ok</th>
                <th>ng</th>
                <th>accuracy</th>
                <th>status</th>
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
                  <td className="muted">{entry.kana}</td>
                  <td className="muted">{entry.translation}</td>
                  <td>{DIFFICULTY_LABELS[entry.difficulty].ja}</td>
                  <td>{progress.correct}</td>
                  <td>{progress.incorrect}</td>
                  <td>{percent(accuracy)}</td>
                  <td>
                    <StatusPill status={progress.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="分野別 / By domain" subtitle="insurance, IT, or both">
        <div className="chips">
          {(Object.keys(DOMAIN_LABELS) as (keyof typeof DOMAIN_LABELS)[]).map((d) => {
            const inDomain = store.entries.filter((e) => e.domains.includes(d));
            const seen = inDomain.filter((e) => (store.progress[e.id]?.attempts ?? 0) > 0).length;
            return (
              <span key={d} className="chip static">
                {DOMAIN_LABELS[d].ja} {DOMAIN_LABELS[d].en}: {seen}/{inDomain.length}
              </span>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

