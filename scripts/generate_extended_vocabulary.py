#!/usr/bin/env python3
"""Build the machine-assembled vocabulary packs that sit on top of the core dataset.

Two independent packs are produced:

  corpus pack (corpus-generated.json)
    One entry per curated term in ``scripts/term_corpus/*.tsv``. Those rows are
    real Japanese insurance / insurance-IT terminology: headword, reading, English
    meaning, a short Japanese definition, category, subcategory, language
    difficulty and domain are curated by hand (harvested from public glossaries
    such as the JA共済用語集, 保険業法 / 商法 保険編 wording, insurer 約款 and
    画面設計 terminology, and cross-checked against the term lists linked from the
    Japanese Wikipedia insurance articles). Optional ``sourceUrl`` and
    ``verification`` columns let sourced web glossaries be carried through with
    provenance. The example sentence, the English explanation and the
    confusable-term notes are assembled by this script from per-category
    templates, so the pack can be regenerated at any size.

  screen-field pack (extended-generated.json)
    Systematic 画面項目 / 業務操作 patterns built from the hand-written core
    entries (契約者 + 情報, 証券番号 + 照会, 引受査定 + 履歴, ...).

There is no fixed total any more: ``--total`` and ``--per-category`` control how
much is written and ``--all`` writes everything the corpus and the pattern table
can produce. Re-running the script is deterministic, so the committed JSON only
changes when the corpus or the templates change.
"""

import argparse
import json
import pathlib
import re
import sys
from collections import defaultdict

ROOT = pathlib.Path(__file__).resolve().parents[1]
VOCAB_DIR = ROOT / "src" / "data" / "vocabulary"
CORPUS_DIR = ROOT / "scripts" / "term_corpus"
SCREEN_FIELD_OUTPUT = VOCAB_DIR / "extended-generated.json"
CORPUS_OUTPUT = VOCAB_DIR / "corpus-generated.json"

CATEGORY_LABELS = {
    "contract-fundamentals": ("insurance contract fundamentals", "保険契約の基礎"),
    "life-benefits": ("life insurance and benefits", "生命保険と給付"),
    "contract-lifecycle": ("contract lifecycle and change procedures", "契約ライフサイクルと変更手続き"),
    "underwriting": ("underwriting and risk assessment", "引受査定とリスク審査"),
    "claims-payment": ("claims and payment processing", "請求と支払処理"),
    "products-coverage": ("insurance products and coverage", "保険商品と保障"),
    "kyosai": ("kyosai (mutual aid) terminology", "共済（JA共済）の用語"),
    "insurance-it": ("insurance IT and business operations", "保険ITと業務オペレーション"),
}

VALID_CATEGORIES = set(CATEGORY_LABELS)
VALID_DIFFICULTIES = {"n3-bridge", "n2-bridge", "insurance-specialist"}
VALID_DOMAINS = {"life", "non-life", "both", "it", "general"}
VALID_VERIFICATIONS = {"verified", "industry-standard", "review-needed"}

# ---------------------------------------------------------------------------
# kana -> romaji (Hepburn, in the style already used by the dataset: hiragana
# long vowels stay digraphs (りょう -> ryou), katakana ー becomes a macron
# (コード -> kōdo)). Word boundaries in the corpus files are marked with a
# space in the kana column and become a space in the romaji.
# ---------------------------------------------------------------------------

KANA_ROMAJI = {
    "あ": "a", "い": "i", "う": "u", "え": "e", "お": "o",
    "か": "ka", "き": "ki", "く": "ku", "け": "ke", "こ": "ko",
    "さ": "sa", "し": "shi", "す": "su", "せ": "se", "そ": "so",
    "た": "ta", "ち": "chi", "つ": "tsu", "て": "te", "と": "to",
    "な": "na", "に": "ni", "ぬ": "nu", "ね": "ne", "の": "no",
    "は": "ha", "ひ": "hi", "ふ": "fu", "へ": "he", "ほ": "ho",
    "ま": "ma", "み": "mi", "む": "mu", "め": "me", "も": "mo",
    "や": "ya", "ゆ": "yu", "よ": "yo",
    "ら": "ra", "り": "ri", "る": "ru", "れ": "re", "ろ": "ro",
    "わ": "wa", "を": "o", "ん": "n",
    "が": "ga", "ぎ": "gi", "ぐ": "gu", "げ": "ge", "ご": "go",
    "ざ": "za", "じ": "ji", "ず": "zu", "ぜ": "ze", "ぞ": "zo",
    "だ": "da", "ぢ": "ji", "づ": "zu", "で": "de", "ど": "do",
    "ば": "ba", "び": "bi", "ぶ": "bu", "べ": "be", "ぼ": "bo",
    "ぱ": "pa", "ぴ": "pi", "ぷ": "pu", "ぺ": "pe", "ぽ": "po",
    "ゔ": "vu", "ゐ": "wi", "ゑ": "we",
}
SMALL_Y = {"ゃ": "ya", "ゅ": "yu", "ょ": "yo"}
# after し/ち/じ/ぢ the small kana only supplies the vowel (sha, cho, jo ...)
SMALL_Y_VOWEL = {"ゃ": "a", "ゅ": "u", "ょ": "o"}
SIBILANT = {"shi", "chi", "ji"}
SMALL_VOWEL = {"ぁ": "a", "ぃ": "i", "ぅ": "u", "ぇ": "e", "ぉ": "o"}
MACRON = {"a": "ā", "i": "ī", "u": "ū", "e": "ē", "o": "ō"}


