import type { CategoryId, ExampleSentence, QuestionMode, VocabularyEntry } from "../types/vocabulary";
import { areAnswersTooSimilar, normalizeForSearch, phraseSimilarity, splitAroundTerm } from "./text";
import { shuffle, type Rng } from "./random";

/**
 * Question generation.
 *
 * Hard guarantees enforced here:
 *  - every question has exactly CHOICES_PER_QUESTION (4) choices
 *  - exactly one choice is marked correct
 *  - no two choices have the same normalised text
 *  - distractors are rejected when their answer text is too close to the correct
 *    answer (that would make two options defensibly correct)
 *  - for modes A/B/C, terms that the dataset explicitly marks as confusable with
 *    the target are never used as distractors - those pairs are reserved for the
 *    distinction mode, where the question explicitly asks for the difference
 *  - if four valid choices cannot be produced, generate() returns null and the
 *    caller must pick a different question instead of inventing options
 */

export const QUESTION_MODES: QuestionMode[] = ["jp-to-en", "en-to-jp", "context", "fill-blank", "distinction"];
export const CHOICES_PER_QUESTION = 4;

export interface QuestionChoice {
  key: string;
  text: string;
  subtext?: string;
  correct: boolean;
}

export interface DistinctionNote {
  term: string;
  reading?: string;
  distinction: string;
}

export interface GeneratedQuestion {
  id: string;
  termId: string;
  mode: QuestionMode;
  prompt: string;
  promptReading?: string;
  promptRomaji?: string;
  /** Extra prose shown under the prompt (collapsible in the UI). */
  promptDetailEn?: string;
  promptDetailJa?: string;
  /** Sentence with the target term marked, for context and fill-in-the-blank modes. */
  sentenceParts?: { text: string; match: boolean }[];
  sentenceKana?: string;
  sentenceRomaji?: string;
  sentenceTranslation?: string;
  choices: QuestionChoice[];
  explanation: string;
  distinctionNotes: DistinctionNote[];
  example?: ExampleSentence;
}

/** Modes whose answer text is an English phrase. */
const ENGLISH_ANSWER_MODES: QuestionMode[] = ["jp-to-en", "context"];
/** Modes whose answer text is a Japanese term. */
const JAPANESE_ANSWER_MODES: QuestionMode[] = ["en-to-jp", "fill-blank", "distinction"];

function answerText(entry: VocabularyEntry, mode: QuestionMode): string {
  return ENGLISH_ANSWER_MODES.includes(mode) ? entry.translation : entry.term;
}

function answerSubtext(entry: VocabularyEntry, mode: QuestionMode): string | undefined {
  if (ENGLISH_ANSWER_MODES.includes(mode)) return undefined;
  return `${entry.kana} / ${entry.romaji}`;
}

export class QuestionGenerator {
  private byId = new Map<string, VocabularyEntry>();
  private byCategory = new Map<CategoryId, VocabularyEntry[]>();

  constructor(entries: readonly VocabularyEntry[]) {
    for (const entry of entries) {
      this.byId.set(entry.id, entry);
      const list = this.byCategory.get(entry.category) ?? [];
      list.push(entry);
      this.byCategory.set(entry.category, list);
    }
  }

  get size(): number {
    return this.byId.size;
  }

  has(termId: string): boolean {
    return this.byId.has(termId);
  }

  /** Surface form of the term that actually appears in the example sentence. */
  private findSurface(entry: VocabularyEntry): string | null {
    const surfaces = [entry.term, ...(entry.blankVariants ?? [])];
    for (const surface of surfaces) {
      if (surface && entry.example.ja.includes(surface)) return surface;
    }
    return null;
  }

  /**
   * Surface usable for fill-in-the-blank: it must occur exactly once, otherwise
   * the answer stays visible elsewhere in the sentence (e.g. blanking 解約 in a
   * sentence that also contains 解約日 and 解約返戻金).
   */
  private findBlankSurface(entry: VocabularyEntry): string | null {
    const surfaces = [entry.term, ...(entry.blankVariants ?? [])];
    for (const surface of surfaces) {
      if (!surface) continue;
      const occurrences = entry.example.ja.split(surface).length - 1;
      if (occurrences === 1) return surface;
    }
    return null;
  }

  private confusableIds(entry: VocabularyEntry): Set<string> {
    const ids = new Set<string>();
    for (const c of entry.confusedTerms) if (c.termId) ids.add(c.termId);
    for (const other of this.byId.values()) {
      if (other.confusedTerms.some((c) => c.termId === entry.id)) ids.add(other.id);
    }
    return ids;
  }

