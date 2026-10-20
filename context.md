# Project context / 文脈管理メモ

This file is intentionally short. It exists so future agents do not need to read the
large generated vocabulary JSON files just to understand the project. Read this first,
then inspect only the specific file or line range needed for the task.

## What this project is

ほけんご / Hokengo is a local-first browser trainer for Japanese insurance and
insurance-IT terminology. The app loads built-in vocabulary from `src/data/vocabulary/*.json`,
validates it through `src/lib/schema.ts`, and generates four-choice questions through
`src/lib/questionGenerator.ts`.

## Current dataset shape

Do **not** treat 1000 as a target or cap. The current built-in dataset is generated from
multiple sources and is intentionally extensible.

Current committed counts after running:

```bash
python3 scripts/generate_extended_vocabulary.py --all
```

- total built-in entries: **5175**
- hand-written core entries: **179**
- curated corpus entries: **1465**
- generated screen-field entries: **3531**

Category counts:

| Category | Entries |
| --- | ---: |
| claims-payment | 504 |
| contract-fundamentals | 509 |
| contract-lifecycle | 562 |
| insurance-it | 1403 |
| kyosai | 494 |
| life-benefits | 562 |
| products-coverage | 730 |
| underwriting | 411 |

Verification counts:

| Verification | Entries |
| --- | ---: |
| verified | 84 |
| industry-standard | 1535 |
| review-needed | 3556 |

These numbers change whenever corpus TSV files or generator templates change. Use the
generator output or the counting command below instead of trusting this table forever.

## How to expand terminology without overflowing context

The safe workflow is:

1. Add or edit rows in `scripts/term_corpus/*.tsv`.
2. Run the generator with no cap:
   ```bash
   python3 scripts/generate_extended_vocabulary.py --all
   ```
3. Run tests:
   ```bash
   npm test
   ```
4. Update this file only with counts and source notes, not with term lists.

Useful counting command:

```bash
python3 - <<'PY'
import json, glob, collections
files = glob.glob('src/data/vocabulary/*.json')
total = 0
cats = collections.Counter()
ver = collections.Counter()
for p in files:
    data = json.load(open(p))
    total += len(data)
    for e in data:
        cats[e['category']] += 1
        ver[e.get('verification', 'unset')] += 1
print('total', total)
print('categories', dict(sorted(cats.items())))
print('verification', dict(sorted(ver.items())))
PY
```

Do not read `src/data/vocabulary/corpus-generated.json` or
`src/data/vocabulary/extended-generated.json` into agent context unless you are debugging
a specific entry. They are large generated files. Use `rg`, `jq`, or a small Python script
to inspect them.

## Corpus TSV format

`scripts/generate_extended_vocabulary.py` reads every `scripts/term_corpus/*.tsv` file.

Columns:

```text
term	kana	translation	definitionJa	category	subcategory	difficulty	domains	confusable	note	sourceUrl	verification
```

Only the first eight columns are required. `sourceUrl` and `verification` are optional.
Valid categories are:

```text
contract-fundamentals
life-benefits
contract-lifecycle
underwriting
claims-payment
products-coverage
kyosai
insurance-it
```

Valid difficulties:

```text
n3-bridge
n2-bridge
insurance-specialist
```

Valid domains:

```text
life
non-life
both
it
general
```

Valid verification values:

```text
verified
industry-standard
review-needed
```

Use `verified` only when the headword, reading, and Japanese definition were checked
against the cited public page. Use `industry-standard` for normal professional usage that
is not tied to one page. Use `review-needed` when wording varies by company or system.

## Web-sourced expansion policy

"Limitless" means the pipeline has no fixed cap, not that every possible insurance term
in the world is already present. Japanese insurance terminology is too broad and too
company-specific for a finite list to be complete. The practical goal is:

- keep the core hand-written entries high quality;
- add public glossary terms as sourced TSV rows;
- add generated screen-field patterns only as `review-needed` helper terms;
- let users add private terms in the app;
- make it easy to add more glossary packs later.

Current web-sourced and curated expansion packs:

- `scripts/term_corpus/web-glossaries.tsv`
  - 日本損害保険協会 保険の用語集: <https://www.sonpo.or.jp/wakaru/word/>
  - 保険ほっとライン 保険の用語集: <https://www.hoholine.com/guide/dictionary/dictionary/>
  - 損保ジャパン 用語集: <https://faq.sompo-japan.jp/insglossary>
  - 明治安田 用語集: <https://www.meijiyasuda.co.jp/words/>
- `scripts/term_corpus/industry-extra.tsv`
  - general industry-usage terms for automobile, property, medical, life, annuity, and
    financial-risk vocabulary. These are marked `industry-standard`, not `verified`, unless
    a future row adds a `sourceUrl`.

Good future sources to add as separate TSV files:

- 生命保険文化センター / 生命保険協会 glossaries
- 損害保険会社 and 生命保険会社 glossaries
- 共済組合 glossaries
- 自動車保険・地震保険・医療保険・介護保険・年金 glossaries
- 金融庁 / 保険業法 / 商法 保険編 explanatory pages

When adding web terms, keep each source in its own TSV file and include `sourceUrl` and
`verification` columns. Do not paste a huge web page into the repository; keep only the
term rows and source notes.

## Important implementation notes

- `src/data/index.ts` is the only place that lists built-in vocabulary JSON files.
- `src/lib/schema.ts` validates every entry at load time.
- `src/lib/questionGenerator.ts` must never invent fake distractors.
- Distinction questions may use same-reading different-kanji pairs such as 保障/補償.
- Generated screen-field entries are broad but company-specific; they are marked
  `review-needed`.
- Tests are slow because the dataset is large. Run targeted tests when possible:
  ```bash
  npx vitest run tests/schema.test.ts
  npx vitest run tests/questionGenerator.test.ts
  ```