def _to_hiragana(text: str) -> str:
    out = []
    for ch in text:
        code = ord(ch)
        if 0x30A1 <= code <= 0x3096:  # katakana -> hiragana
            out.append(chr(code - 0x60))
        else:
            out.append(ch)
    return "".join(out)


def kana_to_romaji(kana: str) -> str:
    source = _to_hiragana(kana)
    out = []
    last_vowel = None
    double_next = False
    i = 0
    total = len(source)
    while i < total:
        ch = source[i]
        if ch in "ー〜":
            # the long vowel mark lengthens the vowel just written (コード -> kōdo)
            if out and last_vowel:
                out[-1] = out[-1][:-1] + MACRON[last_vowel]
            i += 1
            continue
        if ch == "っ":
            double_next = True
            i += 1
            continue
        if ch in SMALL_Y:
            if out and out[-1] in SIBILANT:
                out[-1] = out[-1][:-1] + SMALL_Y_VOWEL[ch]
            elif out and out[-1].endswith("i"):
                out[-1] = out[-1][:-1] + SMALL_Y[ch]
            else:
                out.append(SMALL_Y[ch])
            i += 1
            continue
        if ch in SMALL_VOWEL:
            if out:
                out[-1] = out[-1][:-1] + SMALL_VOWEL[ch]
            i += 1
            continue
        value = KANA_ROMAJI.get(ch)
        if value is None:
            out.append(" " if ch in "　 \t、。・" else ch)
            last_vowel = None
            i += 1
            continue
        if ch == "ん" and i + 1 < total and _to_hiragana(source[i + 1]) in "ばびぶべぼまみむめもぱぴぷぺぽ":
            value = "m"
        if double_next:
            value = ("t" + value) if value.startswith("ch") else (value[0] + value)
            double_next = False
        out.append(value)
        last_vowel = value[-1] if value[-1] in MACRON else None
        i += 1
    return re.sub(r"\s+", " ", "".join(out)).strip()


SAFE_ID = re.compile(r"[^a-z0-9._-]+")


def clean_id(value: str) -> str:
    value = SAFE_ID.sub("-", value.lower())
    value = re.sub(r"[-_.]+", "-", value).strip("-._")
    return value or "term"


def normalise_term(value: str) -> str:
    """Form-normalised, whitespace-free form used for duplicate detection."""
    return re.sub(r"\s+", "", value.replace("　", "")).lower()


def load_core():
    """The hand-written dataset (everything except the two generated packs)."""
    entries = []
    for path in sorted(VOCAB_DIR.glob("*.json")):
        if path.name in {"extended-generated.json", "corpus-generated.json"}:
            continue
        entries.extend(json.loads(path.read_text(encoding="utf-8")))
    return entries


# ---------------------------------------------------------------------------
# Example-sentence templates.
#
# Each template is (ja, kana, romaji, en) with {term} / {kana} / {romaji} /
# {translation} slots. pick_example() only accepts a template whose finished
# sentence contains the term exactly once, which is what keeps 空所補充 valid.
# ---------------------------------------------------------------------------

GENERIC_EXAMPLES = [
    (
        "先週、{term}の意味を新しい担当者に説明しました。",
        "せんしゅう、{kana}のみみをあたらしいたんとうしゃにせつめいしました。",
        "senshuu, {romaji} no imi o atarashii tantousha ni setsumei shimashita.",
        "Last week I explained the meaning of {translation} to a new colleague.",
    ),
    (
        "資料によって{term}の書き方がバラバラなので、表記を揃えることにしました。",
        "しりょうによって{kana}のかきかたがばらばらなので、ひょうきをそろえることにしました。",
        "shiryou ni yotte {romaji} no kakikata ga barabara na no de, hyouki o soroeru koto ni shimashita.",
        "Documents write {translation} in different ways, so we decided to standardise the notation.",
    ),
    (
        "システム導入の打ち合わせで、{term}をどの画面で扱うか決めました。",
        "システム導入の打ち合わせで、{kana}をどの画面で扱うか決めました。",
        "shisutemu dounyuu no uchiawase de, {romaji} o dono gamen de atsukau ka kimemashita.",
        "In the system rollout meeting we decided which screen handles {translation}.",
    ),
    (
        "確認したところ、{term}の手続きには追加の書類が必要でした。",
        "かくにんしたところ、{kana}のてつづきにはついかのしょるいがひつようでした。",
        "kakunin shita tokoro, {romaji} no tetsuzuki ni wa tsuika no shorui ga hitsuyou deshita.",
        "It turned out that the procedure for {translation} needs additional documents.",
    ),
]

