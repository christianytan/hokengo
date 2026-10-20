import type { VocabularyEntry } from "../types/vocabulary";
import { validateVocabularyList, type FieldIssue } from "../lib/schema";

import contractFundamentals from "./vocabulary/contract-fundamentals.json";
import lifeBenefits from "./vocabulary/life-benefits.json";
import contractLifecycle from "./vocabulary/contract-lifecycle.json";
import underwriting from "./vocabulary/underwriting.json";
import claimsPayment from "./vocabulary/claims-payment.json";
import productsCoverage from "./vocabulary/products-coverage.json";
import kyosai from "./vocabulary/kyosai.json";
import insuranceIt from "./vocabulary/insurance-it.json";
import insuranceItIpsj from "./vocabulary/insurance-it-ipsj.json";
import extendedGenerated from "./vocabulary/extended-generated.json";
import corpusGenerated from "./vocabulary/corpus-generated.json";

/**
 * Built-in vocabulary loader.
 *
 * The vocabulary itself lives in the JSON files under ./vocabulary (one file per
 * category). This module is the only place that knows which files exist, so
 * adding a new category file is a one-line change here.
 */
const DATA_FILES: { file: string; data: unknown }[] = [
  { file: "contract-fundamentals.json", data: contractFundamentals },
  { file: "life-benefits.json", data: lifeBenefits },
  { file: "contract-lifecycle.json", data: contractLifecycle },
  { file: "underwriting.json", data: underwriting },
  { file: "claims-payment.json", data: claimsPayment },
  { file: "products-coverage.json", data: productsCoverage },
  { file: "kyosai.json", data: kyosai },
  { file: "insurance-it.json", data: insuranceIt },
  { file: "insurance-it-ipsj.json", data: insuranceItIpsj },
  { file: "extended-generated.json", data: extendedGenerated },
  { file: "corpus-generated.json", data: corpusGenerated },
];

function loadBuiltIn(): VocabularyEntry[] {
  const entries: VocabularyEntry[] = [];
  const issues: FieldIssue[] = [];
  const seen = new Set<string>();

  for (const { file, data } of DATA_FILES) {
    const result = validateVocabularyList(data);
    if (result.issues.length) {
      issues.push(...result.issues.map((i) => ({ path: `${file}#${i.path}`, message: i.message })));
    }
    for (const entry of result.entries) {
      if (seen.has(entry.id)) {
        issues.push({ path: `${file}#${entry.id}`, message: "duplicate id across category files" });
        continue;
      }
      seen.add(entry.id);
      entries.push({ ...entry, origin: "builtin" });
    }
  }

  if (issues.length) {
    const detail = issues.slice(0, 15).map((i) => `  - ${i.path}: ${i.message}`).join("\n");
    throw new Error(
      `Built-in vocabulary failed validation (${issues.length} issue(s)):\n${detail}` +
        (issues.length > 15 ? `\n  ...and ${issues.length - 15} more` : "")
    );
  }
  return entries;
}

export const BUILT_IN_VOCABULARY: VocabularyEntry[] = loadBuiltIn();

export function getBuiltInVocabulary(): VocabularyEntry[] {
  return BUILT_IN_VOCABULARY;
}
