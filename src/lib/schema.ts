import type {
  CategoryId,
  Difficulty,
  Domain,
  ExampleSentence,
  VocabularyEntry,
  VerificationStatus,
} from "../types/vocabulary";

/**
 * Runtime validation for vocabulary entries.
 *
 * Used in three places:
 *  1. when the built-in JSON dataset is loaded (fail fast during development),
 *  2. when a backup file is imported (protect existing data from bad input),
 *  3. in the test suite (guarantee the shipped dataset is complete).
 *
 * Imported content is never evaluated as JavaScript or HTML: values are only
 * read as strings, sanitised of control characters, and length-capped.
 */

import { CATEGORY_IDS } from "../data/categories";

export const DIFFICULTY_VALUES = ["n3-bridge", "n2-bridge", "insurance-specialist"] as const;
export const DOMAIN_VALUES = ["life", "non-life", "both", "it", "general"] as const;
export const VERIFICATION_VALUES = ["verified", "industry-standard", "review-needed"] as const;

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

const LIMITS = {
  id: 80,
  term: 120,
  kana: 200,
  romaji: 300,
  translation: 300,
  definitionJa: 1000,
  explanationEn: 4000,
  context: 1000,
  subcategory: 120,
  domainNote: 1000,
  sourceUrl: 500,
  verificationNote: 1000,
} as const;

export interface FieldIssue {
  path: string;
  message: string;
}

