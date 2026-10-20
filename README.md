# ほけんご / Hokengo — 保険・IT 用語トレーナー

**ほけんご** (*hokengo* — 保険 + 語, "insurance words") is a browser-based vocabulary trainer
for **Japanese insurance terminology and the IT/systems vocabulary that surrounds it**, aimed
at learners around JLPT N3–N2 who work (or want to work) with Japanese insurers, agents, or
insurance IT projects.

Everything runs in the browser. There is **no server, no account, and no telemetry**:
progress, bookmarks, settings and your own terms are stored in your browser's IndexedDB,
and you can export/import them as a plain JSON file.

---

## Contents

- [What it does](#what-it-does)
- [Quick start](#quick-start)
- [The five question modes](#the-five-question-modes)
- [How questions are generated](#how-questions-are-generated)
- [Spaced repetition](#spaced-repetition)
- [Keyboard control](#keyboard-control)
- [Read-aloud (音声)](#read-aloud-音声)
- [Offline and installing the app](#offline-and-installing-the-app)
- [Vocabulary data model](#vocabulary-data-model)
- [Adding vocabulary](#adding-vocabulary)
- [Storage, privacy and the memory fallback](#storage-privacy-and-the-memory-fallback)
- [Backup / restore](#backup--restore)
- [Terminology and verification policy](#terminology-and-verification-policy)
- [Project structure](#project-structure)
- [Development, tests and build](#development-tests-and-build)
- [Deploying to GitHub Pages](#deploying-to-github-pages)
- [Assumptions and known limitations](#assumptions-and-known-limitations)

---

## What it does

| Screen | Japanese | What you get |
| --- | --- | --- |
| Dashboard | ダッシュボード | today's progress against your daily goal, streak, due/weak/new counts, per-category coverage, a 14-day activity sparkline, and the terms that need work most |
| Study | 学習 | session builder (session type + category/domain/difficulty/search filters + mode selection + size), a short **term introduction card** before the first quiz question for a never-studied term, the quiz itself with full keyboard control, 🔊 read-aloud, per-answer feedback with the confusable-term notes, a **self-assessment step** (もう一度 / 難しい / 正しい / 簡単) that drives the schedule, and a session summary with the grade breakdown and "practise the missed terms" |
| Kanji | 漢字 | a separate kanji-focused take: each take introduces **two new kanji** first, then quizzes meaning, reading, and example completion with four kanji choices |
| Vocabulary | 用語一覧 | the full dataset with search, filters, sorting, pagination, multi-select for a custom session, bookmarks, and a full entry detail view; you can add/edit/delete your own terms here |
| Statistics | 統計 | status distribution, accuracy per question mode, per-category and per-domain breakdowns, 30-day activity, and every term currently flagged as weak |
| Data & settings | データ・設定 | theme, romaji/kana/translation display, self-grading and read-aloud switches, session size, daily goal, enabled modes, JSON export/import with a **preview before anything is written**, and a reset |

Session types: **mixed** (due + new + weak, interleaved), **due review**, **new terms**,
**weak terms**, **bookmarked**, and **selected terms** (whatever you ticked in 用語一覧).

## Quick start

```bash
npm install       # install dependencies
npm run dev       # dev server (Vite) — http://localhost:5173
npm test          # vitest + jsdom + fake-indexeddb
npm run typecheck # tsc --noEmit
npm run build     # production build into dist/
npm run preview   # serve the built app locally
```

Requires Node 18+ (the CI workflow uses Node 20).

## Question modes

The vocabulary quiz has **five question modes**. Every mode produces **four options with
exactly one correct answer**.

| Mode | 日本語 | Prompt | Correct option |
| --- | --- | --- | --- |
| `jp-to-en` | 日本語 → 英語 | the term (with reading) | its English meaning |
| `en-to-jp` | 英語 → 日本語 | an English definition | the Japanese term |
| `context` | 文脈理解 | a real business sentence with the term highlighted | what the term means *in that sentence* |
| `fill-blank` | 空所補充 | the example sentence with the term removed | the term that completes it |
| `distinction` | 類似語の区別 | a description that separates two confusable terms | the term that matches, not the similar one |

Before a never-studied term is quizzed in a normal study session, the app shows a compact
**term introduction card** first: term, reading, translation, definition, example, and
confusable-term notes. This is controlled by the 用語紹介 toggle in Data & settings.

The separate **Kanji** tab is not one of the five vocabulary modes. It uses
`src/data/kanji.json` and `src/lib/kanjiSession.ts` to introduce two new kanji per take,
then asks four-choice kanji recognition questions: meaning → kanji, reading → kanji, and
example completion. Kanji attempts are stored with `kanji:`-prefixed progress IDs so they
do not pollute vocabulary term progress.

Distractors are always **real entries from the dataset** — never invented filler. When
answering, the feedback panel shows the correct answer, the full English explanation, the
`confusedTerms` notes for any confusable term that appeared as a distractor, and what the
scheduler decided (next interval, or "requeued in 10 minutes").

## How questions are generated

`src/lib/questionGenerator.ts` builds questions up front, so a session is reproducible
from its seed and the UI can show progress. The generator guarantees:

- exactly four **distinct** choices, exactly one marked correct;
- no distractor that is a near-synonym of the correct answer (phrase-similarity check in
  `src/lib/text.ts`), because that would make a question technically ambiguous;
- confusable terms (anything listed in `confusedTerms`, plus anything whose English
  meaning is close) are **excluded from the A/B/C modes** for that term, and are instead
  used to build 類似語の区別 questions;
- for 空所補充, the term (or one of its `blankVariants`) must appear **exactly once** in
  the example sentence, and any term listed in `fillBlankExclude` is kept out of the
  distractors, because it would also fit the blank;
- a term that cannot produce a valid four-option question in any enabled mode is reported
  in `session.skipped` instead of being padded with made-up options.

Current coverage of the built-in dataset: the **179 hand-written core terms support all five
modes**, and the curated corpus plus generated screen-field packs bring the current built-in
vocabulary to **5175 terms**. There is no fixed 1000-entry cap: the generated packs are
produced from `scripts/term_corpus/*.tsv` and pattern tables, and `--all` writes everything
currently available. The generated screen-field pack is intentionally marked `review-needed`
and is allowed to be narrower for 類似語の区別, but it still materially increases coverage
for the other modes. Those numbers are printed by `tests/questionGenerator.test.ts` on every
run, and the test fails if the core dataset loses full coverage or if a mode drops below the
minimum supported term count.

## Spaced repetition

`src/lib/scheduler.ts` is an SM-2-inspired scheduler, deliberately small and documented in
full at the top of the file. What drives it is the **self-assessment** you give after a
correct answer, not just the right/wrong of the click:

| Grade | 日本語 | SM-2 quality | Effect on the schedule |
| --- | --- | --- | --- |
| `again` | もう一度 | 1 | counts as a miss: streak reset, interval 0, re-queued after **10 minutes** so it comes back inside the same session |
| `hard` | 難しい | 3 | streak and accuracy still count, but the next gap is deliberately short (1 day, then 2, then ×1.3) and the ease factor drops |
| `good` | 正しい | 4 → 5 from the 3rd repetition | the historical behaviour: 1st → **1 day**, 2nd → **3 days**, 3rd and later → `round(previous × ease)` |
| `easy` | 簡単 | 5 | the normal gap plus a **30 % bonus**, and the ease factor rises |

- ease factor starts at **2.5**, clamped to **[1.3, 3.0]**; every interval is capped at
  **180 days**;
- status transitions: `new → learning → review` (interval ≥ 7 days) `→ mastered`
  (interval ≥ 21 days **and** ≥ 4 repetitions); a wrong answer moves a term to
  `relearning`;
- `weaknessScore()` ranks what to study next from how overdue a term is, its recent wrong
  answers, how often it was graded 難しい, its overall accuracy and whether it is in
  `relearning`. That score drives the 苦手 session, the dashboard list and the "weakest
  first" sort in 用語一覧.

Self-grading can be switched off in データ・設定 (自己評価). With it off, a correct option
is recorded as `正しい` and a wrong one as `もう一度`, which is exactly how the app behaved
before grades existed — old records are normalised to those grades on load, so nothing has
to be migrated and existing schedules do not shift.

### Keyboard control

A whole session is doable without the mouse:

| Key | Effect |
| --- | --- |
| `1` – `4` | choose an option |
| `A` / `H` / `G` / `E` | grade the answer もう一度 / 難しい / 正しい / 簡単 |
| `Enter` / `Space` | confirm the highlighted grade, then move to the next question |
| `Esc` | skip the current question |

Focus is moved to each new question, and the result of every answer is announced in an
`aria-live` region, so a screen reader follows the session without the user having to
hunt for what changed.

## Read-aloud (音声)

`src/lib/speech.ts` wraps the browser's own `speechSynthesis`; nothing is downloaded,
nothing leaves the device, and there is no account. It picks the best available Japanese
voice (exact `ja-JP` first, then any `ja*` voice) and reads at 0.95× speed, because
insurance terms arrive inside long compounds.

- every term, example sentence and Japanese definition has a 🔊 再生 button;
- 自動で読む in データ・設定 reads the prompt as each question appears — it is skipped for
  空所補充 (the reading would say the missing term) and for 英語 → 日本語 (an English
  prompt read with a Japanese voice is worse than silence);
- if the browser has no speech engine at all, the buttons stay visible but disabled and
  explain why, rather than disappearing.

Voice quality depends on what the operating system provides: Chrome/Edge on Windows and
macOS, and Safari on iOS/macOS normally have a Japanese voice installed; a bare Linux
setup may have none.

## Offline and installing the app

The vocabulary is bundled into the build and progress lives in IndexedDB, so the only
missing piece for a no-network run was the app shell itself. `public/manifest.json` makes
the app installable (standalone, with a name and icon), and `public/sw.js`:

- precaches `index.html`, the manifest and the icon on install;
- serves navigations **network-first** and falls back to the cached shell;
- serves same-origin assets **cache-first** (the build output is content-hashed, so a
  cached copy is always the right one);
- bumps its cache name on each release (`CACHE_VERSION`) to drop stale shells.

The worker is registered only in production builds, so `npm run dev` always serves the
latest source. When the browser reports that the network is gone, a banner appears at the
top of the app saying the session continues offline.

The last 20 attempts per term are kept (`recentResults`) so per-mode accuracy can be
reported without storing unbounded history.

## Vocabulary data model

The schema lives in `src/types/vocabulary.ts` and is validated at load time by
`src/lib/schema.ts` (`validateVocabularyEntry` / `validateVocabularyList`). Every entry
carries, among others:

| Field | Purpose |
| --- | --- |
| `id` | stable kebab-case id, never reused |
| `term`, `kana`, `romaji` | the term itself, in kanji, kana and romaji |
| `translation`, `alternativeTranslations` | English meaning(s) used as answers |
| `definitionJa`, `explanationEn` | Japanese dictionary-style definition + a precise English explanation, including context-dependent readings |
| `category`, `subcategory`, `difficulty`, `domains`, `domainNote` | classification; `difficulty` is **language** difficulty (`n3-bridge`, `n2-bridge`, `insurance-specialist`), and `domainNote` records where life/non-life/individual-insurer wording differs |
| `example` | `{ ja, kana, romaji, translation }` — a natural business sentence containing the term; powers 文脈理解 and 空所補充 |
| `blankVariants`, `fillBlankExclude` | surface forms that may be blanked, and term ids that would *also* fit the blank (kept out of distractors) |
| `context` | where the term actually appears in insurance business or IT work |
| `confusedTerms[]` | `{ term, reading?, termId?, distinction }` — powers 類似語の区別 and the feedback notes; `termId` links to the other entry when it exists |
| `components[]` | optional kanji breakdown (element, reading, meaning contribution) |
| `relatedTerms[]`, `tags` | cross-links and free labels |
| `sourceUrl`, `verification`, `verificationNote` | how much trust to put in the wording — see the verification policy below |

The built-in dataset is **not capped at 1000 entries**. The current committed dataset has
**5175 entries**: 179 hand-written core entries in the original JSON files under
`src/data/vocabulary/`, a curated corpus pack in `src/data/vocabulary/corpus-generated.json`,
and a generated screen-field/operation pack in `src/data/vocabulary/extended-generated.json`.
The generated packs are produced by `scripts/generate_extended_vocabulary.py` from
`scripts/term_corpus/*.tsv` and pattern tables. Screen-field wording is marked
`review-needed` because exact naming varies by company.

For context management and the expansion workflow, see `context.md`. Do not read the large
generated JSON files into an agent context just to understand the project; use the counting
commands in `context.md` instead.

| Category | 日本語 | current entries |
| --- | --- | ---: |
| contract-fundamentals | 保険契約の基礎 | 509 |
| life-benefits | 生命保険と給付 | 562 |
| contract-lifecycle | 契約ライフサイクルと変更手続き | 562 |
| underwriting | 引受査定とリスク審査 | 411 |
| claims-payment | 請求と支払処理 | 504 |
| products-coverage | 保険商品と保障 | 730 |
| kyosai | 共済（JA共済）の用語 | 494 |
| insurance-it | 保険ITと業務オペレーション | 1403 |

The two original `insurance-it` files are kept separate because they come from different
sources: `insurance-it.json` is written from insurance-IT project practice, while
`insurance-it-ipsj.json` is the general IT terminology taken from the IPSJ terminology
list (see `docs/TERMINOLOGY_SOURCES.md`).

`src/data/index.ts` loads them, runs the validator, and fails loudly if anything is
malformed or duplicated.

## Adding vocabulary

Three ways:

1. **In the app** — 用語一覧 → ＋ 自分の用語を追加. The form runs the same validator as the
   built-in data, so a saved entry is guaranteed to be usable by the question generator;
   validation problems are listed inline instead of being saved. Your terms are stored in
   IndexedDB, marked `origin: "user"`, included in every mode and session type, and
   included in backups.
2. **In the repository as a generated corpus row** — add a row to a file in
   `scripts/term_corpus/`, then run:
   ```bash
   npm run generate:vocabulary
   npm test
   ```
   This is the preferred way to grow the built-in dataset beyond the hand-written core.
   The generator has no fixed total; `--all` writes every currently available corpus row
   and every non-duplicate screen-field pattern.
3. **In the repository as a hand-written JSON entry** — add an object to one of the JSON
   files in `src/data/vocabulary/`. `npm test` will tell you immediately if it breaks a
   required field, duplicates an id, or drops a mode's coverage.

Keep the example sentence containing the term verbatim (or add a `blankVariant`), and add
at least one `confusedTerms` entry with a `termId` if you want that term to appear in
類似語の区別 questions.

## Storage, privacy and the memory fallback

- Database: IndexedDB `japanese-insurance-terminology-trainer` (version 1) with the stores
  `progress` (key `termId`), `userVocabulary` (key `id`), `settings` (key `key`),
  `activity` (key `date`) and `meta` (key `key`).
- **Identifiers are data, not branding.** The database name, the `"app"` id inside a backup
  (`japanese-insurance-terminology-trainer`) and the `jivt:theme` localStorage key all predate
  the ほけんご name and are deliberately unchanged: renaming them would orphan the progress,
  settings and personal terms of anyone already using the app. Only user-visible naming uses
  ほけんご.
- `src/lib/db.ts` is a hand-written typed wrapper (no `idb` dependency) plus a
  `MemoryBackend` used when IndexedDB is unavailable (private mode, some embedded webviews).
  The app shows a warning banner in that case, because data then only lives until the tab
  closes — export a backup first.
- `src/lib/repository.ts` is the only place that touches storage, and it **normalises every
  record on load**: a hand-edited or partially corrupt store cannot crash the app.
- All dates are local-time (`src/lib/time.ts`); there is no clock sync and no UTC maths.
- Nothing leaves the browser: no fetch calls, no analytics, no cookies, no accounts.

## Backup / restore

データ・設定 → バックアップ exports one human-readable JSON document (records abbreviated):

```json
{
  "app": "japanese-insurance-terminology-trainer",
  "schemaVersion": 1,
  "vocabularySchemaVersion": 1,
  "exportedAt": "2026-10-18T09:00:00.000Z",
  "counts": { "progress": 42, "userVocabulary": 3, "activity": 12 },
  "settings": { "theme": "system", "sessionSize": 10, "dailyGoal": 20 },
  "progress": [ { "termId": "kaishaku-kaikei", "intervalDays": 3 } ],
  "userVocabulary": [ { "id": "user-lz4k1x", "term": "簡易審査" } ],
  "activity": [ { "date": "2026-10-18", "attempts": 20, "correct": 17, "newTerms": 4 } ]
}
```

Importing is deliberately two-step: `parseBackup` validates the text, `planImport` shows
exactly what would change (add/update/skip counts per store, conflicts kept, invalid
records ignored), and only then does `applyImport` write anything. An invalid file never
touches stored data.

- **merge (keep newer)** — a progress record is only overwritten when the incoming record
  was updated more recently; your own terms are merged by id, newer wins.
- **replace everything** — the stored records are replaced by the file's contents.

Built-in terms are never copied into a backup (they ship with the app); only your own
terms are.

## Terminology and verification policy

Insurance wording is not uniform: the same concept is labelled differently by life
insurers, non-life insurers, and agent-facing systems. Each entry therefore carries a
`verification` value, shown as a pill in the UI:

| Value | Meaning | Count |
| --- | --- | --- |
| `verified` | checked against the cited public source in `sourceUrl` | 37 |
| `industry-standard` | normal professional usage, consistent with general references, not tied to one page | 117 |
| `review-needed` | wording differs between insurers — confirm against that company's documents before relying on it | 25 |

See [docs/TERMINOLOGY_SOURCES.md](docs/TERMINOLOGY_SOURCES.md) for the sources consulted
and how to challenge an entry. The 共済 wording is taken from the JA共済用語集 and part of
the IT wording from the IPSJ terminology list (CC BY-SA 4.0), so those entries reflect how
those organisations define the terms; nothing here is legal advice or an official
definition from any other insurer or government body.

## Project structure

```
index.html                     theme bootstrap, noscript notice, manifest + PWA meta
public/favicon.svg
public/manifest.json           installable-app manifest
public/sw.js                   offline cache for the app shell (plain JS, no build step)
public/.nojekyll               shipped into dist/ so Pages never runs Jekyll over the build
src/
  main.tsx, App.tsx            entry point, tab shell, theme handling, offline banner
  state/store.tsx              React context + reducer; the only writer of app state
  lib/
    db.ts                      typed IndexedDB wrapper + MemoryBackend
    repository.ts              storage facade; normalises everything on load
    schema.ts                  vocabulary validation
    scheduler.ts               spaced repetition, driven by the self-assessment grade
    questionGenerator.ts       the five vocabulary modes, distractor selection, guarantees
    kanjiGenerator.ts          four-choice kanji recognition questions
    kanjiSession.ts            two-new-kanji-per-take session construction
    session.ts                 session construction, filtering, ordering
    stats.ts                   dashboard/statistics aggregations
    backup.ts                  export, parse, import plan, apply, merge
    speech.ts                  Web Speech API wrapper (voice choice, read-aloud)
    text.ts                    normalisation, search, similarity, sentence splitting
    random.ts                  seedable RNG (mulberry32), shuffle, sampling
    time.ts                    local dates, streaks
  data/
    categories.ts              category/domain/difficulty/mode/grade labels
    vocabulary/*.json          179 core entries + generated corpus/screen-field packs
    kanji.json                 kanji pack used by the Kanji tab
    index.ts                   load + validate + export the typed vocabulary dataset
    kanji.ts                   load + validate + export the kanji dataset
  components/                  ui primitives, QuestionCard, SpeakButton, EntryDetail, EntryEditor
  pages/                       Dashboard, Study, Kanji, Browser, Statistics, Data
  styles/app.css               design tokens, light + dark themes, responsive rules
scripts/
  generate_extended_vocabulary.py  regenerates uncapped corpus + screen-field packs
  term_corpus/*.tsv                curated and web-sourced term rows used by the generator
  generate_kanji_dataset.py        regenerates the kanji pack from core components + curated list
tests/                         unit and app-shell tests
docs/TERMINOLOGY_SOURCES.md
context.md                     short agent context + dataset expansion workflow
.github/workflows/deploy.yml   GitHub Pages deployment
```

## Development, tests and build

```bash
npm run dev                 # Vite dev server
npm test                    # vitest run
npm run test:watch          # watch mode
npm run typecheck           # tsc --noEmit (strict, noUnusedLocals)
npm run generate:vocabulary # regenerate uncapped generated vocabulary packs
npm run build               # typecheck + vite build into dist/
npm run preview             # serve dist/
```

What the tests cover:

- `schema.test.ts` — required fields, enums, id format, duplicate detection, sanitising;
- `questionGenerator.test.ts` — four distinct choices, one correct answer, no ambiguous
  distractors, the blank appears exactly once, plus the per-mode coverage report and an
  assertion that the hand-written core remains fully supported and that each mode has a
  large usable pool across the generated dataset;
- `scheduler.test.ts` — intervals, ease clamping, relearn path, status transitions,
  weakness ranking, and the four self-assessment grades (hard keeps the streak but shortens
  the gap, easy extends it, もう一度 on a clicked-correct answer still counts as a miss,
  and a plain boolean call is identical to `good`/`again`);
- `repository.test.ts` — persistence round-trips, normalisation of bad records, the new
  self-grading/read-aloud settings defaults, and grades derived from attempts written
  before self-grading existed;
- `speech.test.ts` — support detection, Japanese voice selection, and what the wrapper asks
  the browser to say (with a stubbed `speechSynthesis`, since jsdom has none);
- `backup.test.ts` — export, parse, import plan, merge vs replace;
- `session.test.ts` — session kinds, filters, interleaving, skipped terms;
- `app.test.tsx` — boots the real app in jsdom with fake-indexeddb: answers a generated
  question and reaches the summary, grades a correct answer as 難しい and sees that grade in
  the summary, searches the browser and opens an entry, creates and deletes a personal term
  through the editor, and exports plus previews a backup.

## Deploying to GitHub Pages

`vite.config.ts` sets `base: "./"`, so every asset URL is relative to `index.html` and the
same build works at a site root or under a repository subpath such as
`https://<user>.github.io/<repo>/`.

1. Push the repository to GitHub (the workflow triggers on `main`).
2. Repository → Settings → Pages → **Build and deployment: Source → GitHub Actions**.
   This one setting is what provisions the deployment endpoint that
   `actions/deploy-pages@v4` posts to; without it the build succeeds, the artifact
   uploads, and only the last step fails.
3. `.github/workflows/deploy.yml` runs typecheck, tests and build, then publishes `dist/`.
   `public/.nojekyll` is copied into `dist/` so Pages never runs Jekyll over the output.

### If the deploy step fails

`Deploy to GitHub Pages` failing with

```
Error: Failed to create deployment (status: 404) with build version <sha>.
Ensure GitHub Pages has been enabled: https://github.com/<owner>/<repo>/settings/pages
```

means step 2 above has not been done — Pages is still on **Deploy from a branch**, so the
Actions deployment endpoint does not exist yet. Nothing in the app or the workflow is at
fault. Set the source to **GitHub Actions**, then re-run the job from
Actions → *Deploy to GitHub Pages* → *Run workflow* (`workflow_dispatch` is enabled).

The same misconfiguration is visible in the browser, because Pages then serves the raw
repository instead of the build — three symptoms that look like app bugs but are not:

| Symptom in DevTools | Why it happens |
| --- | --- |
| `Failed to load module script: … MIME type of "application/octet-stream"` | the raw `index.html` asks for `./src/main.tsx`, and Pages has no MIME type for `.tsx` |
| `GET /manifest.json 404` | the manifest lives in `public/`, so it only exists at the site root after a build |
| The page renders the `<noscript>` notice only | no module ever loaded |

After switching the source, allow a couple of minutes for Pages to build the new
deployment and up to ten minutes for the CDN cache to expire, then hard-reload. The
service worker's cache name is bumped in `public/sw.js` (`CACHE_VERSION`) whenever a
release ships, which drops any previously cached broken shell.

To publish somewhere else, just serve `dist/` — it is plain static files.

## Assumptions and known limitations

- **Local-first by design.** Progress does not sync between devices or browsers; use the
  JSON backup to move it. Clearing site data deletes it.
- **Local dates.** Streaks and daily goals use the device's calendar day, not UTC.
- **Question coverage is per entry, not per session.** The 179 hand-written core terms can
  produce all five vocabulary question types. The generated extended pack is broader but
  intentionally narrower for 類似語の区別; an individual question is still skipped when the
  terms available in that session cannot supply four distinct distractors, and those cases
  are reported in `session.skipped` rather than padded with made-up options.
- **Read-aloud depends on installed voices.** Only the speech engines already in the browser
  are used: with no Japanese voice the app falls back to the browser default, and with no
  speech engine at all the 再生 buttons are disabled and say why. Nothing is downloaded and
  nothing is spoken unless you ask (or turn on 自動で読む).
- **Offline covers same-origin files.** The service worker caches the app shell and the
  build's own assets; a resource fetched from another origin (a CDN font, say) would fail
  offline. The worker is registered in production builds only, so check offline behaviour
  with `npm run build && npm run preview` and DevTools → Network → Offline.
- **Difficulty is language difficulty**, not insurance difficulty: `n3-bridge`,
  `n2-bridge` and `insurance-specialist` describe how much Japanese you need to parse the
  term, not how hard the concept is.
- **Wording varies by company.** 25 entries are explicitly marked 要確認 (`review-needed`);
  treat those as starting points and check the documentation of the insurer or project you
  are actually working with.
- Romaji is Hepburn with macrons; kana readings are given for the term and the full example
  sentence, which is more detail than a dictionary usually prints, and long readings may be
  simplified where a term appears inside a longer compound.
- The app is tested in Chromium-based browsers via jsdom unit/integration tests; there is
  no visual regression suite.