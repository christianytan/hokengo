import { useEffect, useMemo, useRef, useState } from "react";
import { QuestionGenerator, QUESTION_MODES, type GeneratedQuestion } from "../lib/questionGenerator";
import { buildSession, EMPTY_FILTERS, type Session, type SessionFilters, type SessionKind } from "../lib/session";
import {
  ANSWER_GRADES,
  CATEGORIES,
  DIFFICULTY_LABELS,
  DOMAIN_LABELS,
  GRADE_LABELS,
  MODE_LABELS,
} from "../data/categories";
import { RELEARN_DELAY_MINUTES } from "../lib/scheduler";
import { cancelSpeech, speak } from "../lib/speech";
import type { QuestionMode, VocabularyEntry } from "../types/vocabulary";
import type { AnswerGrade, TermProgress } from "../types/progress";
import type { Nav, NavPayload } from "../App";
import type { StoreValue } from "../state/store";
import { Card, Chip, Field, Stat, percent } from "../components/ui";
import QuestionCard from "../components/QuestionCard";
import EntryDetail from "../components/EntryDetail";

interface Props {
  store: StoreValue;
  payload: NavPayload;
  navigate: Nav;
}

interface SessionResult {
  termId: string;
  correct: boolean;
  mode: QuestionMode;
  grade: AnswerGrade;
}

/**
 * An answer recorded in the local session but not yet written to storage. When
 * self-assessment is on the write waits for the grade: "right" and "right, but
 * it cost me something" must not both end up being recorded as "good".
 */
interface PendingAnswer {
  termId: string;
  mode: QuestionMode;
  grade: AnswerGrade;
}

const KINDS: { id: SessionKind; ja: string; en: string; hint: string }[] = [
  { id: "mixed", ja: "まぜがけ", en: "Mixed", hint: "new + due + weak, interleaved" },
  { id: "due", ja: "復習", en: "Due review", hint: "only terms scheduled now" },
  { id: "new", ja: "新規", en: "New terms", hint: "terms you have never seen" },
  { id: "weak", ja: "苦手", en: "Weak terms", hint: "missed or low-accuracy terms" },
  { id: "bookmarked", ja: "ブックマーク", en: "Bookmarked", hint: "terms you starred" },
  { id: "selected", ja: "選択した語彙", en: "Selected", hint: "terms picked in the browser" },
];

function scheduleNote(grade: AnswerGrade, progress: TermProgress): string {
  const ease = `ease ${progress.easeFactor.toFixed(2)}`;
  if (grade === "again") {
    return `requeued in ${RELEARN_DELAY_MINUTES} minutes · ease lowered to ${progress.easeFactor.toFixed(2)}`;
  }
  if (grade === "hard") return `next review in ${progress.intervalDays} day(s) — kept short because it was hard · ${ease}`;
  if (grade === "easy") return `next review in ${progress.intervalDays} day(s) — extended because it was easy · ${ease}`;
  return `next review in ${progress.intervalDays} day(s) · ${ease}`;
}

/**
 * What to read out when a question appears, or null when reading it would give
 * the answer away (空所補充) or speak English with a Japanese voice (英語 → 日本語).
 */
function autoReadText(question: GeneratedQuestion, term: VocabularyEntry): string | null {
  if (question.mode === "jp-to-en") return term.term;
  if (question.mode === "context") return question.prompt;
  return null;
}