CATEGORY_EXAMPLES = {
    "contract-fundamentals": [
        (
            "契約のしくみを説明する資料に、{term}の章を新たに追加しました。",
            "けいやくのしくみをせつめいするしりょうに、{kana}のしょうをあらたについかしました。",
            "keiyaku no shikumi o setsumei suru shiryou ni, {romaji} no shou o arata ni tsuika shimashita.",
            "I added a new section on {translation} to the document that explains how the contract works.",
        ),
        (
            "契約書を確認すると、{term}についての記載が見つかりませんでした。",
            "けいやくしょうをかくにんすると、{kana}についてのきさいがみつかりませんでした。",
            "keiyakushou o kakunin suru to, {romaji} ni tsuite no kisai ga mitsukarimasen deshita.",
            "When I checked the policy document I could not find any wording about {translation}.",
        ),
        (
            "代理店から、{term}をお客様にどう説明すべきか相談がありました。",
            "だいりてんから、{kana}をおきゃくさまにどうせつめいすべきかそうだんがありました。",
            "dairiten kara, {romaji} o okyaku-sama ni dou setsumei subeki ka soudan ga arimashita.",
            "The agency asked how they should explain {translation} to the customer.",
        ),
        (
            "会社によって{term}の呼び名が違うため、定義の資料を共有しています。",
            "かいしゃによって{kana}のよびなががちがうため、ていぎのしりょうをきょうゆうしています。",
            "kaisha ni yotte {romaji} no yobina ga chigau tame, teigi no shiryou o kyouyuu shite imasu.",
            "Companies use different names for {translation}, so we share a definition sheet.",
        ),
    ],
    "life-benefits": [
        (
            "約款では、{term}が支払われる条件と支払われない条件が分けて書かれています。",
            "やっかんでは、{kana}がしはらわれるじょうけんとしはらわれないじょうけんがわけてかかれています。",
            "yakkan de wa, {romaji} ga shiharawareru jouken to shiharawarenai jouken ga wakete kakarete imasu.",
            "The policy conditions separate the cases where {translation} is paid from the cases where it is not.",
        ),
        (
            "契約者から、{term}を受け取るための手続きを教えてくださいという問い合わせがありました。",
            "けいやくしゃから、{kana}をうけとるためのてつづきを教えてくださいというといあわせがありました。",
            "keiyakusha kara, {romaji} o uketoru tame no tetsuzuki o oshiete kudasai to iu toiawase ga arimashita.",
            "A policyholder asked which procedure is needed to receive {translation}.",
        ),
        (
            "給付のしおりには、{term}の支払金額を求める計算例が載っています。",
            "きゅうふのしおりには、{kana}のしはらいきんがくをもとめるけいさんれいがのっています。",
            "kyuufu no shiori ni wa, {romaji} no shiharai kigaku o motomeru keisan-rei ga notte imasu.",
            "The benefit booklet contains worked examples that calculate {translation}.",
        ),
        (
            "保険料の払込をやめると、{term}の金額が変わることに注意してください。",
            "ほけんりょうのはらこめをやめると、{kana}のきんがくがかわることにちゅういしてください。",
            "hokenryou no harakomi o yameru to, {romaji} no kigaku ga kawaru koto ni chuui shite kudasai.",
            "If premium payments stop, the amount of {translation} changes as well.",
        ),
    ],
    "contract-lifecycle": [
        (
            "手続きが遅れると{term}に影響が出るため、受付日は厳しく管理しています。",
            "てつづきがおくれると{kana}にえいきょうがでるため、うけつけびはげしくかんりしています。",
            "tetsuzuki ga okureru to {romaji} ni eikyou ga deru tame, uketsukebi wa hageshiku kanri shite imasu.",
            "Delays affect {translation}, so we watch the acceptance date closely.",
        ),
        (
            "{term}の受付可否は、申込日と責任開始日の関係で決まります。",
            "{kana}のうけつけかひは、もうしこみびとせきにんかいしびのかんけいできまります。",
            "{romaji} no uketsuke kahi wa, moshikomibi to sekinin kaishibi no kankei de kimarimasu.",
            "Whether a {translation} is accepted depends on how the application date and the inception date line up.",
        ),
        (
            "お客様から{term}をしたいという連絡があり、必要な書類をお送りしました。",
            "おきゃくさまから{kana}をしたいというれんらくがあり、ひつようなしょるいをおくりしました。",
            "okyaku-sama kara {romaji} o shitai to iu renraku ga ari, hitsuyou na shorui o okuri shimashita.",
            "A customer wrote to ask for {translation}, so we sent the documents required.",
        ),
        (
            "システムでは{term}の履歴が残り、担当者がいつでも参照できます。",
            "システムでは{kana}のりれきでのこります、たんとうしゃがつねにさんしょうできます。",
            "shisutemu de wa {romaji} no rireki ga nokorimasu, tantousha ga tsune ni sanshou dekimasu.",
            "The system keeps the history of {translation}, so any handler can look it up.",
        ),
    ],
    "underwriting": [
        (
            "引受査定では、{term}に該当する項目があると追加の確認が必要です。",
            "ひきうけさてんでは、{kana}にがとうするもくこうがあるついかのかくにんがひつようです。",
            "hikuke saten de wa, {romaji} ni gatou suru moukoku ga aru tsuika no kakunin ga hitsuyou desu.",
            "In underwriting, an item matching {translation} triggers an extra check.",
        ),
        (
            "申込画面では、{term}に該当する質問が順番に表示されます。",
            "もうしこみがめんでは、{kana}にがとうするしつもんがじゅんじょにひょうじされます。",
            "moshikomi gamen de wa, {romaji} ni gatou suru shitsumon ga junjo ni hyouji saremasu.",
            "The application screen shows the questions related to {translation} in order.",
        ),
        (
            "査定担当者に聞くと、{term}を理由に引き受けられない場合があるとのことでした。",
            "さてんたんとうしゃにきくと、{kana}をりゆうにひきうけられないばあいがあるとのことでした。",
            "saten tantousha ni kiku to, {romaji} o riyuu ni hikiukerarenai baai ga aru to no koto deshita.",
            "The assessor said that a risk can be declined because of {translation}.",
        ),
        (
            "引受基準のマニュアルには、{term}の判断例がいくつか載っています。",
            "ひきうけきじゅんのマニュアルには、{kana}のはんだんれいがいくつかのっています。",
            "hikuke kijun no manyuaru ni wa, {romaji} no handan-rei ga ikutsuka notte imasu.",
            "The underwriting manual lists examples of how {translation} is judged.",
        ),
    ],
    "claims-payment": [
        (
            "請求書類に不備があったため、{term}の処理が止まったままになっています。",
            "せいきゅうしょるいにふびがあったため、{kana}のしょりがとまったままになっています。",
            "seikyuu shorui ni fubi ga atta tame, {romaji} no shori ga tomatta mama ni natte imasu.",
            "Because the claim documents were incomplete, processing of {translation} is stuck.",
        ),
        (
            "支払査定では、{term}を確認してから支払う金額を決めます。",
            "しはらいさてんでは、{kana}をかくにんしてからしはらうきんがくをきめます。",
            "shiharai saten de wa, {romaji} o kakunin shite kara shiharau kigaku o kimemasu.",
            "In claims assessment the amount paid is decided after checking {translation}.",
        ),
        (
            "お客様に、{term}の結果を電話でお伝えしました。",
            "おきゃくさまに、{kana}のけっかをでんわでおつたえしました。",
            "okyaku-sama ni, {romaji} no kekka o denwa o otsutae shimashita.",
            "I told the customer the outcome of {translation} by telephone.",
        ),
        (
            "システムでは{term}の状態をステータスで管理し、変更のたびに記録が残ります。",
            "システムでは{kana}のじょうたいをステータスで管理し、変更のたびに記録が残ります。",
            "shisutemu de wa {romaji} no juutai o suteetasu de kanri shi, henkou no tabi ni kiroku ga nokorimasu.",
            "The system tracks the status of {translation} and records every change.",
        ),
    ],
    "products-coverage": [
        (
            "この商品のパンフレットでは、{term}が最も目立つ位置に書かれています。",
            "この商品のパンフレットでは、{kana}がもっともめだついちにかかれています。",
            "kono shouhin no panfuretto de wa, {romaji} ga mottomo medatsu ichi ni kakarete imasu.",
            "The leaflet for this product puts {translation} in the most prominent place.",
        ),
        (
            "保障を比較する表を作り、{term}の違いを並べました。",
            "保障を比較する表を作り、{kana}のちがいをならべました。",
            "hoshou o hikaku suru hyou o tsukuri, {romaji} no chigai o narabemashita.",
            "I built a comparison table and lined up the differences in {translation}.",
        ),
        (
            "約款の「{term}」の条項には、支払われない場合の例が並んでいます。",
            "やっかんのかぎょうしょう「{kana}」のじょうこうには、しはらわれないばあいのれいがならんでいます。",
            "yakkan no kagyou-shou \u300c{romaji}\u300d no joukou ni wa, shiharawarenai baai no rei ga narande imasu.",
            "The clause about {translation} lists the cases where nothing is paid.",
        ),
        (
            "お客様から「{term}は付いていますか」と質問されました。",
            "おきゃくさまから「{kana}はついていますか」としつもんされました。",
            "okyaku-sama kara \u300c{romaji} wa tsuite imasu ka\u300d to shitsumon saremashita.",
            "A customer asked whether {translation} is included.",
        ),
    ],
    "kyosai": [
        (
            "共済では、保険と同じ仕組みを{term}という名前で呼んでいます。",
            "共済では、保険と同じ仕組みを{kana}という名前で呼んでいます。",
            "kyousai de wa, hoken to onaji shikumi o {romaji} to iu namae de yonde imasu.",
            "Kyosai calls the mechanism that insurance writes up as {translation} by a different name.",
        ),
        (
            "共済のしおりの用語集で、{term}に対応する保険の用語を調べました。",
            "共済のしおりの用語集で、{kana}に対応する保険の用語を調べました。",
            "kyousai no shiori no yougo-shuu de, {romaji} ni taiou suru hoken no yougo o shirabemashita.",
            "I looked up the insurance word that corresponds to {translation} in the kyosai glossary.",
        ),
        (
            "共済組合の総会で、{term}の運用について説明がありました。",
            "共済組合の総会で、{kana}のうんようについてせつめいがありました。",
            "kyousai kumiai no soukai de, {romaji} no unyou ni tsuite setsumei ga arimashita.",
            "The members' meeting explained how {translation} is operated.",
        ),
        (
            "共済のシステムは、{term}の項目名を保険の用語とは別に持っています。",
            "共済のシステムは、{kana}の項目名を保険の用語とは別に持っています。",
            "kyousai no shisutemu wa, {romaji} no moukou-mei o hoken no yougo to betsu ni motte imasu.",
            "The kyosai system keeps its own field name for {translation}, separate from the insurance word.",
        ),
    ],
    "insurance-it": [
        (
            "テストケースでは、{term}に不正な値を入力した場合の手順を確認します。",
            "テストケースでは、{kana}にせいじなあちを入力したばあいの手順を確認します。",
            "tesuto keesu de wa, {romaji} ni seiji na atai o nyuuryoku shita baai no tejun o kakunin shimasu.",
            "The test cases cover what happens when an invalid value is entered for {translation}.",
        ),
        (
            "画面設計書には、{term}の入力桁数とエラーメッセージが書かれています。",
            "画面設計書には、{kana}の入力桁数とエラーメッセージが書かれています。",
            "gamen setkei-sho ni wa, {romaji} no nyuuryoku ketasu to eraa messeeji ga kakarete imasu.",
            "The screen specification states the field length and the error message for {translation}.",
        ),
        (
            "運用の引き継ぎ資料に、{term}の処理が失敗した場合の対応をまとめました。",
            "運用の引き継ぎ資料に、{kana}の処理が失敗した場合の対応をまとめました。",
            "unyou no hikitsugi shiryou ni, {romaji} no shori ga shippai shita baai no taiou o matimemashita.",
            "The operations hand-over document describes what to do when {translation} fails.",
        ),
        (
            "本番移行の前日に、{term}に関する設定をすべて確認しました。",
            "ほんばんいこうのまえびに、{kana}に関する設定をすべて確認しました。",
            "honban ikou no mae-bi ni, {romaji} ni kansuru settei o subete kakunin shimashita.",
            "The day before the go-live we checked every setting related to {translation}.",
        ),
    ],
}

