# 用語の出典と検証方針 / Terminology sources & verification policy

このアプリの用語は、保険実務・保険IT実務で使われる語を JLPT N3–N2 レーンの学習者が
扱えるように整理したものです。保険の呼称は会社・システムごとに異なるため、各語に
**検証段階**を付けています。

Terminology in this app is organised for learners at an N3–N2 bridge level. Because
insurance wording differs between companies and systems, every entry carries a
verification level.

---

## Verification levels

| Level | 表示 | Assigned when |
| --- | --- | --- |
| `verified` | source checked | the wording was checked against the public page cited in that entry's `sourceUrl` |
| `industry-standard` | industry usage | the term and its explanation match normal professional usage and the general references below, but are not tied to one specific page |
| `review-needed` | 要確認 / wording varies | insurers, agents or systems label the thing differently, or the boundary between two terms is defined by a company's own rules — check the documentation of the organisation you are working with |

Current distribution over the **5175** built-in entries: **84 verified**, **1535
industry-standard**, **3556 review-needed**. The 3531 generated screen-field entries are all
review-needed by design. The level is shown as a pill on every entry and
in the vocabulary list, so you always know how much to trust a given wording. These counts
are produced by the generator and change when corpus files change; see `context.md` for the
counting command.

## Sources consulted

| Source | Used for |
| --- | --- |
| <https://www.ja-kyosai.or.jp/words/> (JA共済用語集) | the whole `kyosai` category: 共済掛金, 共済金額, 共済証書, 記名被共済者, 特則, 払いもどし金, 返れい金, 払済, 責任開始日, 始期日, 等級, 事故有係数適用期間, 時価/新価共済契約 — headword, reading and definition were read on the cited page of each entry |
| <https://github.com/code4fukui/ipsj-words> (`ipsj-words-ver.1.0_2024-4-10.csv`) | general IT terminology: データベース, テーブル, レコード, フィールド, 主キー, 文字コード, 暗号化, 認証, 機密性, 完全性, 可用性 (definitions as published), plus the headwords 外部キー, トランザクション, 全角, 半角, 要件定義, 単体テスト, 回帰テスト |
| <https://ja.wikipedia.org/wiki/保険> | 保険契約, 保険契約者, 保険者 |
| <https://ja.wikipedia.org/wiki/生命保険> | 定期保険, 終身保険, 養老保険, 解約返戻金, 責任準備金, 危険選択 |
| <https://www.sonpo.or.jp/wakaru/word/> (日本損害保険協会 保険の用語集) | general non-life and contract concepts such as アンダーライティング, 解除, 取消し, 無効, 免責事由, 被保険利益, 保険料即収の原則, 大数の法則, 逆選択, モラルリスク |
| <https://www.hoholine.com/guide/dictionary/dictionary/> (保険ほっとライン 保険の用語集) | life-insurance and policy-service terms such as 頭金, 一時払い, 一括払い, 延長保険, 契約者貸付, 契約応当日, 更新型, 高度障害保険金, 告知義務違反 |
| <https://faq.sompo-japan.jp/insglossary> (損保ジャパン 用語集) | non-life claim and automobile-liability terms such as 逸失利益, 運行供用者, 運行供用者責任, 医学的他覚所見, 一般勘定 |
| <https://www.meijiyasuda.co.jp/words/> (明治安田 用語集) | life-insurance premium terms such as 一時投入保険料 |

### Licensing of the IPSJ terminology

The IT terms come from the 情報処理学会 情報科学テキスト用語集 (Information Processing
Society of Japan, Information Science Textbook Terminology List), compiled by the IPSJ
Information Entrance Examination Committee and redistributed as a CSV in
`code4fukui/ipsj-words`. The terminology data is **CC BY-SA 4.0**; the repository itself
is MIT. Definitions for entries marked `verified` in that group follow the published
wording; entries whose CSV row is a headword **without** a definition (外部キー,
トランザクション, 全角, 半角, 要件定義, 単体テスト, 回帰テスト) are marked
`industry-standard` and say so in their `verificationNote` — the term is sourced, the
wording of the explanation is ours.