  /**
   * Confusable partners usable in a distinction question.
   * A partner is only usable when its English meaning is clearly different from
   * the target's - otherwise a single prompt would describe both terms and the
   * question would have two correct answers.
   */
  private distinctionPartners(target: VocabularyEntry): VocabularyEntry[] {
    const out: VocabularyEntry[] = [];
    for (const c of target.confusedTerms) {
      if (!c.termId) continue;
      const partner = this.byId.get(c.termId);
      if (!partner) continue;
      if (normalizeForSearch(partner.term) === normalizeForSearch(target.term)) continue;
      if (this.meaningDistance(target, partner) >= 0.5) continue;
      out.push(partner);
    }
    return out;
  }

  private meaningDistance(a: VocabularyEntry, b: VocabularyEntry): number {
    const left = `${a.translation} ${(a.alternativeTranslations ?? []).join(" ")}`;
    const right = `${b.translation} ${(b.alternativeTranslations ?? []).join(" ")}`;
    return phraseSimilarity(left, right);
  }

  /** Ordered candidate pools, best (most plausible) first. */
  private pools(target: VocabularyEntry): VocabularyEntry[][] {
    const sameCategory = (this.byCategory.get(target.category) ?? []).filter(
      (e) => e.id !== target.id && e.subcategory && e.subcategory === target.subcategory
    );
    const category = (this.byCategory.get(target.category) ?? []).filter((e) => e.id !== target.id);
    const sameDomain = [...this.byId.values()].filter(
      (e) => e.id !== target.id && e.category !== target.category && e.domains.some((d) => target.domains.includes(d))
    );
    const rest = [...this.byId.values()].filter((e) => e.id !== target.id && e.category !== target.category);
    return [sameCategory, category, sameDomain, rest];
  }

  private eligible(
    target: VocabularyEntry,
    mode: QuestionMode,
    surface: string | null,
    partnerIds: ReadonlySet<string> = new Set()
  ): (entry: VocabularyEntry) => boolean {
    const blocked = new Set<string>([target.id, ...(target.fillBlankExclude ?? [])]);
    const confusable = this.confusableIds(target);
    const sentence = target.example.ja;

    return (candidate) => {
      if (blocked.has(candidate.id)) return false;
      if (candidate.id === target.id) return false;

      if (ENGLISH_ANSWER_MODES.includes(mode) || mode === "en-to-jp") {
        // A/B/C: confusable pairs are reserved for distinction questions.
        if (confusable.has(candidate.id)) return false;
      }

      if (JAPANESE_ANSWER_MODES.includes(mode)) {
        if (normalizeForSearch(candidate.term) === normalizeForSearch(target.term)) return false;
        // In distinction mode, same-reading different-kanji pairs such as 保障/補償
        // are valid confusable partners. For other Japanese-answer modes, keep the
        // reading distinct so the multiple-choice item is not needlessly ambiguous.
        if (
          normalizeForSearch(candidate.kana) === normalizeForSearch(target.kana) &&
          !(mode === "distinction" && partnerIds.has(candidate.id))
        ) {
          return false;
        }
      }

      if (mode === "fill-blank" && surface) {
        const candidateSurfaces = [candidate.term, ...(candidate.blankVariants ?? [])];
        for (const cs of candidateSurfaces) {
          // A term that contains, or is contained by, the blank would make the
          // sentence readable two ways (e.g. 支払対象 vs 支払対象外).
          if (cs.includes(surface) || surface.includes(cs)) return false;
          if (sentence.includes(cs)) return false;
        }
      }
      return true;
    };
  }

