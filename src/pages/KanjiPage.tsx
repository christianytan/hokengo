import { useEffect, useMemo, useRef, useState } from "react";
import { BUILT_IN_KANJI } from "../data/kanji";
import { KanjiGenerator } from "../lib/kanjiGenerator";
import { buildKanjiSession, NEW_KANJI_PER_TAKE, type KanjiSession } from "../lib/kanjiSession";
import { kanjiProgressId } from "../types/kanji";
import type { AnswerGrade } from "../types/progress";
import type { StoreValue } from "../state/store";
import { Card, Field, Stat, percent } from "../components/ui";

interface Props {
  store: StoreValue;
}

interface Result {
  kanjiId: string;
  correct: boolean;
  grade: AnswerGrade;
}

export default function KanjiPage({ store }: Props) {
  const generator = useMemo(() => new KanjiGenerator(BUILT_IN_KANJI), []);
  const [size, setSize] = useState(Math.max(8, store.settings.sessionSize));
  const [session, setSession] = useState<KanjiSession | null>(null);
  const [phase, setPhase] = useState<"setup" | "intro" | "quiz" | "summary">("setup");
  const [index, setIndex] = useState(0);
  const [chosen, setChosen] = useState<number | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const cardRef = useRef<HTMLDivElement>(null);

  const kanjiById = useMemo(() => new Map(BUILT_IN_KANJI.map((k) => [k.id, k])), []);
  const newKanji = session?.newKanjiIds.map((id) => kanjiById.get(id)).filter(Boolean) ?? [];

  const start = () => {
    const built = buildKanjiSession(BUILT_IN_KANJI, store.progress, generator, { size });
    setSession(built);
    setPhase("intro");
    setIndex(0);
    setChosen(null);
    setResults([]);
  };

  const startQuiz = () => {
    setPhase("quiz");
    setIndex(0);
    setChosen(null);
  };

  const answer = async (choiceIndex: number) => {
    if (!session || chosen !== null) return;
    const item = session.items[index];
    const correct = item.question.choices[choiceIndex].correct;
    const grade: AnswerGrade = correct ? "good" : "again";
    setChosen(choiceIndex);
    setResults((prev) => [...prev, { kanjiId: item.kanjiId, correct, grade }]);
    await store.answer(kanjiProgressId(item.kanjiId), grade, "kanji");
  };

  const next = () => {
    if (!session) return;
    if (index + 1 >= session.items.length) {
      setPhase("summary");
      return;
    }
    setIndex(index + 1);
    setChosen(null);
    setTimeout(() => cardRef.current?.focus(), 0);
  };

  useEffect(() => {
    if (phase !== "quiz" || !session) return;
    const item = session.items[index];
    if (!item) return;
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (chosen === null) {
        const choiceIndex = ["1", "2", "3", "4"].indexOf(event.key);
        if (choiceIndex >= 0 && choiceIndex < item.question.choices.length) {
          event.preventDefault();
          void answer(choiceIndex);
        }
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        next();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  useEffect(() => {
    if (phase !== "quiz") return;
    cardRef.current?.focus();
  }, [phase, index]);

  }, [phase, session, index, chosen, answer, next]);

  if (phase === "setup") {
    return (
      <div className="page">
        <Card
          title="漢字 focused / Kanji focused"
          subtitle={`Each take introduces ${NEW_KANJI_PER_TAKE} new kanji, then asks four-choice kanji recognition questions.`}
        >
          <div className="stats">
            <Stat label="kanji in the pack" value={BUILT_IN_KANJI.length} />
            <Stat
              label="studied kanji"
              value={BUILT_IN_KANJI.filter((k) => (store.progress[kanjiProgressId(k.id)]?.attempts ?? 0) > 0).length}
            />
            <Stat
              label="new kanji available"
              value={BUILT_IN_KANJI.filter((k) => (store.progress[kanjiProgressId(k.id)]?.attempts ?? 0) === 0).length}
            />
          </div>
          <div className="row-actions">
            <Field label="Session size">
              <select className="input" value={size} onChange={(e) => setSize(Number(e.target.value))}>
                {[8, 12, 16, 20, 30].map((n) => (
                  <option key={n} value={n}>
                    {n} questions
                  </option>
                ))}
              </select>
            </Field>
            <button className="btn primary" onClick={start} disabled={BUILT_IN_KANJI.length < 4}>
              はじめる / Start kanji take
            </button>
          </div>
          <p className="note">
            This mode is separate from the vocabulary quiz. It starts with two new kanji cards, then quizzes meaning,
            reading, and example completion with four kanji choices.
          </p>
        </Card>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="page">
        <Card title="漢字 focused / Kanji focused">
          <button className="btn primary" onClick={() => setPhase("setup")}>
            back to setup
          </button>
        </Card>
      </div>
    );
  }

  if (phase === "intro") {
    return (
      <div className="page kanji-intro">
        <Card
          title="漢字紹介 / New kanji introduction"
          subtitle={`These ${newKanji.length} kanji are new in this take. Read them, then start the quiz.`}
          actions={
            <button className="btn primary" onClick={startQuiz}>
              クイズを始める / start quiz
            </button>
          }
        >
          <div className="kanji-intro-grid">
            {newKanji.map((kanji) => (
              <article className="kanji-card" key={kanji!.id}>
                <div className="kanji-glyph">{kanji!.kanji}</div>
                <div className="kanji-meta">
                  <h3>{kanji!.reading}</h3>
                  <p>{kanji!.meaning}</p>
                  {kanji!.examples?.length && <p className="muted">examples: {kanji!.examples.join(" / ")}</p>}
                </div>
              </article>
            ))}
          </div>
        </Card>
      </div>
    );
  }

  if (phase === "quiz") {
    const item = session.items[index];
    if (!item) {
      setPhase("summary");
      return null;
    }
    const correctCount = results.filter((r) => r.correct).length;
    return (
      <div className="page study">
        <div className="study-progress">
          <div className="bar">
            <div className="bar-fill" style={{ width: `${(results.length / session.items.length) * 100}%` }} />
          </div>
          <span className="muted">
            {results.length} answered · {correctCount} correct · {session.items.length - results.length} left
          </span>
          <button className="ghost" onClick={() => setPhase("summary")}>
            end take
          </button>
        </div>

        <div
          className={`kanji-qcard ${chosen !== null ? (item.question.choices[chosen].correct ? "is-correct" : "is-wrong") : ""}`}
          ref={cardRef}
          tabIndex={-1}
          aria-label={`kanji question ${index + 1} of ${session.items.length}`}
        >
          <div className="qcard-head">
            <div className="qmeta">
              <span className="qmode">漢字 focused</span>
              <span className="qmode-en">{item.question.kind}</span>
              <span className="qpos">
                {index + 1} / {session.items.length}
              </span>
            </div>
          </div>
          <div className="prompt">
            <p className="prompt-ja">{item.question.prompt}</p>
            {item.question.promptDetail && <p className="prompt-detail">{item.question.promptDetail}</p>}
          </div>
          <div className="choices kanji-choices">
            {item.question.choices.map((choice, choiceIndex) => {
              const isChosen = chosen === choiceIndex;
              const classes = ["choice", "kanji-choice"];
              if (chosen !== null && choice.correct) classes.push("correct");
              if (chosen !== null && isChosen && !choice.correct) classes.push("wrong");
              if (chosen !== null && !isChosen && !choice.correct) classes.push("dim");
              return (
                <button
                  key={choice.key}
                  className={classes.join(" ")}
                  disabled={chosen !== null}
                  onClick={() => void answer(choiceIndex)}
                >
                  <span className="choice-key">{choiceIndex + 1}</span>
                  <span className="kanji-choice-body">
                    <span className="kanji-choice-glyph">{choice.text}</span>
                    {choice.subtext && <span className="choice-sub">{choice.subtext}</span>}
                  </span>
                </button>
              );
            })}
          </div>
          {chosen !== null && (
            <div className={`feedback ${item.question.choices[chosen].correct ? "good" : "bad"}`}>
              <div className="feedback-head">
                <strong>{item.question.choices[chosen].correct ? "正しい / Correct" : "ちがいます / Not quite"}</strong>
                <span className="feedback-answer">
                  correct answer: <b>{item.question.choices.find((c) => c.correct)!.text}</b>
                </span>
              </div>
              <p className="feedback-explain">{item.question.explanation}</p>
              <div className="feedback-foot">
                <button className="btn primary" onClick={next}>
                  {index + 1 >= session.items.length ? "結果を見る / see results" : "次へ / next"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  const correctCount = results.filter((r) => r.correct).length;
  const accuracy = results.length ? correctCount / results.length : null;
  return (
    <div className="page">
      <Card title="漢字 take complete / Kanji take complete" subtitle={`${results.length} answered`}>
        <div className="stats">
          <Stat label="correct" value={correctCount} tone={correctCount === results.length ? "good" : ""} />
          <Stat label="accuracy" value={percent(accuracy)} />
          <Stat label="new kanji introduced" value={session.newKanjiIds.length} />
        </div>
        <div className="row-actions">
          <button className="btn primary" onClick={start}>
            next take / つぎ
          </button>
          <button className="ghost" onClick={() => setPhase("setup")}>
            back to setup
          </button>
        </div>
      </Card>
    </div>
  );
}

