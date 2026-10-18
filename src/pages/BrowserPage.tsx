import { useEffect, useMemo, useState } from "react";
import { CATEGORIES, DIFFICULTY_LABELS, DOMAIN_LABELS } from "../data/categories";
import { searchVocabulary } from "../lib/text";
import { isDue, isNewTerm, isWeakTerm } from "../lib/scheduler";
import type { CategoryId, Difficulty, Domain, VocabularyEntry } from "../types/vocabulary";
import type { LearningStatus } from "../types/progress";
import type { Nav, NavPayload } from "../App";
import type { StoreValue } from "../state/store";
import { Card, Chip, DifficultyPill, Empty, Field, StatusPill, percent } from "../components/ui";
import EntryDetail from "../components/EntryDetail";
import EntryEditor from "../components/EntryEditor";

interface Props {
  store: StoreValue;
  payload: NavPayload;
  navigate: Nav;
}

type StatusFilter = "all" | LearningStatus | "bookmarked" | "due" | "weak";
type OriginFilter = "all" | "builtin" | "user";
type SortKey = "term" | "difficulty" | "accuracy" | "due" | "updated";

const STATUS_FILTERS: { id: StatusFilter; ja: string }[] = [
  { id: "all", ja: "すべて" },
  { id: "new", ja: "未学習" },
  { id: "learning", ja: "学習中" },
  { id: "review", ja: "復習" },
  { id: "mastered", ja: "習得" },
  { id: "due", ja: "出番" },
  { id: "weak", ja: "苦手" },
  { id: "bookmarked", ja: "★" },
];

const PAGE_SIZE = 50;