CONTEXT_NOTES = {
    "contract-fundamentals": "Contract parties, policy documents and the wording every other insurance domain builds on.",
    "life-benefits": "Life and health benefits: what is paid, when it is paid and how the amount is worked out.",
    "contract-lifecycle": "New business, renewal, lapse, reinstatement and the change procedures that appear on screens.",
    "underwriting": "Disclosure, underwriting criteria, risk selection and the outcome of the assessment.",
    "claims-payment": "Claim intake, assessment, documents, deficiencies and payment.",
    "products-coverage": "Product types, coverage scope, riders and exclusions.",
    "kyosai": "Kyosai (mutual aid) wording and the insurance words it corresponds to.",
    "insurance-it": "Screen fields, batch jobs, interfaces, testing and incident handling in insurance systems.",
}


def pick_example(category: str, term: str, kana: str, romaji: str, translation: str, salt: int = 0):
    """Pick the first template whose sentence contains the term exactly once."""
    pool = CATEGORY_EXAMPLES.get(category, []) + GENERIC_EXAMPLES
    if not pool:
        return None
    start = (sum(ord(c) for c in term) + salt) % len(pool)
    plain_kana = kana.replace(" ", "")
    for offset in range(len(pool)):
        ja, ka, ro, en = pool[(start + offset) % len(pool)]
        sentence = ja.format(term=term)
        if sentence.count(term) != 1:
            continue
        return {
            "ja": sentence,
            "kana": ka.format(kana=plain_kana),
            "romaji": ro.format(romaji=romaji),
            "translation": en.format(translation=translation),
        }
    return None