export interface EntryValidationResult {
  valid: boolean;
  entry?: VocabularyEntry;
  issues: FieldIssue[];
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Strip control characters, collapse whitespace and cap the length. */
export function sanitizeText(value: string, max: number): string {
  const cleaned = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ");
  const collapsed = cleaned.replace(/\s+/g, " ").trim();
  return collapsed.length > max ? collapsed.slice(0, max) : collapsed;
}

function readString(
  obj: Record<string, unknown>,
  key: string,
  issues: FieldIssue[],
  { required = true, max = 500 }: { required?: boolean; max?: number } = {}
): string | undefined {
  const raw = obj[key];
  if (raw === undefined || raw === null || raw === "") {
    if (required) issues.push({ path: key, message: "required (must be a non-empty string)" });
    return undefined;
  }
  if (typeof raw !== "string") {
    issues.push({ path: key, message: "must be a string" });
    return undefined;
  }
  const value = sanitizeText(raw, max);
  if (!value) {
    if (required) issues.push({ path: key, message: "must not be empty" });
    return undefined;
  }
  return value;
}

function readStringArray(
  obj: Record<string, unknown>,
  key: string,
  issues: FieldIssue[],
  { required = false, maxItems = 50, itemMax = 300 }: { required?: boolean; maxItems?: number; itemMax?: number } = {}
): string[] | undefined {
  const raw = obj[key];
  if (raw === undefined || raw === null) {
    if (required) issues.push({ path: key, message: "required (must be an array)" });
    return undefined;
  }
  if (!Array.isArray(raw)) {
    issues.push({ path: key, message: "must be an array" });
    return undefined;
  }
  if (raw.length > maxItems) {
    issues.push({ path: key, message: `too many items (max ${maxItems})` });
  }
  const out: string[] = [];
  for (const item of raw.slice(0, maxItems)) {
    if (typeof item !== "string") {
      issues.push({ path: key, message: "items must be strings" });
      continue;
    }
    const v = sanitizeText(item, itemMax);
    if (v) out.push(v);
  }
  if (required && out.length === 0) issues.push({ path: key, message: "must contain at least one item" });
  return out;
}

function readEnum<T extends string>(
  obj: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  issues: FieldIssue[],
  { required = true, multiple = false }: { required?: boolean; multiple?: boolean } = {}
): T | T[] | undefined {
  const raw = obj[key];
  if (raw === undefined || raw === null) {
    if (required) issues.push({ path: key, message: `required (one of: ${allowed.join(", ")})` });
    return undefined;
  }
  const values = multiple ? (Array.isArray(raw) ? raw : [raw]) : [raw];
  const out: T[] = [];
  for (const v of values) {
    if (typeof v === "string" && (allowed as readonly string[]).includes(v)) {
      out.push(v as T);
    } else {
      issues.push({ path: key, message: `invalid value "${String(v)}" (allowed: ${allowed.join(", ")})` });
    }
  }
  if (multiple && required && out.length === 0) {
    issues.push({ path: key, message: "must contain at least one valid value" });
  }
  return multiple ? out : out[0];
}

function validateExample(raw: unknown, issues: FieldIssue[]): ExampleSentence | undefined {
  if (!isPlainObject(raw)) {
    issues.push({ path: "example", message: "required (object with ja/kana/romaji/translation)" });
    return undefined;
  }
  const inner: FieldIssue[] = [];
  const ja = readString(raw, "ja", inner, { max: 1000 });
  const kana = readString(raw, "kana", inner, { max: 1500 });
  const romaji = readString(raw, "romaji", inner, { max: 2000 });
  const translation = readString(raw, "translation", inner, { max: 1500 });
  if (inner.length) {
    issues.push(...inner.map((i) => ({ path: `example.${i.path}`, message: i.message })));
    return undefined;
  }
  return { ja: ja!, kana: kana!, romaji: romaji!, translation: translation! };
}

export function validateVocabularyEntry(raw: unknown): EntryValidationResult {
  const issues: FieldIssue[] = [];
  if (!isPlainObject(raw)) {
    return { valid: false, issues: [{ path: "", message: "entry must be an object" }] };
  }

  const id = readString(raw, "id", issues, { max: LIMITS.id });
  if (id && !ID_PATTERN.test(id)) {
    issues.push({ path: "id", message: "id must be lower-case kebab-case (a-z, 0-9, dot, underscore, hyphen)" });
  }

  const term = readString(raw, "term", issues, { max: LIMITS.term });
  const kana = readString(raw, "kana", issues, { max: LIMITS.kana });
  const romaji = readString(raw, "romaji", issues, { max: LIMITS.romaji });
  const translation = readString(raw, "translation", issues, { max: LIMITS.translation });
  const definitionJa = readString(raw, "definitionJa", issues, { max: LIMITS.definitionJa });
  const explanationEn = readString(raw, "explanationEn", issues, { max: LIMITS.explanationEn });
  const context = readString(raw, "context", issues, { max: LIMITS.context });

  const category = readEnum<CategoryId>(raw, "category", CATEGORY_IDS, issues);
  const difficulty = readEnum<Difficulty>(raw, "difficulty", DIFFICULTY_VALUES, issues);
  const domains = readEnum<Domain>(raw, "domains", DOMAIN_VALUES, issues, { multiple: true });
  const verification = readEnum<VerificationStatus>(raw, "verification", VERIFICATION_VALUES, issues, {
    required: false,
  });

  const example = validateExample(raw["example"], issues);

  const confusedRaw = raw["confusedTerms"];
  const confusedTerms: NonNullable<VocabularyEntry["confusedTerms"]> = [];
  if (confusedRaw === undefined || confusedRaw === null) {
    issues.push({ path: "confusedTerms", message: "required (may be an empty array)" });
  } else if (!Array.isArray(confusedRaw)) {
    issues.push({ path: "confusedTerms", message: "must be an array" });
  } else {
    for (const item of confusedRaw.slice(0, 20)) {
      if (!isPlainObject(item)) {
        issues.push({ path: "confusedTerms", message: "items must be objects" });
        continue;
      }
      const inner: FieldIssue[] = [];
      const cTerm = readString(item, "term", inner, { max: 120 });
      const distinction = readString(item, "distinction", inner, { max: 1000 });
      const reading = readString(item, "reading", inner, { required: false, max: 200 });
      const termId = readString(item, "termId", inner, { required: false, max: 80 });
      if (inner.length) {
        issues.push(...inner.map((i) => ({ path: `confusedTerms.${i.path}`, message: i.message })));
        continue;
      }
      confusedTerms.push({
        term: cTerm!,
        distinction: distinction!,
        ...(reading ? { reading } : {}),
        ...(termId ? { termId } : {}),
      });
    }
  }

  const tags = readStringArray(raw, "tags", issues, { maxItems: 30, itemMax: 60 }) ?? [];
  const alternativeTranslations = readStringArray(raw, "alternativeTranslations", issues, { maxItems: 10, itemMax: 300 });
  const blankVariants = readStringArray(raw, "blankVariants", issues, { maxItems: 10, itemMax: 120 });
  const fillBlankExclude = readStringArray(raw, "fillBlankExclude", issues, { maxItems: 20, itemMax: 80 });
  const relatedTerms = readStringArray(raw, "relatedTerms", issues, { maxItems: 20, itemMax: 80 });
  const subcategory = readString(raw, "subcategory", issues, { required: false, max: LIMITS.subcategory });
  const domainNote = readString(raw, "domainNote", issues, { required: false, max: LIMITS.domainNote });
  const sourceUrl = readString(raw, "sourceUrl", issues, { required: false, max: LIMITS.sourceUrl });
  const verificationNote = readString(raw, "verificationNote", issues, { required: false, max: LIMITS.verificationNote });

  if (sourceUrl && !/^https?:\/\/\S+$/i.test(sourceUrl)) {
    issues.push({ path: "sourceUrl", message: "must be an http(s) URL" });
  }

  const components: NonNullable<VocabularyEntry["components"]> = [];
  if (Array.isArray(raw["components"])) {
    for (const item of (raw["components"] as unknown[]).slice(0, 12)) {
      if (!isPlainObject(item)) continue;
      const inner: FieldIssue[] = [];
      const element = readString(item, "element", inner, { max: 20 });
      const reading = readString(item, "reading", inner, { max: 40 });
      const meaning = readString(item, "meaning", inner, { max: 200 });
      if (!inner.length && element && reading && meaning) components.push({ element, reading, meaning });
    }
  }

  const createdAt = readString(raw, "createdAt", issues, { required: false, max: 40 });
  const updatedAt = readString(raw, "updatedAt", issues, { required: false, max: 40 });

  if (issues.length) return { valid: false, issues };

  const entry: VocabularyEntry = {
    id: id!,
    term: term!,
    kana: kana!,
    romaji: romaji!,
    translation: translation!,
    definitionJa: definitionJa!,
    explanationEn: explanationEn!,
    category: category as CategoryId,
    difficulty: difficulty as Difficulty,
    domains: domains as Domain[],
    example: example!,
    context: context!,
    confusedTerms,
    tags,
  };
  if (alternativeTranslations?.length) entry.alternativeTranslations = alternativeTranslations;
  if (blankVariants?.length) entry.blankVariants = blankVariants;
  if (fillBlankExclude?.length) entry.fillBlankExclude = fillBlankExclude;
  if (relatedTerms?.length) entry.relatedTerms = relatedTerms;
  if (components.length) entry.components = components;
  if (subcategory) entry.subcategory = subcategory;
  if (domainNote) entry.domainNote = domainNote;
  if (sourceUrl) entry.sourceUrl = sourceUrl;
  if (verification) entry.verification = verification as VocabularyEntry["verification"];
  if (verificationNote) entry.verificationNote = verificationNote;
  if (createdAt) entry.createdAt = createdAt;
  if (updatedAt) entry.updatedAt = updatedAt;

  return { valid: true, entry, issues: [] };
}

export interface ListValidationResult {
  valid: boolean;
  entries: VocabularyEntry[];
  issues: FieldIssue[];
}

/** Validates a list of entries and rejects duplicate ids within the list. */
export function validateVocabularyList(raw: unknown): ListValidationResult {
  const issues: FieldIssue[] = [];
  if (!Array.isArray(raw)) {
    return { valid: false, entries: [], issues: [{ path: "", message: "vocabulary must be an array" }] };
  }
  const entries: VocabularyEntry[] = [];
  const seen = new Set<string>();
  raw.forEach((item, i) => {
    const result = validateVocabularyEntry(item);
    if (!result.valid) {
      const label = isPlainObject(item) && typeof item.id === "string" ? item.id : `entry #${i + 1}`;
      result.issues.forEach((iss) =>
        issues.push({ path: `${label}${iss.path ? "." + iss.path : ""}`, message: iss.message })
      );
      return;
    }
    const entry = result.entry!;
    if (seen.has(entry.id)) {
      issues.push({ path: entry.id, message: "duplicate id in the same list" });
      return;
    }
    seen.add(entry.id);
    entries.push(entry);
  });
  return { valid: issues.length === 0, entries, issues };
}