### The JA共済用語集

The 共済 entries are read from the published glossary pages of 全国共済農業協同組合連合会
(JA共済). Each entry links to the exact page it was taken from, and the pair notes explain
how the kyosai word maps onto the insurance word a learner already knows (共済掛金 ↔
保険料, 共済金額 ↔ 保険金額, 共済証書 ↔ 保険証券, 払いもどし金 ↔ 解約返戻金, 特則 vs
特約). Where a word is used across JA共済 materials but has no glossary page of its own
(for example the bare 共済金), the entry is marked `industry-standard` and the note says
why.

Everything not covered by those four sources is written from general professional knowledge
of Japanese insurance and insurance-IT work and is marked `industry-standard` or
`review-needed` accordingly — deliberately **not** given a citation, because a citation you
have not actually read for that specific wording is worse than no citation.

For legal boundaries the underlying concepts come from 保険業法 and 商法 保険編, but this
app does not attempt to be a legal reference; where a definition would need the statute to
be precise, the entry is marked `review-needed` and describes how the term is used in
practice instead.

## Why so many entries are `review-needed`

Insurance Japanese is not standardised across the industry. Typical examples in this
dataset:

- **生保と損保で呼称が違う** — the same functional idea is named differently in life and
  non-life systems (the `domainNote` field records this where it matters).
- **会社独自の画面項目名** — screen-field wording in 保険IT (照会, 取込, 取次, 受付番号,
  契約者番号 …) follows the individual system's specification, not an industry standard.
- **境界が運用で決まる語** — whether something counts as 簡易審査 vs 引受査定, or
  差戻し vs 却下, is decided by a company's process documentation.

Marking those as 要確認 is the honest option: the entry still teaches you the word and how
it behaves in real sentences, but it tells you to check the local definition before relying
on it at work.

## Challenging or correcting an entry

If a wording is wrong for your context, that is useful information, not a bug in your
understanding. Please:

1. open the entry in 用語一覧 and note its `id` (shown under the entry title);
2. compare it with the term used in your own company's screens or documents;
3. if you maintain the dataset, change the JSON in `src/data/vocabulary/` and run
   `npm test` — the schema and question-generator tests will tell you if the change breaks
   a question mode;
4. if the correction needs a source, put the URL in `sourceUrl` and set
   `verification: "verified"`; if the disagreement is because companies differ, set
   `review-needed` and write the difference in `verificationNote`.

## Generated corpus and screen-field packs

The generated packs are not capped at 1000 entries. `scripts/generate_extended_vocabulary.py`
reads every TSV file in `scripts/term_corpus/` and writes:

- `src/data/vocabulary/corpus-generated.json` from curated corpus rows, including
  web-sourced rows such as `scripts/term_corpus/web-glossaries.tsv`;
- `src/data/vocabulary/extended-generated.json` from systematic screen-field and operation
  patterns built from the hand-written core entries (e.g. `契約者` + `情報`, `証券番号` +
  `照会`, `引受査定` + `履歴`).

Run `npm run generate:vocabulary` or
`python3 scripts/generate_extended_vocabulary.py --all` to write everything currently
available. The current committed counts are 1465 corpus entries and 3531 screen-field
entries, but those numbers are expected to grow as more sourced TSV rows are added.

Because the exact wording of generated screen fields is company-specific, every generated
screen-field entry is marked `review-needed` and carries a note telling the learner to
confirm the wording in the target company's specification. The generator deliberately does
not invent a source URL for screen-field patterns. Web-sourced corpus rows may carry
`sourceUrl` and `verification` columns; use `verified` only when the row was checked against
the cited page.


You can also keep your preferred wording entirely private: add it as your own term in
用語一覧 → ＋ 自分の用語を追加. Your terms are stored locally, are used by the question
generator, and travel with your JSON backup.

## Not legal or contractual advice

Nothing in this app is legal advice, and no entry is an official definition from any
insurer, agent, or government body. For anything that affects a contract, a claim, or a
regulatory obligation, use the actual policy documents, the 約款, and the applicable
statutes.