# ---------------------------------------------------------------------------
# Curated term corpus (scripts/term_corpus/*.tsv)
#
# Tab-separated, one term per line:
#   term  kana  translation  definitionJa  category  subcategory  difficulty
#   domains  confusable(|-separated)  note  sourceUrl  verification
# The first eight columns are required; the last four are optional.
# A space in the kana column marks a word boundary and becomes a space in the
# romaji; the stored kana itself has no spaces.
# ---------------------------------------------------------------------------

CORPUS_COLUMNS = [
    "term", "kana", "translation", "definitionJa", "category",
    "subcategory", "difficulty", "domains", "confusable", "note",
    "sourceUrl", "verification",
]


def load_corpus():
    rows = []
    if not CORPUS_DIR.exists():
        return rows
    for path in sorted(CORPUS_DIR.glob("*.tsv")):
        for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if not line.strip() or line.lstrip().startswith("#"):
                continue
            cells = [c.strip() for c in line.split("\t")]
            if len(cells) < 8:
                raise SystemExit(f"{path.name}:{lineno}: expected 8-{len(CORPUS_COLUMNS)} tab-separated columns, got {len(cells)}")
            if len(cells) > len(CORPUS_COLUMNS):
                raise SystemExit(f"{path.name}:{lineno}: too many tab-separated columns, expected at most {len(CORPUS_COLUMNS)}")
            cells += [""] * (len(CORPUS_COLUMNS) - len(cells))
            row = dict(zip(CORPUS_COLUMNS, cells[: len(CORPUS_COLUMNS)]))
            for field in ("term", "kana", "translation", "definitionJa", "category", "difficulty", "domains"):
                if not row[field]:
                    raise SystemExit(f"{path.name}:{lineno}: empty required column '{field}'")
            if row["category"] not in VALID_CATEGORIES:
                raise SystemExit(f"{path.name}:{lineno}: unknown category {row['category']!r}")
            if row["difficulty"] not in VALID_DIFFICULTIES:
                raise SystemExit(f"{path.name}:{lineno}: unknown difficulty {row['difficulty']!r}")
            if row.get("verification") and row["verification"] not in VALID_VERIFICATIONS:
                raise SystemExit(f"{path.name}:{lineno}: unknown verification {row['verification']!r}")
            if row.get("sourceUrl") and not row["sourceUrl"].startswith(("http://", "https://")):
                raise SystemExit(f"{path.name}:{lineno}: sourceUrl must be an http(s) URL")
            domains = [d.strip() for d in row["domains"].split(",") if d.strip()]
            unknown = [d for d in domains if d not in VALID_DOMAINS]
            if unknown:
                raise SystemExit(f"{path.name}:{lineno}: unknown domain(s) {unknown}")
            row["domains"] = domains
            row["subcategory"] = row["subcategory"] or row["category"]
            row["confusables"] = [c.strip() for c in row["confusable"].split("|") if c.strip()]
            row["source"] = f"{path.name}:{lineno}"
            rows.append(row)
    return rows


