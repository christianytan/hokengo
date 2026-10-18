import { CATEGORY_BY_ID, DOMAIN_LABELS, DIFFICULTY_LABELS } from "../data/categories";
import type { TermProgress } from "../types/progress";
import type { VocabularyEntry } from "../types/vocabulary";
import { daysUntilReview } from "../lib/scheduler";
import { DifficultyPill, StatusPill, VerificationPill, percent, relativeTime } from "./ui";
import SpeakButton from "./SpeakButton";

interface Props {
  entry: VocabularyEntry;
  progress?: TermProgress;
  settings: { showKana: boolean; showRomaji: boolean; showEnglishExamples: boolean; speechEnabled?: boolean };
  onBookmark?: () => void;
  onReset?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onOpenTerm?: (id: string) => void;
  compact?: boolean;
}

export default function EntryDetail({
  entry,
  progress,
  settings,
  onBookmark,
  onReset,
  onEdit,
  onDelete,
  onOpenTerm,
  compact = false,
}: Props) {
  const category = CATEGORY_BY_ID.get(entry.category);
  const isUser = entry.origin === "user";
  const dueIn = progress ? daysUntilReview(progress) : null;

  return (
    <article className="entry">
      <header className="entry-head">
        <div>
          <h3 className="entry-term">
            {entry.term}
            {settings.speechEnabled && (
              <SpeakButton text={entry.term} label={`${entry.term} を読む / read the term`} short="🔊 再生" />
            )}
          </h3>
          {settings.showKana && <p className="entry-kana">{entry.kana}</p>}
          {settings.showRomaji && <p className="entry-romaji">{entry.romaji}</p>}
          <p className="entry-translation">{entry.translation}</p>
          {entry.alternativeTranslations?.length && (
            <p className="entry-alt">also: {entry.alternativeTranslations.join(" · ")}</p>
          )}
        </div>
        <div className="entry-badges">
          <DifficultyPill difficulty={entry.difficulty} />
          <VerificationPill status={entry.verification} />
          {isUser && <span className="pill info">your entry</span>}
          {progress && <StatusPill status={progress.status} />}
        </div>
      </header>

      {onBookmark && (
        <div className="entry-actions">
          <button className="ghost" onClick={onBookmark}>
            {progress?.bookmarked ? "★ bookmarked" : "☆ bookmark"}
          </button>
          {progress && progress.attempts > 0 && onReset && (
            <button className="ghost danger" onClick={onReset}>
              reset progress
            </button>
          )}
          {isUser && onEdit && (
            <button className="ghost" onClick={onEdit}>
              edit
            </button>
          )}
          {isUser && onDelete && (
            <button className="ghost danger" onClick={onDelete}>
              delete
            </button>
          )}
        </div>
      )}

      <div className="entry-grid">
        <section>
          <h4>日本語定義</h4>
          <p className="ja">{entry.definitionJa}</p>
        </section>
        <section>
          <h4>Meaning &amp; usage</h4>
          <p>{entry.explanationEn}</p>
          {entry.domainNote && <p className="note">{entry.domainNote}</p>}
        </section>
        <section>
          <h4>
            例文 / example
            {settings.speechEnabled && (
              <SpeakButton text={entry.example.ja} label="例文を読む / read the example sentence" short="🔊 例文" />
            )}
          </h4>
          <p className="ja example">{entry.example.ja}</p>
          {settings.showKana && <p className="kana">{entry.example.kana}</p>}
          {settings.showRomaji && <p className="romaji">{entry.example.romaji}</p>}
          {settings.showEnglishExamples && <p className="translation">{entry.example.translation}</p>}
        </section>
        <section>
          <h4>Where it appears / 現場</h4>
          <p>{entry.context}</p>
        </section>

        {entry.confusedTerms.length > 0 && (
          <section className="wide">
            <h4>Confused with / 混同しやすい</h4>
            <ul className="confused">
              {entry.confusedTerms.map((c) => (
                <li key={c.term}>
                  <span className="confused-term">
                    {c.term}
                    {c.reading && <span className="kana"> {c.reading}</span>}
                    {c.termId && onOpenTerm && (
                      <button className="linklike" onClick={() => onOpenTerm(c.termId!)}>
                        open
                      </button>
                    )}
                  </span>
                  <span className="confused-note">{c.distinction}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {entry.components?.length && (
          <section>
            <h4>Kanji breakdown</h4>
            <ul className="components">
              {entry.components.map((c) => (
                <li key={c.element}>
                  <strong>{c.element}</strong> <span className="kana">{c.reading}</span> — {c.meaning}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h4>Classification</h4>
          <p className="meta-line">
            category: {category?.ja} / {category?.en}
            {entry.subcategory ? ` → ${entry.subcategory}` : ""}
          </p>
          <p className="meta-line">
            domain: {entry.domains.map((d) => DOMAIN_LABELS[d].ja).join(" / ")} · {DIFFICULTY_LABELS[entry.difficulty].en}
          </p>
          {entry.tags.length > 0 && <p className="tags">{entry.tags.map((t) => `#${t}`).join(" ")}</p>}
          {entry.sourceUrl && (
            <p className="meta-line">
              source:{" "}
              <a href={entry.sourceUrl} target="_blank" rel="noreferrer noopener">
                {entry.sourceUrl}
              </a>
            </p>
          )}
          {entry.verificationNote && <p className="note">{entry.verificationNote}</p>}
        </section>

        {!compact && (
          <section>
            <h4>Your progress with this term</h4>
            {progress && progress.attempts > 0 ? (
              <>
                <p className="meta-line">
                  {progress.attempts} attempts · {progress.correct} correct · accuracy{" "}
                  {percent(progress.correct / progress.attempts)} · best streak {progress.maxStreak}
                </p>
                <p className="meta-line">last seen {relativeTime(progress.lastReviewedAt)}</p>
                <p className="meta-line">
                  next review: {dueIn === null ? "—" : dueIn <= 0 ? "now" : `in ${Math.ceil(dueIn)} day(s)`} · interval{" "}
                  {progress.intervalDays}d · ease {progress.easeFactor.toFixed(2)}
                </p>
              </>
            ) : (
              <p className="meta-line muted">Not studied yet.</p>
            )}
          </section>
        )}

        {entry.relatedTerms?.length && onOpenTerm && (
          <section className="wide">
            <h4>Related terms</h4>
            <p className="related">
              {entry.relatedTerms.map((id) => (
                <button key={id} className="linklike" onClick={() => onOpenTerm(id)}>
                  {id}
                </button>
              ))}
            </p>
          </section>
        )}
      </div>
    </article>
  );
}