export default function StudyPage({ store, payload, navigate }: Props) {
  const generator = useMemo(() => new QuestionGenerator(store.entries), [store.entries]);
  const [kind, setKind] = useState<SessionKind>(
    payload.kind ?? (payload.termIds?.length ? "selected" : "mixed")
  );
  const [filters, setFilters] = useState<SessionFilters>({ ...EMPTY_FILTERS, termIds: payload.termIds });
  const [modes, setModes] = useState<QuestionMode[]>(store.settings.enabledModes);
  const [size, setSize] = useState(store.settings.sessionSize);
  const [session, setSession] = useState<Session | null>(null);
  const [ended, setEnded] = useState(false);
  const [index, setIndex] = useState(0);
  const [chosen, setChosen] = useState<number | null>(null);
  const [results, setResults] = useState<SessionResult[]>([]);
  const [detail, setDetail] = useState<string | null>(null);
  const [lastSchedule, setLastSchedule] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAnswer | null>(null);
  const [gradedAs, setGradedAs] = useState<AnswerGrade | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [introduced, setIntroduced] = useState<Set<string>>(() => new Set());
  const cardRef = useRef<HTMLDivElement>(null);
  /**
   * Bumped whenever the learner moves to another question. Writing an answer to
   * storage is asynchronous, so a write started for question 3 can finish after
   * question 4 has already been answered; the guard below stops that late reply
   * from overwriting the feedback — or the pending grade — of the question now
   * on screen.
   */
  const generation = useRef(0);

  const toggleIn = <T,>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  const clearQuestionState = () => {
    generation.current += 1;
    setIndex(0);
    setChosen(null);
    setResults([]);
    setDetail(null);
    setLastSchedule(null);
    setPending(null);
    setGradedAs(null);
    setAnnouncement("");
    setIntroduced(new Set());
    cancelSpeech();
  };

  const start = () => {
    const built = buildSession(store.entries, store.progress, generator, { kind, filters, modes, size });
    setSession(built);
    setEnded(false);
    clearQuestionState();
  };

  /** Writes one graded answer to storage and reports the schedule it produced. */
  const commit = async (answer: PendingAnswer, grade: AnswerGrade, generationId = generation.current) => {
    const { progress } = await store.answer(answer.termId, grade, answer.mode);
    const note = scheduleNote(grade, progress);
    // The answer is stored whichever question it belongs to; only the feedback is
    // guarded, so a late reply cannot rewrite the question on screen now.
    if (generation.current !== generationId) return;
    setPending(null);
    setGradedAs(grade);
    setLastSchedule(note);
    setAnnouncement(`${GRADE_LABELS[grade].ja} — ${note}`);
  };

  /** Re-grades the pending answer: the last local result is corrected in place. */
  const pickGrade = (grade: AnswerGrade) => {
    if (!pending) return;
    const answer = pending;
    setPending(null);
    setGradedAs(grade);
    setResults((prev) => (prev.length ? [...prev.slice(0, -1), { ...prev[prev.length - 1], grade }] : prev));
    void commit(answer, grade, generation.current);
  };

  const answer = (choiceIndex: number) => {
    if (!session || chosen !== null) return;
    const item = session.items[index];
    const question = item.question!;
    const correct = question.choices[choiceIndex].correct;
    const implied: AnswerGrade = correct ? "good" : "again";
    setChosen(choiceIndex);
    setGradedAs(null);
    setLastSchedule(null);
    // Session progress and feedback are immediate; only the stored schedule waits
    // for the self-assessment when that step is switched on.
    setResults((prev) => [...prev, { termId: item.termId, correct, mode: question.mode, grade: implied }]);
    setAnnouncement(correct ? "正しい / correct" : "ちがいます / not quite");
    const immediate = !store.settings.selfGrading || !correct;
    if (immediate) {
      void commit({ termId: item.termId, mode: question.mode, grade: implied }, implied);
    } else {
      setPending({ termId: item.termId, mode: question.mode, grade: implied });
    }
  };

  const next = () => {
    if (!session) return;
    // Moving on without rating keeps the grade implied by the clicked option
    // rather than dropping the answer.
    if (pending) void commit(pending, pending.grade, generation.current);
    // Anything still in flight belongs to the question being left behind.
    generation.current += 1;
    cancelSpeech();
    if (index + 1 >= session.items.length) {
      setEnded(true);
      setPending(null);
      return;
    }
    setIndex(index + 1);
    setChosen(null);
    setLastSchedule(null);
    setPending(null);
    setGradedAs(null);
  };

  const item = session?.items[index];
  const term = item ? store.entryById(item.termId) : undefined;
  const question = item?.question ?? null;
  const termProgress = term ? store.progressFor(term.id) : undefined;
  const needsIntro =
    !!term &&
    store.settings.showTermIntroductions &&
    (!termProgress || termProgress.attempts === 0) &&
    !introduced.has(term.id);

  const startQuizForCurrentTerm = () => {
    if (!term) return;
    setIntroduced((prev) => new Set(prev).add(term.id));
  };

  // Keyboard control. 1–4 stay in the question card; navigation and the
  // self-assessment keys live here because they depend on the answer state.
  useEffect(() => {
    if (!session || ended) return;
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (needsIntro) {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          startQuizForCurrentTerm();
        } else if (event.key === "Escape") {
          event.preventDefault();
          startQuizForCurrentTerm();
          next();
        }
        return;
      }
      if (chosen === null) {
        if (event.key === "Escape") {
          event.preventDefault();
          next();
        }
        return;
      }
      if (pending) {
        const grade = ANSWER_GRADES.find((g) => GRADE_LABELS[g].key === event.key.toLowerCase());
        if (grade) {
          event.preventDefault();
          pickGrade(grade);
          return;
        }
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        next();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [session, ended, chosen, pending, index, needsIntro, startQuizForCurrentTerm]);

  // Move focus to the introduction or the new question so keyboard and
  // screen-reader users land on the current card.
  useEffect(() => {
    if (!session || ended || (!question && !needsIntro)) return;
    cardRef.current?.focus();
  }, [index, session, ended, question, needsIntro]);

  // Optional read-aloud of the prompt as a question appears.
  useEffect(() => {
    if (!session || ended || chosen !== null || !question || !term) return;
    if (!store.settings.speechEnabled || !store.settings.speechAuto) return;
    const text = autoReadText(question, term);
    if (text) speak(text);
  }, [index, question, term, chosen, session, ended, store.settings.speechEnabled, store.settings.speechAuto]);

  if (session && item && term) {
    const correctCount = results.filter((r) => r.correct).length;
    const finished = ended;

    if (!finished) {
      return (
        <div className="page study">
          <div className="study-progress">
            <div className="bar">
              <div
                className="bar-fill"
                style={{ width: `${(results.length / session.items.length) * 100}%` }}
              />
            </div>
            <span className="muted">
              {results.length} answered · {correctCount} correct · {session.items.length - results.length} left
            </span>
            <button className="ghost" onClick={() => setEnded(true)}>
              end session
            </button>
          </div>

          <p className="sr-only" role="status" aria-live="polite">
            {announcement}
          </p>

          {needsIntro ? (
            <div className="introduction-card" ref={cardRef} tabIndex={-1} aria-label={`term introduction for ${term.term}`}>
              <div className="intro-head">
                <div>
                  <span className="qmode">用語紹介 / term introduction</span>
                  <span className="qmode-en">read this before the quiz</span>
                </div>
                <span className="qpos">
                  {index + 1} / {session.items.length}
                </span>
              </div>
              <EntryDetail
                entry={term}
                progress={termProgress}
                settings={store.settings}
                onBookmark={() => void store.toggleBookmark(term.id)}
                compact
              />
              <div className="intro-actions">
                <button className="btn primary" onClick={startQuizForCurrentTerm}>
                  クイズを始める / quiz me
                </button>
                <button
                  className="ghost"
                  onClick={() => {
                    startQuizForCurrentTerm();
                    next();
                  }}
                >
                  この語をスキップ / skip this term
                </button>
              </div>
            </div>
          ) : (
            <QuestionCard
              question={item.question!}
              term={term}
              settings={store.settings}
              chosen={chosen}
              onAnswer={answer}
              onSkip={next}
              cardRef={cardRef}
              position={index + 1}
              total={session.items.length}
              bookmarked={!!termProgress?.bookmarked}
              onBookmark={() => void store.toggleBookmark(term.id)}
              status={termProgress?.status ?? "new"}
              onOpenTerm={() => setDetail(detail ? null : term.id)}
            />
          )}

          {chosen !== null && (
            <div className={`feedback ${item.question!.choices[chosen].correct ? "good" : "bad"}`}>
              <div className="feedback-head">
                <strong>{item.question!.choices[chosen].correct ? "正しい / Correct" : "ちがいます / Not quite"}</strong>
                <span className="feedback-answer">
                  correct answer: <b>{item.question!.choices.find((c) => c.correct)!.text}</b>
                </span>
                {lastSchedule && <span className="feedback-schedule">{lastSchedule}</span>}
              </div>

              {store.settings.selfGrading && (
                <div className="grades" role="group" aria-label="自己評価 / how well did you know it?">
                  {item.question!.choices[chosen].correct ? (
                    <>
                      <span className="grades-label">自己評価 / how well did you know it?</span>
                      <div className="grade-buttons">
                        {ANSWER_GRADES.map((g) => {
                          const meta = GRADE_LABELS[g];
                          const classes = ["grade", meta.tone];
                          if (gradedAs === g) classes.push("chosen");
                          if (pending?.grade === g) classes.push("default");
                          return (
                            <button
                              key={g}
                              type="button"
                              className={classes.join(" ")}
                              onClick={() => pickGrade(g)}
                              title={`${meta.ja} — ${meta.hint} (key ${meta.key.toUpperCase()})`}
                            >
                              <span className="grade-ja">{meta.ja}</span>
                              <span className="grade-en">{meta.en}</span>
                              <kbd>{meta.key.toUpperCase()}</kbd>
                            </button>
                          );
                        })}
                      </div>
                      <span className="grades-hint">
                        {pending
                          ? `Enter = ${GRADE_LABELS[pending.grade].ja} · A / H / G / E to choose another`
                          : `graded as ${gradedAs ? GRADE_LABELS[gradedAs].ja : ""} · Enter or Space → next`}
                      </span>
                    </>
                  ) : (
                    <p className="grades-note">
                      間違えた語は自動的に「もう一度」になります / a missed term goes straight back to the queue as
                      もう一度, so there is nothing to rate.
                    </p>
                  )}
                </div>
              )}

              <p className="feedback-explain">{item.question!.explanation}</p>

              {item.question!.distinctionNotes.length > 0 && (
                <ul className="distinctions">
                  {item.question!.distinctionNotes.map((note) => (
                    <li key={note.term}>
                      <b>
                        {note.term}
                        {note.reading ? ` (${note.reading})` : ""}
                      </b>
                      <span>{note.distinction}</span>
                    </li>
                  ))}
                </ul>
              )}

              {detail === term.id && (
                <EntryDetail
                  entry={term}
                  progress={store.progressFor(term.id)}
                  settings={store.settings}
                  onOpenTerm={(id) => setDetail(id)}
                  compact
                />
              )}

              <div className="feedback-foot">
                <button className="ghost" onClick={() => setDetail(detail ? null : term.id)}>
                  {detail ? "hide details" : "show full entry"}
                </button>
                <button className="btn primary" onClick={next}>
                  {index + 1 >= session.items.length ? "結果を見る / see results" : "次へ / next"}
                </button>
              </div>
            </div>
          )}
        </div>
      );
    }
  }

  if (session && ended) {
    const correctCount = results.filter((r) => r.correct).length;
    const missed = [...new Set(results.filter((r) => !r.correct).map((r) => r.termId))];
    const accuracy = results.length ? correctCount / results.length : null;
    return (
      <div className="page">
        <Card title="セッション完了 / Session complete" subtitle={`${session.kind} · ${results.length} answered`}>
          <div className="stats">
            <Stat label="correct" value={correctCount} tone={correctCount === results.length ? "good" : ""} />
            <Stat label="accuracy" value={percent(accuracy)} />
            <Stat label="missed" value={missed.length} tone={missed.length ? "bad" : "good"} />
          </div>
          {store.settings.selfGrading && (
            <div className="stats">
              {ANSWER_GRADES.map((g) => (
                <Stat
                  key={g}
                  label={`${GRADE_LABELS[g].ja} / ${g}`}
                  value={results.filter((r) => r.grade === g).length}
                  tone={GRADE_LABELS[g].tone}
                />
              ))}
            </div>
          )}
          <div className="row-actions">
            {missed.length > 0 && (
              <button
                className="btn primary"
                onClick={() => {
                  setKind("selected");
                  setFilters({ ...EMPTY_FILTERS, termIds: missed });
                  setSession(null);
                  setEnded(false);
                }}
              >
                practice the {missed.length} missed terms
              </button>
            )}
            <button className="btn" onClick={start}>
              run it again
            </button>
            <button className="ghost" onClick={() => { setSession(null); setEnded(false); }}>
              back to setup
            </button>
          </div>
          <ul className="missed">
            {missed.map((id) => {
              const entry = store.entryById(id);
              if (!entry) return null;
              return (
                <li key={id}>
                  <button className="linklike" onClick={() => navigate("browser", { termId: id })}>
                    {entry.term}
                  </button>
                  <span className="muted">{entry.translation}</span>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>
    );
  }

  return (
    <div className="page">
      <Card
        title="セッション設定 / Start a session"
        subtitle="Four options per question, exactly one correct answer. Terms that cannot produce four unambiguous options are skipped."
      >
        <div className="kind-grid">
          {KINDS.map((k) => (
            <button
              key={k.id}
              className={kind === k.id ? "kind active" : "kind"}
              onClick={() => setKind(k.id)}
              disabled={k.id === "selected" && !filters.termIds?.length}
            >
              <strong>{k.ja}</strong>
              <span>{k.en}</span>
              <small>{k.hint}</small>
            </button>
          ))}
        </div>

        {kind === "selected" && (
          <p className="note">
            {filters.termIds?.length ?? 0} terms selected.{" "}
            <button className="linklike" onClick={() => navigate("browser")}>
              choose terms in 用語一覧
            </button>
          </p>
        )}

        <div className="filter-grid">
          <Field label="Category / カテゴリ">
            <div className="chips">
              {CATEGORIES.map((c) => (
                <Chip
                  key={c.id}
                  active={filters.categories.includes(c.id)}
                  onClick={() => setFilters({ ...filters, categories: toggleIn(filters.categories, c.id) })}
                  title={c.descriptionEn}
                >
                  {c.ja}
                </Chip>
              ))}
            </div>
          </Field>

          <Field label="Domain / 分野">
            <div className="chips">
              {(Object.keys(DOMAIN_LABELS) as (keyof typeof DOMAIN_LABELS)[]).map((d) => (
                <Chip
                  key={d}
                  active={filters.domains.includes(d)}
                  onClick={() => setFilters({ ...filters, domains: toggleIn(filters.domains, d) })}
                >
                  {DOMAIN_LABELS[d].ja}
                </Chip>
              ))}
            </div>
          </Field>

          <Field label="Difficulty / 難易度">
            <div className="chips">
              {(Object.keys(DIFFICULTY_LABELS) as (keyof typeof DIFFICULTY_LABELS)[]).map((d) => (
                <Chip
                  key={d}
                  active={filters.difficulties.includes(d)}
                  onClick={() => setFilters({ ...filters, difficulties: toggleIn(filters.difficulties, d) })}
                >
                  {DIFFICULTY_LABELS[d].ja}
                </Chip>
              ))}
            </div>
          </Field>

          <Field label="Search / 検索" hint="matches terms, readings and definitions">
            <input
              className="input"
              value={filters.search}
              placeholder="例: 解約 / cancellation"
              onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            />
          </Field>
        </div>

        <Field label="Question modes / 出題形式" hint="at least one must stay enabled">
          <div className="chips">
            {QUESTION_MODES.map((m) => (
              <Chip
                key={m}
                active={modes.includes(m)}
                onClick={() => setModes(toggleIn(modes, m))}
                title={MODE_LABELS[m].hint}
              >
                {MODE_LABELS[m].ja}
              </Chip>
            ))}
          </div>
        </Field>

        <div className="row-actions">
          <Field label="Session size">
            <select className="input" value={size} onChange={(e) => setSize(Number(e.target.value))}>
              {[5, 10, 15, 20, 30].map((n) => (
                <option key={n} value={n}>
                  {n} questions
                </option>
              ))}
            </select>
          </Field>
          <button className="btn primary" onClick={start} disabled={modes.length === 0}>
            はじめる / Start
          </button>
        </div>

        {modes.length === 0 && <p className="note bad">Select at least one question mode.</p>}
      </Card>

      <Card title="出題モード / The five question modes">
        <ul className="mode-help">
          {QUESTION_MODES.map((m) => (
            <li key={m}>
              <strong>
                {MODE_LABELS[m].ja} <span className="muted">{MODE_LABELS[m].en}</span>
              </strong>
              <span>{MODE_LABELS[m].hint}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="キーボード / Keyboard shortcuts" subtitle="A whole session is doable without the mouse.">
        <ul className="mode-help">
          <li>
            <strong>
              1 – 4 <span className="muted">answer</span>
            </strong>
            <span>pick option 1 to 4</span>
          </li>
          <li>
            <strong>
              A / H / G / E <span className="muted">grade</span>
            </strong>
            <span>after a correct answer: もう一度 / 難しい / 正しい / 簡単</span>
          </li>
          <li>
            <strong>
              Enter or Space <span className="muted">next</span>
            </strong>
            <span>confirms the highlighted grade, then moves on to the next question</span>
          </li>
          <li>
            <strong>
              Esc <span className="muted">skip</span>
            </strong>
            <span>skip the current question without answering it</span>
          </li>
        </ul>
      </Card>
    </div>
  );
}