def fold_ascii(value: str) -> str:
    import unicodedata

    return "".join(c for c in unicodedata.normalize("NFKD", value) if not unicodedata.combining(c))


def make_id(romaji: str, fallback: str, taken) -> str:
    base = clean_id(fold_ascii(romaji))[:60] or clean_id(fallback)
    candidate = base
    counter = 2
    while candidate in taken:
        candidate = f"{base}-{counter}"
        counter += 1
    taken.add(candidate)
    return candidate


def distinction_text(a, b) -> str:
    return (
        f"{a['term']} refers to {a['translation']}; {b['term']} refers to {b['translation']}. "
        f"Definitions differ: {a['definitionJa']} / {b['definitionJa']}"
    )


def explanation_for(row, term: str, kana: str, romaji: str) -> str:
    category_en, _ = CATEGORY_LABELS[row["category"]]
    extra = f" {row['note']}" if row.get("note") else ""
    meaning = row["translation"]
    meaning = meaning[0].upper() + meaning[1:]
    return (
        f"{meaning} belongs to the {category_en} area, sub-area {row['subcategory']} "
        f"(Japanese: {term} / {kana} / {romaji}). The Japanese definition in this entry is the working "
        "definition used by the quiz; insurers and system vendors do not always use the same wording, so "
        f"confirm it in the 約款 or the 画面設計書 you are working with.{extra}"
    )