  /** Build four shuffled choices, or null when that is not safely possible. */
  private buildChoices(
    target: VocabularyEntry,
    mode: QuestionMode,
    surface: string | null,
    rng: Rng
  ): QuestionChoice[] | null {
    const correctText = answerText(target, mode);
    const isDistinction = mode === "distinction";

    const chosen: VocabularyEntry[] = [];
    const seenTexts = new Set<string>([normalizeForSearch(correctText)]);

    const partners = isDistinction ? this.distinctionPartners(target) : [];
    if (isDistinction && partners.length === 0) return null; // needs a real confusable pair
    const partnerIds = new Set(partners.map((p) => p.id));

    const pools = this.pools(target);
    const filter = this.eligible(target, mode, surface, partnerIds);
    const ordered: VocabularyEntry[] = [];

    if (isDistinction) {
      ordered.push(...shuffle(partners, rng).slice(0, 2));
      for (const pool of pools) ordered.push(...shuffle(pool, rng));
    } else {
      for (const pool of pools) ordered.push(...shuffle(pool, rng));
    }

    for (const candidate of ordered) {
      if (chosen.length >= CHOICES_PER_QUESTION - 1) break;
      if (!filter(candidate)) continue;
      if (chosen.some((c) => c.id === candidate.id)) continue;

      const text = answerText(candidate, mode);
      const key = normalizeForSearch(text);
      if (seenTexts.has(key)) continue;
      // A confusable partner is *supposed* to look like the correct answer - that
      // is the point of a distinction question - so it skips the surface-similarity
      // filter. Its meaning distance to the target is already bounded upstream.
      const isPartner = partnerIds.has(candidate.id);
      if (!isPartner) {
        if (areAnswersTooSimilar(correctText, text)) continue;
        if (chosen.some((c) => areAnswersTooSimilar(answerText(c, mode), text))) continue;
      }
      // The prompt of a distinction question is the target's meaning, so any
      // candidate with the same meaning would be a second correct answer.
      if (isDistinction && this.meaningDistance(target, candidate) >= (isPartner ? 0.5 : 0.34)) continue;

      seenTexts.add(key);
      chosen.push(candidate);
    }

    if (chosen.length < CHOICES_PER_QUESTION - 1) return null;

    const choices: QuestionChoice[] = [
      { key: target.id, text: correctText, subtext: answerSubtext(target, mode), correct: true },
      ...chosen.map((c) => ({ key: c.id, text: answerText(c, mode), subtext: answerSubtext(c, mode), correct: false })),
    ];
    return shuffle(choices, rng);
  }

  supports(termId: string, mode: QuestionMode): boolean {
    const target = this.byId.get(termId);
    if (!target) return false;
    if (mode === "context") return this.findSurface(target) !== null;
    if (mode === "fill-blank") return this.findBlankSurface(target) !== null;
    if (mode === "distinction") return this.distinctionPartners(target).length > 0;
    return true;
  }

  generate(termId: string, mode: QuestionMode, rng: Rng): GeneratedQuestion | null {
    const target = this.byId.get(termId);
    if (!target) return null;
    const surface = mode === "fill-blank" ? this.findBlankSurface(target) : this.findSurface(target);
    if ((mode === "context" || mode === "fill-blank") && !surface) return null;

    const choices = this.buildChoices(target, mode, surface, rng);
    if (!choices) return null;

    const shownIds = new Set(choices.filter((c) => !c.correct).map((c) => c.key));
    const distinctionNotes: DistinctionNote[] = target.confusedTerms
      .filter((c) => !c.termId || shownIds.has(c.termId))
      .map((c) => ({ term: c.term, reading: c.reading, distinction: c.distinction }));

    const base: GeneratedQuestion = {
      id: `${mode}:${target.id}`,
      termId: target.id,
      mode,
      prompt: "",
      choices,
      explanation: target.explanationEn,
      distinctionNotes,
      example: target.example,
    };

    switch (mode) {
      case "jp-to-en":
        base.prompt = target.term;
        base.promptReading = `${target.kana} / ${target.romaji}`;
        break;
      case "en-to-jp":
        base.prompt = target.translation;
        base.promptDetailEn = target.explanationEn;
        break;
      case "context":
        base.prompt = target.example.ja;
        base.sentenceParts = splitAroundTerm(target.example.ja, surface!);
        base.sentenceKana = target.example.kana;
        base.sentenceRomaji = target.example.romaji;
        base.sentenceTranslation = target.example.translation;
        break;
      case "fill-blank":
        base.prompt = target.example.ja;
        base.sentenceParts = splitAroundTerm(target.example.ja, surface!).map((part) =>
          part.match ? { text: "＿＿＿", match: true } : part
        );
        base.sentenceKana = target.example.kana;
        base.sentenceRomaji = target.example.romaji;
        break;
      case "distinction":
        // The prompt is the meaning; the Japanese definition narrows it down and
        // the confusable partner in the option list is what makes it a
        // distinction question rather than a plain definition match.
        base.prompt = target.translation;
        base.promptDetailJa = target.definitionJa;
        break;
    }

    return base;
  }

  /** Try the preferred modes in order and return the first question that works. */
  generateForTerm(
    termId: string,
    preferredModes: readonly QuestionMode[],
    rng: Rng
  ): GeneratedQuestion | null {
    for (const mode of shuffle(preferredModes, rng)) {
      if (!this.supports(termId, mode)) continue;
      const question = this.generate(termId, mode, rng);
      if (question) return question;
    }
    return null;
  }
}
