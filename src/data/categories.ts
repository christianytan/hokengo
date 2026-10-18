import type { CategoryId, Difficulty, Domain, QuestionMode } from "../types/vocabulary";
import type { AnswerGrade } from "../types/progress";

export interface CategoryMeta {
  id: CategoryId;
  order: number;
  ja: string;
  en: string;
  descriptionJa: string;
  descriptionEn: string;
}

export const CATEGORIES: CategoryMeta[] = [
  {
    id: "contract-fundamentals",
    order: 1,
    ja: "保険契約の基礎",
    en: "Insurance contract fundamentals",
    descriptionJa: "契約の当事者・契約そのもの・基本的な契約用語",
    descriptionEn:
      "Parties to a contract, the contract itself, and the core terms every other domain builds on.",
  },
  {
    id: "life-benefits",
    order: 2,
    ja: "生命保険と給付",
    en: "Life insurance and benefits",
    descriptionJa: "死亡保険金・満期保険金・給付金・払込と解約返戻金",
    descriptionEn:
      "Death and maturity benefits, benefit payments, premium payment periods and surrender value.",
  },
  {
    id: "contract-lifecycle",
    order: 3,
    ja: "契約ライフサイクルと変更手続き",
    en: "Contract lifecycle and changes",
    descriptionJa: "新規契約・更新・失効・復活・各種変更手続き",
    descriptionEn:
      "New business, renewal, lapse, reinstatement and the change procedures that appear on screens.",
  },
  {
    id: "underwriting",
    order: 4,
    ja: "引受査定とリスク審査",
    en: "Underwriting and risk assessment",
    descriptionJa: "告知義務・引受基準・危険選択・引受結果",
    descriptionEn:
      "Disclosure duties, underwriting criteria, risk selection and underwriting outcomes.",
  },
  {
    id: "claims-payment",
    order: 5,
    ja: "請求と支払処理",
    en: "Claims and payment processing",
    descriptionJa: "保険金請求・支払査定・書類・差戻し",
    descriptionEn:
      "Benefit claims, claims assessment, documents, deficiencies and rework loops.",
  },
  {
    id: "products-coverage",
    order: 6,
    ja: "保険商品と保障",
    en: "Insurance products and coverage",
    descriptionJa: "商品種類・保障内容・保障範囲・免責",
    descriptionEn:
      "Product types, coverage details, scope of cover and exclusions.",
  },
  {
    id: "kyosai",
    order: 7,
    ja: "共済（JA共済）の用語",
    en: "Kyosai (mutual aid) terminology",
    descriptionJa: "共済掛金・共済金額・共済証書など、保険の用語に対応する共済の用語",
    descriptionEn:
      "Kyosai words and the insurance words they correspond to: 共済掛金/保険料, 共済金額/保険金額, 特約/特則.",
  },
  {
    id: "insurance-it",
    order: 8,
    ja: "保険ITと業務オペレーション",
    en: "Insurance IT and business operations",
    descriptionJa: "画面項目・業務フロー・テスト・データ処理・障害対応",
    descriptionEn:
      "Screen fields, workflows, validation, testing, data processing and incident handling.",
  },
];

export const CATEGORY_BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

/** Category ids in display order - the canonical list used by validation too. */
export const CATEGORY_IDS: CategoryId[] = CATEGORIES.map((c) => c.id);

export const DIFFICULTY_LABELS: Record<Difficulty, { ja: string; en: string }> = {
  "n3-bridge": { ja: "N3ブリッジ", en: "N3 bridge" },
  "n2-bridge": { ja: "N2ブリッジ", en: "N2 bridge" },
  "insurance-specialist": { ja: "保険専門用語", en: "Insurance specialist" },
};

export const DOMAIN_LABELS: Record<Domain, { ja: string; en: string }> = {
  life: { ja: "生命保険", en: "Life insurance" },
  "non-life": { ja: "損害保険・第三分野", en: "Non-life / general insurance" },
  both: { ja: "生損共通", en: "Common to life & non-life" },
  it: { ja: "IT・システム", en: "IT & systems" },
  general: { ja: "分野横断", en: "Cross-domain" },
};

export const MODE_LABELS: Record<QuestionMode, { ja: string; en: string; hint: string }> = {
  "jp-to-en": {
    ja: "日本語 → 英語",
    en: "Japanese to English",
    hint: "Choose the correct English meaning of the Japanese term.",
  },
  "en-to-jp": {
    ja: "英語 → 日本語",
    en: "English to Japanese",
    hint: "Choose the Japanese term that matches the English definition.",
  },
  context: {
    ja: "文脈理解",
    en: "Contextual comprehension",
    hint: "Read the business sentence and choose what the highlighted term means there.",
  },
  "fill-blank": {
    ja: "空所補充",
    en: "Fill in the blank",
    hint: "Complete the Japanese business sentence with the correct term.",
  },
  distinction: {
    ja: "類似語の区別",
    en: "Term distinction",
    hint: "Distinguish commonly confused terms.",
  },
  kanji: {
    ja: "漢字 focused",
    en: "Kanji focused",
    hint: "Introduce two kanji, then choose the correct kanji from four options.",
  },
};

/** Display order of the self-assessment buttons shown after an answer. */
export const ANSWER_GRADES: AnswerGrade[] = ["again", "hard", "good", "easy"];

/**
 * Labels for the self-assessment. `key` is the keyboard shortcut, and the hint is
 * what the learner is being asked to judge — the scheduler maps these onto SM-2
 * qualities in lib/scheduler.ts.
 */
export const GRADE_LABELS: Record<AnswerGrade, { ja: string; en: string; hint: string; key: string; tone: string }> = {
  again: {
    ja: "もう一度",
    en: "again",
    hint: "わかりませんでした — put this term back in the queue now",
    key: "a",
    tone: "bad",
  },
  hard: {
    ja: "難しい",
    en: "hard",
    hint: "合っていたけど苦労した — keep the streak, shorten the next gap",
    key: "h",
    tone: "warn",
  },
  good: {
    ja: "正しい",
    en: "good",
    hint: "思い出せた — normal next gap",
    key: "g",
    tone: "info",
  },
  easy: {
    ja: "簡単",
    en: "easy",
    hint: "考えずに答えられた — lengthen the next gap",
    key: "e",
    tone: "good",
  },
};