def build_corpus_entries(rows, core, taken_ids, taken_terms):
    """Turn corpus rows into full entries plus a term -> entry index."""
    entries = []
    index = {}
    for entry in core:
        index.setdefault(normalise_term(entry["term"]), entry)
    for row in rows:
        term = row["term"]
        key = normalise_term(term)
        if key in taken_terms or key in index:
            continue
        kana_spaced = row["kana"]
        kana = kana_spaced.replace(" ", "")
        romaji = kana_to_romaji(kana_spaced)
        example = pick_example(row["category"], term, kana, romaji, row["translation"])
        if example is None:
            print(f"skipped (no usable example sentence): {row['source']} {term}", file=sys.stderr)
            continue
        entry_id = make_id(romaji, term, taken_ids)
        taken_terms.add(key)
        verification = row.get("verification") or "industry-standard"
        source_url = row.get("sourceUrl") or ""
        if source_url and verification == "verified":
            verification_note = (
                f"Headword, reading and Japanese definition checked against {source_url}; "
                "the example sentence and the English explanation are assembled by "
                "scripts/generate_extended_vocabulary.py."
            )
        else:
            verification_note = (
                "Headword, reading and Japanese definition curated from public industry glossaries and "
                "standard practice; the example sentence and the English explanation are assembled by "
                "scripts/generate_extended_vocabulary.py."
            )
        entry = {
            "id": entry_id,
            "term": term,
            "kana": kana,
            "romaji": romaji,
            "translation": row["translation"],
            "definitionJa": row["definitionJa"],
            "explanationEn": explanation_for(row, term, kana, romaji),
            "category": row["category"],
            "subcategory": row["subcategory"],
            "difficulty": row["difficulty"],
            "domains": row["domains"],
            "example": example,
            "context": CONTEXT_NOTES[row["category"]],
            "confusedTerms": [],
            "relatedTerms": [],
            "verification": verification,
            "verificationNote": verification_note,
            "tags": list(
                dict.fromkeys(
                    ["generated", "corpus-pack", row["category"], clean_id(row["subcategory"]), row["source"]]
                )
            )[:30],
        }
        if source_url:
            entry["sourceUrl"] = source_url
        entries.append(entry)
        index[key] = entry
    return entries, index


def link_confusables(entries, index, explicit):
    """Attach confusable notes: the pairs named in the corpus first, then similar siblings."""
    by_subcategory = defaultdict(list)
    for entry in entries:
        by_subcategory[(entry["category"], entry["subcategory"])].append(entry)

    def words(entry):
        return {w for w in fold_ascii(entry["translation"]).lower().split() if len(w) > 3}

    for entry in entries:
        partners = []
        for name in explicit.get(normalise_term(entry["term"]), []):
            partner = index.get(normalise_term(name))
            if partner and partner["id"] != entry["id"]:
                partners.append(partner)
        if not partners:
            siblings = [
                other
                for other in by_subcategory[(entry["category"], entry["subcategory"])]
                if other["id"] != entry["id"] and words(other) & words(entry)
            ]
            siblings.sort(key=lambda o: (-len(words(o) & words(entry)), o["id"]))
            partners = siblings[:2]
        for partner in partners[:3]:
            entry["confusedTerms"].append(
                {
                    "term": partner["term"],
                    "reading": partner["kana"],
                    "termId": partner["id"],
                    "distinction": distinction_text(entry, partner),
                }
            )
            entry["relatedTerms"].append(partner["id"])
        entry["relatedTerms"] = list(dict.fromkeys(entry["relatedTerms"]))[:20]


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

def make_entry(base, suffix):
    suffix_id, suffix_term, suffix_kana, suffix_romaji, suffix_translation = suffix
    term = f"{base['term']}{suffix_term}"
    kana = f"{base['kana']}{suffix_kana}"
    romaji = f"{base['romaji']} {suffix_romaji}"
    translation = f"{base['translation']} {suffix_translation}"
    entry_id = f"{base['id']}-{suffix_id}"
    if len(entry_id) > 80:
        entry_id = clean_id(entry_id[:70] + "-" + suffix_id)

    example = pick_example(base["category"], term, kana, romaji, translation) or {
        "ja": f"このデモでは{term}を扱います。",
        "kana": f"このでもでは{kana}をあつかいます。",
        "romaji": f"kono demo de wa {romaji} o atsukaimasu.",
        "translation": f"In this demo, the system handles {translation}.",
    }

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
        "example": example,
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


