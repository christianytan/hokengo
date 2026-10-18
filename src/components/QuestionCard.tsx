import { useEffect, type Ref } from "react";
import type { GeneratedQuestion } from "../lib/questionGenerator";
import { MODE_LABELS } from "../data/categories";
import type { VocabularyEntry } from "../types/vocabulary";
import { StatusPill } from "./ui";
import SpeakButton from "./SpeakButton";
import type { LearningStatus, Settings } from "../types/progress";

interface Props {
  question: GeneratedQuestion;
  term: VocabularyEntry;
  settings: Settings;
  chosen: number | null;
  onAnswer: (index: number) => void;
  onSkip: () => void;
  position: number;
  total: number;
  bookmarked: boolean;
  onBookmark: () => void;
  status: LearningStatus;
  onOpenTerm: () => void;
  /** Attached to the card root so the page can move focus to a new question. */
  cardRef?: Ref<HTMLDivElement>;
}

function Sentence({ parts }: { parts: { text: string; match: boolean }[] }) {
  return (
    <p className="sentence">
      {parts.map((part, i) => (
        <span key={i} className={part.match ? "blank" : undefined}>
          {part.text}
        </span>
      ))}
    </p>
  );
}

export default function QuestionCard({
  question,
  term,
  settings,
  chosen,
  onAnswer,
  onSkip,
  position,
  total,
  bookmarked,
  onBookmark,
  status,
  onOpenTerm,
  cardRef,
}: Props) {
  const answered = chosen !== null;
  const mode = MODE_LABELS[question.mode];

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (!answered && ["1", "2", "3", "4"].includes(event.key)) {
        const index = Number(event.key) - 1;
        if (index < question.choices.length) onAnswer(index);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [answered, onAnswer, question.choices.length]);

  const revealReadings = answered || question.mode !== "fill-blank";

  return (
    <div
      ref={cardRef}
      tabIndex={-1}
      aria-label={`${mode.ja} ${mode.en} — question ${position} of ${total}`}
      className={`qcard ${answered ? (question.choices[chosen!].correct ? "is-correct" : "is-wrong") : ""}`}
    >
      <div className="qcard-head">
        <div className="qmeta">
          <span className="qmode">{mode.ja}</span>
          <span className="qmode-en">{mode.en}</span>
          <span className="qpos">
            {position} / {total}
          </span>
        </div>
        <div className="qcard-head-right">
          <StatusPill status={status} />
          <button
            className={`ghost icon ${bookmarked ? "on" : ""}`}
            onClick={onBookmark}
            title="Bookmark this term"
            aria-label={bookmarked ? "ブックマークを外す / remove bookmark" : "ブックマークする / add bookmark"}
            aria-pressed={bookmarked}
          >
            {bookmarked ? "★ bookmarked" : "☆ bookmark"}
          </button>
          <button
            className="ghost icon"
            onClick={onOpenTerm}
            aria-label="この語の詳細 / open the full entry for this term"
          >
            詳細 / details
          </button>
        </div>
      </div>

      <div className="prompt">
        {question.mode === "jp-to-en" && (
          <>
            <p className="term-ja">
              {term.term}
              {settings.speechEnabled && (
                <SpeakButton text={term.term} label={`${term.term} を読む / read the term`} short="🔊 再生" />
              )}
            </p>
            {settings.showKana && <p className="term-kana">{term.kana}</p>}
            {settings.showRomaji && <p className="term-romaji">{term.romaji}</p>}
            <p className="prompt-ask">What is the English meaning?</p>
          </>
        )}
        {question.mode === "en-to-jp" && (
          <>
            <p className="prompt-en">{question.prompt}</p>
            {question.promptDetailEn && <p className="prompt-detail">{question.promptDetailEn}</p>}
            <p className="prompt-ask">Which Japanese term is described?</p>
          </>
        )}
        {question.mode === "context" && (
          <>
            <Sentence parts={question.sentenceParts ?? [{ text: question.prompt, match: false }]} />
            {settings.speechEnabled && (
              <SpeakButton text={term.example.ja} label="例文を読む / read the example sentence" short="🔊 例文" />
            )}
            {revealReadings && settings.showKana && <p className="term-kana">{question.sentenceKana}</p>}
            {revealReadings && settings.showRomaji && <p className="term-romaji">{question.sentenceRomaji}</p>}
            {settings.showEnglishExamples && <p className="prompt-detail">{question.sentenceTranslation}</p>}
            <p className="prompt-ask">
              What does <strong>{term.term}</strong> mean here?
            </p>
          </>
        )}
        {question.mode === "fill-blank" && (
          <>
            <Sentence parts={question.sentenceParts ?? [{ text: question.prompt, match: false }]} />
            {settings.speechEnabled && (
              <SpeakButton
                text={term.example.ja}
                label="例文を読む / read the example sentence"
                short="🔊 例文"
                // Reading the sentence aloud would say the missing term.
                disabled={!answered}
              />
            )}
            {revealReadings && settings.showKana && <p className="term-kana">{question.sentenceKana}</p>}
            {revealReadings && settings.showRomaji && <p className="term-romaji">{question.sentenceRomaji}</p>}
            <p className="prompt-ask">Which term completes the sentence?</p>
          </>
        )}
        {question.mode === "distinction" && (
          <>
            <p className="prompt-en">{question.prompt}</p>
            {question.promptDetailJa && (
              <p className="prompt-detail ja">
                {question.promptDetailJa}
                {settings.speechEnabled && (
                  <SpeakButton
                    text={question.promptDetailJa}
                    label="日本語の定義を読む / read the Japanese definition"
                    short="🔊 定義"
                  />
                )}
              </p>
            )}
            <p className="prompt-ask">Which term matches this description — and not the similar one?</p>
          </>
        )}
      </div>

      <div className="choices">
        {question.choices.map((choice, index) => {
          const isChosen = chosen === index;
          const classes = ["choice"];
          if (answered && choice.correct) classes.push("correct");
          if (answered && isChosen && !choice.correct) classes.push("wrong");
          if (answered && !isChosen && !choice.correct) classes.push("dim");
          return (
            <button key={choice.key + index} className={classes.join(" ")} disabled={answered} onClick={() => onAnswer(index)}>
              <span className="choice-key">{index + 1}</span>
              <span className="choice-body">
                <span className={["jp-to-en", "context"].includes(question.mode) ? "choice-en" : "choice-ja"}>
                  {choice.text}
                </span>
                {choice.subtext && settings.showKana && <span className="choice-sub">{choice.subtext}</span>}
              </span>
            </button>
          );
        })}
      </div>

      {!answered && (
        <div className="qcard-foot">
          <span className="hint">keys 1–4 to answer · Esc to skip</span>
          <button className="ghost" onClick={onSkip} aria-label="この問題をスキップ / skip this question">
            スキップ / skip
          </button>
        </div>
      )}
    </div>
  );
}

