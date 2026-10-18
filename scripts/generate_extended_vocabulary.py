#!/usr/bin/env python3
"""Generate a broad extended vocabulary pack from the existing built-in terms.

The generated entries are deliberately marked review-needed: they are screen-field
and operation patterns that commonly appear in insurance/IT systems, but the exact
wording varies by company. The script uses the existing dataset as the source of
readings and categories, then appends common system-operation suffixes.
"""

import json
import pathlib
import re
from collections import defaultdict

ROOT = pathlib.Path(__file__).resolve().parents[1]
VOCAB_DIR = ROOT / "src" / "data" / "vocabulary"
OUTPUT = VOCAB_DIR / "extended-generated.json"

TARGET_TOTAL = 1000
TARGET_PER_CATEGORY = 125

SUFFIXES = [
    ("code", "コード", "コード", "kōdo", "code"),
    ("number", "番号", "ばんごう", "bangou", "number"),
    ("info", "情報", "じょうほう", "jouhou", "information"),
    ("list", "一覧", "いちらん", "ichiran", "list"),
    ("inquiry", "照会", "しょうかい", "shoukai", "inquiry"),
    ("history", "履歴", "りれき", "rireki", "history"),
    ("process", "処理", "しょり", "shori", "processing"),
    ("input", "入力", "にゅうりょく", "nyuuryoku", "input"),
    ("confirm", "確認", "かくにん", "kakunin", "confirmation"),
    ("screen", "画面", "がめん", "gamen", "screen"),
    ("form", "帳票", "ちょうひょう", "chouhyou", "form"),
    ("manage", "管理", "かんり", "kanri", "management"),
    ("setting", "設定", "せってい", "settei", "setting"),
    ("search", "検索", "けんさく", "kensaku", "search"),
    ("extract", "抽出", "ちゅうしゅつ", "chuushutsu", "extract"),
    ("import", "取込", "とりこみ", "torikomi", "import"),
    ("output", "出力", "しゅつりょく", "shutsuryoku", "output"),
    ("register", "登録", "とうろく", "touroku", "registration"),
    ("cancel", "取消", "とりけし", "torikeshi", "cancellation"),
    ("change", "変更", "へんこう", "henkou", "change"),
]

SAFE_ID = re.compile(r"[^a-z0-9._-]+")

def load_existing():
    entries = []
    for path in sorted(VOCAB_DIR.glob("*.json")):
        if path.name == "extended-generated.json":
            continue
        entries.extend(json.loads(path.read_text(encoding="utf-8")))
    return entries


def clean_id(value: str) -> str:
    value = SAFE_ID.sub("-", value.lower())
    value = re.sub(r"-+", "-", value).strip("-._")
    return value or "term"


def make_entry(base, suffix):
    suffix_id, suffix_term, suffix_kana, suffix_romaji, suffix_translation = suffix
    term = f"{base['term']}{suffix_term}"
    kana = f"{base['kana']}{suffix_kana}"
    romaji = f"{base['romaji']} {suffix_romaji}"
    translation = f"{base['translation']} {suffix_translation}"
    entry_id = f"{base['id']}-{suffix_id}"
    if len(entry_id) > 80:
        entry_id = clean_id(entry_id[:70] + "-" + suffix_id)

    example_ja = f"このデモでは{term}を扱います。"
    example_kana = f"このでもでは{kana}をあつかいます。"
    example_romaji = f"kono demo de wa {romaji} o atsukaimasu."
    example_translation = f"In this demo, the system handles {translation}."

    subcategory = base.get("subcategory") or base["category"]
    return {
        "id": entry_id,
        "term": term,
        "kana": kana,
        "romaji": romaji,
        "translation": translation,
        "definitionJa": (
            f"{term}とは、{base['term']}に関する{suffix_term}を扱うための画面項目・業務操作の表記。"
        ),
        "explanationEn": (
            f"Company-specific insurance-IT wording built from {base['term']} + {suffix_term}. "
            f"In this trainer it is used for \"{translation}\"."
        ),
        "category": base["category"],
        "subcategory": f"{subcategory} / {suffix_id}",
        "difficulty": base["difficulty"],
        "domains": base["domains"],
        "domainNote": "Generated screen-field/operation wording; exact naming varies by company and system.",
        "example": {
            "ja": example_ja,
            "kana": example_kana,
            "romaji": example_romaji,
            "translation": example_translation,
        },
        "context": (
            "This generated term broadens coverage of insurance-IT screens, reports, and operational "
            "flows. Confirm the exact wording in the target company's specification."
        ),
        "confusedTerms": [
            {
                "term": base["term"],
                "reading": base["kana"],
                "termId": base["id"],
                "distinction": (
                    f"{base['term']} names the underlying object or concept; {term} names the "
                    f"{suffix_translation} attached to it."
                ),
            }
        ],
        "relatedTerms": [base["id"]],
        "verification": "review-needed",
        "verificationNote": (
            "Generated from an existing term to broaden coverage; confirm the exact wording in "
            "the target company's screens or documents."
        ),
        "tags": list(dict.fromkeys(base.get("tags", []) + ["generated", "screen-field", suffix_id])),
    }


def main():
    existing = load_existing()
    existing_terms = {e["term"] for e in existing}
    existing_ids = {e["id"] for e in existing}
    counts = defaultdict(int)
    for entry in existing:
        counts[entry["category"]] += 1

    by_category = defaultdict(list)
    for entry in existing:
        by_category[entry["category"]].append(entry)

    generated = []
    generated_terms = set()

    # Round-robin by category so the expansion does not only inflate the largest
    # existing category.
    categories = sorted(by_category, key=lambda c: (counts[c], c))
    while len(existing) + len(generated) < TARGET_TOTAL:
        progressed = False
        for category in categories:
            if counts[category] >= TARGET_PER_CATEGORY:
                continue
            if len(existing) + len(generated) >= TARGET_TOTAL:
                break
            for base in by_category[category]:
                if counts[category] >= TARGET_PER_CATEGORY:
                    break
                if len(existing) + len(generated) >= TARGET_TOTAL:
                    break
                for suffix in SUFFIXES:
                    suffix_term = suffix[1]
                    if suffix_term in base["term"]:
                        continue
                    entry = make_entry(base, suffix)
                    if entry["term"] in existing_terms or entry["term"] in generated_terms:
                        continue
                    if entry["id"] in existing_ids:
                        continue
                    generated.append(entry)
                    generated_terms.add(entry["term"])
                    existing_ids.add(entry["id"])
                    counts[category] += 1
                    progressed = True
                    if counts[category] >= TARGET_PER_CATEGORY or len(existing) + len(generated) >= TARGET_TOTAL:
                        break
        if not progressed:
            break

    OUTPUT.write_text(json.dumps(generated, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"existing={len(existing)} generated={len(generated)} total={len(existing)+len(generated)}")
    print(f"output={OUTPUT.relative_to(ROOT)}")
    for category in sorted(counts):
        print(f"{category}: {counts[category]}")


if __name__ == "__main__":
    main()