def write_pack(path, entries):
    path.write_text(json.dumps(entries, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def apply_limits(entries, total_limit, per_category_limit):
    """Trim the corpus pack without dropping whole categories."""
    if total_limit <= 0 and per_category_limit <= 0:
        return entries
    queues = defaultdict(list)
    for entry in entries:
        queues[entry["category"]].append(entry)
    if per_category_limit > 0:
        for category in list(queues):
            queues[category] = queues[category][:per_category_limit]
    if total_limit <= 0:
        out = []
        for category in sorted(queues):
            out.extend(queues[category])
        return out
    out = []
    while len(out) < total_limit and any(queues.values()):
        for category in sorted(queues):
            if not queues[category]:
                continue
            out.append(queues[category].pop(0))
            if len(out) >= total_limit:
                break
    return out


def build_screen_field_pack(core, taken_terms, taken_ids, per_category, total_limit):
    """Combinatorial 画面項目 / 業務操作 patterns over the hand-written core entries."""
    by_category = defaultdict(list)
    for entry in core:
        by_category[entry["category"]].append(entry)
    counts = defaultdict(int)
    generated = []
    categories = sorted(by_category)
    while True:
        progressed = False
        for category in categories:
            if per_category > 0 and counts[category] >= per_category:
                continue
            if total_limit > 0 and len(generated) >= total_limit:
                return generated
            for base in by_category[category]:
                if per_category > 0 and counts[category] >= per_category:
                    break
                if total_limit > 0 and len(generated) >= total_limit:
                    return generated
                for suffix in SUFFIXES:
                    suffix_term = suffix[1]
                    if suffix_term in base["term"]:
                        continue
                    entry = make_entry(base, suffix)
                    key = normalise_term(entry["term"])
                    if key in taken_terms or entry["id"] in taken_ids:
                        continue
                    generated.append(entry)
                    taken_terms.add(key)
                    taken_ids.add(entry["id"])
                    counts[category] += 1
                    progressed = True
                    if (per_category > 0 and counts[category] >= per_category) or (
                        total_limit > 0 and len(generated) >= total_limit
                    ):
                        break
        if not progressed:
            return generated


def main():
    parser = argparse.ArgumentParser(
        description="build the generated vocabulary packs (curated corpus + screen-field patterns)"
    )
    parser.add_argument("--total", type=int, default=0, help="cap on generated entries in total (0 = no cap)")
    parser.add_argument("--per-category", type=int, default=0, help="cap on generated entries per category (0 = no cap)")
    parser.add_argument(
        "--screen-field-per-category",
        type=int,
        default=150,
        help="how many 画面項目 patterns to build per category (0 = skip that pack, -1 = no cap)",
    )
    parser.add_argument("--all", action="store_true", help="no caps at all: write everything that can be built")
    parser.add_argument("--no-corpus", action="store_true", help="skip the curated corpus pack")
    parser.add_argument("--no-screen-field", action="store_true", help="skip the screen-field pack")
    args = parser.parse_args()

    if args.all:
        args.total = 0
        args.per_category = 0
        args.screen_field_per_category = -1

    core = load_core()
    taken_ids = {entry["id"] for entry in core}
    taken_terms = {normalise_term(entry["term"]) for entry in core}

    corpus_entries = []
    if not args.no_corpus:
        rows = load_corpus()
        explicit = defaultdict(list)
        for row in rows:
            if row["confusables"]:
                explicit[normalise_term(row["term"])].extend(row["confusables"])
        corpus_entries, index = build_corpus_entries(rows, core, taken_ids, taken_terms)
        link_confusables(corpus_entries, index, explicit)
        corpus_entries = apply_limits(corpus_entries, args.total, args.per_category)
        write_pack(CORPUS_OUTPUT, corpus_entries)

    screen_field = []
    if not args.no_screen_field and args.screen_field_per_category != 0:
        remaining = 0 if args.total <= 0 else max(0, args.total - len(corpus_entries))
        per_category = 0 if args.screen_field_per_category < 0 else args.screen_field_per_category
        screen_field = build_screen_field_pack(core, taken_terms, taken_ids, per_category, remaining)
        write_pack(SCREEN_FIELD_OUTPUT, screen_field)

    counts = defaultdict(int)
    for entry in core + corpus_entries + screen_field:
        counts[entry["category"]] += 1
    total = len(core) + len(corpus_entries) + len(screen_field)
    print(f"core={len(core)} corpus={len(corpus_entries)} screen-field={len(screen_field)} total={total}")
    for path, entries in ((CORPUS_OUTPUT, corpus_entries), (SCREEN_FIELD_OUTPUT, screen_field)):
        if entries:
            print(f"wrote {len(entries)} entries -> {path.relative_to(ROOT)}")
    for category in sorted(counts):
        print(f"{category}: {counts[category]}")


if __name__ == "__main__":
    main()

