#!/usr/bin/env python3
"""Generate a kanji-focused dataset from the core vocabulary components.

The output is intentionally small and conservative: it only contains single kanji
that already appear in the core vocabulary, plus a curated set of common insurance
and business kanji. The kanji trainer uses this for a separate "introduce two
kanji, then quiz four choices" mode.
"""

import json
import pathlib
from collections import defaultdict

ROOT = pathlib.Path(__file__).resolve().parents[1]
VOCAB_DIR = ROOT / "src" / "data" / "vocabulary"
OUTPUT = ROOT / "src" / "data" / "kanji.json"

CURATED = [
    ("受", "じゅ", "accept; receive", ["引受", "保険金受取人"]),
    ("給", "きゅう", "benefit; give; supply", ["給付金", "入院給付金"]),
    ("付", "ふ", "attach; append; add", ["付加", "特約付"]),
    ("請", "せい", "request; claim; ask", ["請求", "保険金請求"]),
    ("求", "きゅう", "seek; demand; request", ["請求", "要求"]),
    ("故", "こ", "cause; reason; circumstance", ["事故", "故実"]),
    ("事", "じ", "matter; fact; event", ["事故", "事項"]),
    ("消", "しょう", "erase; cancel; extinguish", ["消込", "消印"]),
    ("復", "ふく", "restore; return; recover", ["復活", "復元"]),
    ("続", "ぞく", "continue; keep going", ["継続", "続報"]),
    ("更", "こう", "alter; renew; change", ["更新", "改更"]),
    ("新", "しん", "new; novel", ["新規", "新価"]),
    ("規", "き", "rule; standard; regulation", ["規定", "規程"]),
    ("名", "めい", "name; title", ["記名", "名義"]),
    ("義", "ぎ", "meaning; duty; righteousness", ["名義", "義務"]),
    ("住", "じゅう", "live; reside; dwell", ["住所", "居住"]),
    ("所", "しょ", "place; location; office", ["住所", "箇所"]),
    ("帳", "ちょう", "ledger; notebook; account book", ["帳票", "台帳"]),
    ("戸", "こ", "account; household; counter for doors", ["口座", "戸籍"]),
    ("振", "しん", "shake; wave; transfer", ["振替", "振込"]),
    ("替", "たい", "replace; substitute; change", ["振替", "買替"]),
    ("督", "とく", "urge; supervise; oversee", ["督促", "監督"]),
    ("促", "そく", "urge; prompt; stimulate", ["督促", "促進"]),
    ("猶", "ゆう", "still; delay; grace", ["猶予", "猶予期間"]),
    ("予", "よ", "beforehand; grant; reserve", ["予備", "予約"]),
    ("転", "てん", "turn; shift; transfer", ["転換", "転記"]),
    ("換", "かん", "exchange; swap; convert", ["転換", "両替"]),
    ("元", "げん", "origin; base; restore", ["復元", "原価"]),
    ("届", "かい", "notify; report; reach", ["届出", "届出書"]),
    ("出", "しゅつ", "issue; go out; submit", ["届出", "出力"]),
    ("生", "せい", "life; birth; produce", ["生命保険", "生保"]),
    ("死", "し", "death; die", ["死亡保険金", "死亡"]),
    ("亡", "ぼう", "death; expire; deceased", ["死亡", "亡くす"]),
    ("病", "びょう", "illness; disease", ["疾病", "病人"]),
    ("院", "いん", "hospital; institute", ["入院", "病院"]),
    ("医", "い", "medicine; doctor", ["医療", "医師"]),
    ("療", "りょう", "heal; treat; therapy", ["医療", "治療"]),
    ("薬", "やく", "medicine; drug", ["医薬", "薬品"]),
    ("災", "さい", "disaster; calamity", ["火災", "災害"]),
    ("害", "がい", "harm; injury; damage", ["災害", "傷害"]),
    ("財", "ざい", "property; wealth; assets", ["財産", "財務"]),
    ("産", "さん", "produce; give birth; property", ["財産", "生産"]),
    ("物", "ぶつ", "thing; object; matter", ["物", "物品"]),
    ("車", "しゃ", "vehicle; car", ["自動車", "車両"]),
    ("両", "りょう", "both; two; counter", ["両方", "生損両"]),
    ("通", "つう", "pass through; communicate", ["通知", "通信"]),
    ("信", "しん", "trust; truth; faith", ["信用", "通信"]),
    ("用", "よう", "use; employ; funds", ["費用", "使用"]),
    ("使", "し", "use; envoy; employ", ["使用", "使者"]),
    ("便", "べん", "convenience; mail; opportunity", ["郵便", "便宜"]),
    ("配", "はい", "distribute; arrange;配当", ["配当金", "配布"]),
    ("当", "とう", "hit; correct; correspond", ["該当", "当座"]),
    ("残", "ざん", "remain; leftover", ["残存", "残高"]),
    ("存", "ぞん", "exist; suppose; retain", ["残存", "存在"]),
    ("価", "か", "value; price", ["価額", "時価"]),
    ("市", "し", "market; city", ["市場", "市価"]),
    ("場", "じょう", "place; field; occasion", ["場所", "場合"]),
    ("手", "しゅ", "hand; means; procedure", ["手续", "手続"]),
    ("落", "らく", "fall; drop; settle", ["落札", "落地"]),
    ("札", "さつ", "tag; certificate; bill", ["札入", "証券札"]),
]

def is_single_kanji(value: str) -> bool:
    return len(value) == 1 and "\u4e00" <= value <= "\u9fff"


def load_component_kanji():
    by_kanji = defaultdict(lambda: {"readings": [], "meanings": [], "examples": []})
    for path in sorted(VOCAB_DIR.glob("*.json")):
        if path.name == "extended-generated.json":
            continue
        for entry in json.loads(path.read_text(encoding="utf-8")):
            for comp in entry.get("components", []):
                element = comp.get("element", "")
                if not is_single_kanji(element):
                    continue
                rec = by_kanji[element]
                reading = comp.get("reading", "")
                meaning = comp.get("meaning", "")
                if reading and reading not in rec["readings"]:
                    rec["readings"].append(reading)
                if meaning and meaning not in rec["meanings"]:
                    rec["meanings"].append(meaning)
                if entry["term"] and entry["term"] not in rec["examples"]:
                    rec["examples"].append(entry["term"])
    return by_kanji


def main():
    component_kanji = load_component_kanji()
    out = []
    seen = set()

    for kanji, rec in sorted(component_kanji.items()):
        if kanji in seen:
            continue
        seen.add(kanji)
        out.append(
            {
                "id": f"kanji-{ord(kanji):04x}",
                "kanji": kanji,
                "reading": rec["readings"][0] if rec["readings"] else "",
                "meaning": rec["meanings"][0] if rec["meanings"] else "",
                "examples": rec["examples"][:5],
                "source": "core-vocabulary-components",
            }
        )

    for kanji, reading, meaning, examples in CURATED:
        if kanji in seen:
            continue
        seen.add(kanji)
        out.append(
            {
                "id": f"kanji-{ord(kanji):04x}",
                "kanji": kanji,
                "reading": reading,
                "meaning": meaning,
                "examples": examples[:5],
                "source": "curated-insurance-kanji",
            }
        )

    OUTPUT.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"kanji={len(out)} output={OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()