export default function BrowserPage({ store, payload, navigate }: Props) {
  const [search, setSearch] = useState("");
  const [categories, setCategories] = useState<CategoryId[]>([]);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [difficulties, setDifficulties] = useState<Difficulty[]>([]);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [origin, setOrigin] = useState<OriginFilter>("all");
  const [sort, setSort] = useState<SortKey>("term");
  const [selected, setSelected] = useState<string[]>([]);
  const [openId, setOpenId] = useState<string | null>(payload.termId ?? null);
  const [editing, setEditing] = useState<{ entry: VocabularyEntry | null } | null>(null);
  const [page, setPage] = useState(0);

  const toggle = <T,>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  const rows = useMemo(() => {
    const now = new Date();
    let pool = store.entries.slice();
    if (search.trim()) pool = searchVocabulary(pool, search);
    if (categories.length) pool = pool.filter((e) => categories.includes(e.category));
    if (domains.length) pool = pool.filter((e) => e.domains.some((d) => domains.includes(d)));
    if (difficulties.length) pool = pool.filter((e) => difficulties.includes(e.difficulty));
    if (origin !== "all") pool = pool.filter((e) => (origin === "user" ? e.origin === "user" : e.origin !== "user"));
    if (status !== "all") {
      pool = pool.filter((e) => {
        const record = store.progress[e.id];
        if (status === "new") return isNewTerm(record);
        if (status === "due") return isDue(record, now);
        if (status === "bookmarked") return !!record?.bookmarked;
        if (status === "weak") return isWeakTerm(record, now);
        return record?.status === status;
      });
    }
    const accuracyOf = (entry: VocabularyEntry) => {
      const record = store.progress[entry.id];
      return record && record.attempts ? record.correct / record.attempts : -1;
    };
    const rank: Record<Difficulty, number> = { "n3-bridge": 0, "n2-bridge": 1, "insurance-specialist": 2 };
    pool.sort((a, b) => {
      if (sort === "difficulty") return rank[a.difficulty] - rank[b.difficulty] || a.term.localeCompare(b.term, "ja");
      if (sort === "accuracy") return accuracyOf(a) - accuracyOf(b);
      if (sort === "updated") return (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
      if (sort === "due") {
        const da = store.progress[a.id]?.dueAt ?? "0000";
        const db = store.progress[b.id]?.dueAt ?? "0000";
        return da.localeCompare(db);
      }
      return a.term.localeCompare(b.term, "ja");
    });
    return pool;
  }, [store.entries, store.progress, search, categories, domains, difficulties, status, origin, sort]);

  useEffect(() => {
    setPage(0);
  }, [search, categories, domains, difficulties, status, origin, sort, store.entries.length]);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pagedRows = rows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const openEntry = openId ? store.entryById(openId) : undefined;
  const editingEntry = editing?.entry ?? null;

  const practiceSelected = () => {
    navigate("study", { kind: "selected", termIds: selected });
  };

  return (
    <div className="page">
      <Card
        title="用語一覧 / Vocabulary"
        subtitle={`${rows.length} of ${store.entries.length} terms shown · ${store.userEntries.length} created by you`}
        actions={
          <div className="row-actions">
            <button className="btn" onClick={() => setEditing({ entry: null })}>
              ＋ 自分の用語を追加 / add your own term
            </button>
            <button className="btn primary" onClick={practiceSelected} disabled={!selected.length}>
              {selected.length ? `${selected.length} 語を学習 / practise selected` : "no terms selected"}
            </button>
          </div>
        }
      >
        <div className="filter-grid">
          <Field label="Search / 検索" hint="term, reading, romaji, translation, definitions, tags">
            <input
              className="input"
              value={search}
              placeholder="例: 告知 / disclosure"
              onChange={(e) => setSearch(e.target.value)}
            />
          </Field>
          <Field label="Sort">
            <select className="input" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
              <option value="term">term (五十音)</option>
              <option value="difficulty">difficulty</option>
              <option value="accuracy">weakest first</option>
              <option value="due">next review</option>
              <option value="updated">recently edited</option>
            </select>
          </Field>
          <Field label="Source">
            <div className="chips">
              {(["all", "builtin", "user"] as OriginFilter[]).map((o) => (
                <Chip key={o} active={origin === o} onClick={() => setOrigin(o)}>
                  {o === "all" ? "すべて" : o === "builtin" ? "built-in" : "my terms"}
                </Chip>
              ))}
            </div>
          </Field>
          <Field label="Status">
            <div className="chips">
              {STATUS_FILTERS.map((s) => (
                <Chip key={s.id} active={status === s.id} onClick={() => setStatus(s.id)}>
                  {s.ja}
                </Chip>
              ))}
            </div>
          </Field>
          <Field label="Category">
            <div className="chips">
              {CATEGORIES.map((c) => (
                <Chip
                  key={c.id}
                  active={categories.includes(c.id)}
                  onClick={() => setCategories(toggle(categories, c.id))}
                  title={c.descriptionEn}
                >
                  {c.ja}
                </Chip>
              ))}
            </div>
          </Field>
          <Field label="Domain">
            <div className="chips">
              {(Object.keys(DOMAIN_LABELS) as Domain[]).map((d) => (
                <Chip key={d} active={domains.includes(d)} onClick={() => setDomains(toggle(domains, d))}>
                  {DOMAIN_LABELS[d].ja}
                </Chip>
              ))}
            </div>
          </Field>
          <Field label="Difficulty">
            <div className="chips">
              {(Object.keys(DIFFICULTY_LABELS) as Difficulty[]).map((d) => (
                <Chip key={d} active={difficulties.includes(d)} onClick={() => setDifficulties(toggle(difficulties, d))}>
                  {DIFFICULTY_LABELS[d].ja}
                </Chip>
              ))}
            </div>
          </Field>
          <div className="chips">
            <button className="ghost" onClick={() => setSelected(pagedRows.map((r) => r.id))}>
              select this page
            </button>
            <button className="ghost" onClick={() => setSelected([])}>
              clear selection
            </button>
            <button
              className="ghost"
              onClick={() => {
                setSearch("");
                setCategories([]);
                setDomains([]);
                setDifficulties([]);
                setStatus("all");
                setOrigin("all");
              }}
            >
              reset filters
            </button>
          </div>
        </div>
      </Card>

      <Card title="一覧 / List">
        {rows.length === 0 ? (
          <Empty title="該当する用語がありません" hint="No term matches these filters — widen the search or reset the filters." />
        ) : (
          <table className="table terms">
            <thead>
              <tr>
                <th aria-label="select" />
                <th>term</th>
                <th>meaning</th>
                <th>category</th>
                <th>difficulty</th>
                <th>status</th>
                <th>accuracy</th>
                <th>next review</th>
                <th>★</th>
              </tr>
            </thead>
            <tbody>
              {pagedRows.map((entry) => {
                const record = store.progress[entry.id];
                const accuracy = record && record.attempts ? record.correct / record.attempts : null;
                const dueNow = isDue(record, new Date());
                return (
                  <tr key={entry.id} className={openId === entry.id ? "open" : ""}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.includes(entry.id)}
                        onChange={() => setSelected(toggle(selected, entry.id))}
                        aria-label={`select ${entry.term}`}
                      />
                    </td>
                    <td>
                      <button className="linklike term-link" onClick={() => setOpenId(entry.id)}>
                        {entry.term}
                      </button>
                      <span className="muted block">{entry.kana}</span>
                    </td>
                    <td>
                      {entry.translation}
                      <span className="muted block">{entry.explanationEn.slice(0, 90)}…</span>
                    </td>
                    <td className="muted">{CATEGORIES.find((c) => c.id === entry.category)?.ja}</td>
                    <td>
                      <DifficultyPill difficulty={entry.difficulty} />
                    </td>
                    <td>
                      <StatusPill status={record && record.attempts ? record.status : "new"} />
                      {entry.origin === "user" && <span className="pill info">mine</span>}
                    </td>
                    <td>{percent(accuracy)}</td>
                    <td className={dueNow ? "due" : "muted"}>
                      {record && record.attempts
                        ? dueNow
                          ? "now"
                          : record.dueAt
                            ? new Date(record.dueAt).toLocaleDateString()
                            : "—"
                        : "never"}
                    </td>
                    <td>
                      <button
                        className={`ghost icon ${record?.bookmarked ? "on" : ""}`}
                        onClick={() => void store.toggleBookmark(entry.id)}
                        title="bookmark this term"
                      >
                        {record?.bookmarked ? "★" : "☆"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {rows.length > PAGE_SIZE && (
          <div className="pager" role="navigation" aria-label="vocabulary pagination">
            <button className="ghost" onClick={() => setPage(Math.max(0, safePage - 1))} disabled={safePage === 0}>
              ← 前へ / previous
            </button>
            <span className="muted">
              page {safePage + 1} / {pageCount} · showing {safePage * PAGE_SIZE + 1}–
              {Math.min(rows.length, (safePage + 1) * PAGE_SIZE)} of {rows.length}
            </span>
            <button
              className="ghost"
              onClick={() => setPage(Math.min(pageCount - 1, safePage + 1))}
              disabled={safePage >= pageCount - 1}
            >
              次へ / next →
            </button>
          </div>
        )}
      </Card>

      {editing && (
        <EntryEditor
          existing={editingEntry}
          entries={store.entries}
          onSave={async (entry) => {
            await store.saveUserEntry(entry);
            setEditing(null);
            setOpenId(entry.id);
          }}
          onCancel={() => setEditing(null)}
        />
      )}

      {openEntry && !editing && (
        <Card
          title="詳細 / Entry"
          subtitle={openEntry.id}
          actions={
            <button className="ghost" onClick={() => setOpenId(null)}>
              close
            </button>
          }
        >
          <EntryDetail
            entry={openEntry}
            progress={store.progressFor(openEntry.id)}
            settings={store.settings}
            onBookmark={() => void store.toggleBookmark(openEntry.id)}
            onReset={() => void store.resetTerm(openEntry.id)}
            onEdit={() => setEditing({ entry: openEntry })}
            onDelete={() => {
              void store.deleteUserEntry(openEntry.id);
              setOpenId(null);
            }}
            onOpenTerm={(id) => setOpenId(id)}
          />
        </Card>
      )}
    </div>
  );
}



