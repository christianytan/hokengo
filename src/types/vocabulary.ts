/**
 * Vocabulary data model.
 *
 * The schema is intentionally additive: new optional fields can be introduced
 * without breaking existing data files or previously exported backups.
 * `VOCABULARY_SCHEMA_VERSION` is only bumped for breaking changes.
 */

export const VOCABULARY_SCHEMA_VERSION = 1 as const;

/** Study/quiz modes (Mode F = vocabulary browser, Mode G = weak-term review are session filters, not question types). */
export type QuestionMode =
  | "jp-to-en"
  | "en-to-jp"
  | "context"
  | "fill-blank"
  | "distinction"
  | "kanji";

export type CategoryId =
  | "contract-fundamentals"
  | "life-benefits"
  | "contract-lifecycle"
  | "underwriting"
  | "claims-payment"
  | "products-coverage"
  | "kyosai"
  | "insurance-it";

/**
 * Language difficulty, not insurance difficulty:
 * - n3-bridge: readable with JLPT N3 kanji knowledge, term meaning is specialised
 * - n2-bridge: needs N2-level business Japanese to parse
 * - insurance-specialist: industry/legal jargon that ordinary JLPT study does not cover
 */
export type Difficulty = "n3-bridge" | "n2-bridge" | "insurance-specialist";

/** Insurance domain in which the term is normally used. */
export type Domain = "life" | "non-life" | "both" | "it" | "general";

/**
 * How much trust to put in an entry:
 * - verified: checked against the cited public source in `sourceUrl`
 * - industry-standard: normal professional usage, consistent with the general
 *   references cited in docs/TERMINOLOGY_SOURCES.md but not tied to one page
 * - review-needed: wording differs between insurers; confirm against the
 *   documentation of the specific company/project before relying on it
 */
export type VerificationStatus = "verified" | "industry-standard" | "review-needed";

export interface ExampleSentence {
  /** Natural business Japanese containing the term. */
  ja: string;
  /** Full kana reading of the sentence. */
  kana: string;
  /** Romaji transliteration (Hepburn with macrons). */
  romaji: string;
  /** English translation. */
  translation: string;
}

export interface ConfusedTermRef {
  /** Display form of the confusable term. */
  term: string;
  /** Kana reading of the confusable term. */
  reading?: string;
  /** id of the other entry when it exists in the dataset (enables distinction questions). */
  termId?: string;
  /** Why the two differ — shown in feedback. */
  distinction: string;
}

export interface KanjiComponent {
  /** The kanji element, e.g. 引. */
  element: string;
  /** Reading used in this compound. */
  reading: string;
  /** Meaning contribution. */
  meaning: string;
}

export interface VocabularyEntry {
  /** Stable unique id, kebab-case, never reused. */
  id: string;
  term: string;
  kana: string;
  romaji: string;
  /** Primary English translation. */
  translation: string;
  alternativeTranslations?: string[];
  /** Short definition in Japanese (dictionary style, one or two sentences). */
  definitionJa: string;
  /** Precise English explanation, including context-dependent readings. */
  explanationEn: string;
  category: CategoryId;
  subcategory?: string;
  difficulty: Difficulty;
  domains: Domain[];
  /** Note when life / non-life / individual insurers use different wording. */
  domainNote?: string;
  example: ExampleSentence;
  /**
   * Surface forms that may be blanked in a fill-in-the-blank question when the
   * term itself does not appear verbatim in the example (e.g. 活性・非活性 → 活性).
   */
  blankVariants?: string[];
  /** Term ids that would ALSO fit the fill-in-the-blank sentence (kept out of distractors). */
  fillBlankExclude?: string[];
  /** Where this appears in real insurance business or IT work. */
  context: string;
  confusedTerms: ConfusedTermRef[];
  components?: KanjiComponent[];
  relatedTerms?: string[];
  sourceUrl?: string;
  verification?: VerificationStatus;
  verificationNote?: string;
  tags: string[];
  /** Set at runtime: built-in dataset vs. learner-created entry. */
  origin?: "builtin" | "user";
  createdAt?: string;
  updatedAt?: string;
}

export type VocabularyEntryInput = Omit<VocabularyEntry, "origin">;
