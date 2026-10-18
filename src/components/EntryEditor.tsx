import { useMemo, useState } from "react";
import { CATEGORIES, DIFFICULTY_LABELS, DOMAIN_LABELS } from "../data/categories";
import { validateVocabularyEntry } from "../lib/schema";
import type { ConfusedTermRef, Domain, VocabularyEntry } from "../types/vocabulary";
import { Card, Chip, Field } from "./ui";

interface Props {
  existing: VocabularyEntry | null;
  entries: VocabularyEntry[];
  onSave: (entry: VocabularyEntry) => Promise<void>;
  onCancel: () => void;
}

const emptyConfusable = (): ConfusedTermRef => ({ term: "", reading: "", distinction: "" });

const splitList = (value: string): string[] =>
  value
    .split(/[,、]/)
    .map((v) => v.trim())
    .filter(Boolean);

/**
 * Form for learner-created terms. The draft is validated with the same schema the
 * built-in dataset is validated with, so anything saved here is guaranteed to be
 * usable by the question generator.
 */
export default function EntryEditor({ existing, entries, onSave, onCancel }: Props) {
  const [term, setTerm] = useState(existing?.term ?? "");
  const [kana, setKana] = useState(existing?.kana ?? "");
  const [romaji, setRomaji] = useState(existing?.romaji ?? "");
  const [translation, setTranslation] = useState(existing?.translation ?? "");
  const [alternatives, setAlternatives] = useState((existing?.alternativeTranslations ?? []).join(", "));
  const [definitionJa, setDefinitionJa] = useState(existing?.definitionJa ?? "");
  const [explanationEn, setExplanationEn] = useState(existing?.explanationEn ?? "");
  const [context, setContext] = useState(existing?.context ?? "");
  const [exampleJa, setExampleJa] = useState(existing?.example?.ja ?? "");
  const [exampleKana, setExampleKana] = useState(existing?.example?.kana ?? "");
  const [exampleRomaji, setExampleRomaji] = useState(existing?.example?.romaji ?? "");
  const [exampleTranslation, setExampleTranslation] = useState(existing?.example?.translation ?? "");
  const [category, setCategory] = useState<VocabularyEntry["category"]>(existing?.category ?? CATEGORIES[0].id);
  const [difficulty, setDifficulty] = useState<VocabularyEntry["difficulty"]>(existing?.difficulty ?? "n2-bridge");
  const [domains, setDomains] = useState<Domain[]>(existing?.domains?.length ? existing.domains : ["general"]);
  const [domainNote, setDomainNote] = useState(existing?.domainNote ?? "");
  const [blankVariants, setBlankVariants] = useState((existing?.blankVariants ?? []).join(", "));
  const [tags, setTags] = useState((existing?.tags ?? []).join(", "));
  const [confusables, setConfusables] = useState<ConfusedTermRef[]>(
    existing?.confusedTerms?.length ? existing.confusedTerms : [emptyConfusable()]
  );
  const [related, setRelated] = useState<string[]>(existing?.relatedTerms ?? []);
  const [verification, setVerification] = useState(existing?.verification ?? "review-needed");
  const [verificationNote, setVerificationNote] = useState(existing?.verificationNote ?? "entered by hand in this app");
  const [sourceUrl, setSourceUrl] = useState(existing?.sourceUrl ?? "");
  const [issues, setIssues] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [relatedQuery, setRelatedQuery] = useState("");

  // The picker is filtered and capped: rendering 140+ chips per keystroke makes the
  // form sluggish, and nobody scrolls through a list that long anyway.
  const relatedCandidates = useMemo(() => {
    const query = relatedQuery.trim().toLowerCase();
    const pool = entries.filter((e) => e.id !== existing?.id);
    const matching = query
      ? pool.filter(
          (e) =>
            e.term.toLowerCase().includes(query) ||
            e.kana.toLowerCase().includes(query) ||
            e.id.toLowerCase().includes(query)
        )
      : pool;
    return { shown: matching.slice(0, 40), total: matching.length };
  }, [entries, existing?.id, relatedQuery]);

  const patchConfusable = (index: number, patch: Partial<ConfusedTermRef>) => {
    const next = confusables.slice();
    next[index] = { ...next[index], ...patch };
    setConfusables(next);
  };

  const save = async () => {
    const now = new Date().toISOString();
    const draft: Record<string, unknown> = {
      ...(existing ?? {}),
      id: existing?.id ?? `user-${Date.now().toString(36)}`,
      term,
      kana: kana || term,
      romaji: romaji || term,
      translation,
      alternativeTranslations: splitList(alternatives),
      definitionJa,
      explanationEn,
      context,
      category,
      difficulty,
      domains,
      domainNote,
      blankVariants: splitList(blankVariants),
      example: { ja: exampleJa, kana: exampleKana, romaji: exampleRomaji, translation: exampleTranslation },
      confusedTerms: confusables.filter((c) => c.term.trim() && c.distinction.trim()),
      relatedTerms: related,
      tags: splitList(tags),
      verification,
      verificationNote,
      sourceUrl,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    delete draft.origin;

    const result = validateVocabularyEntry(draft);
    if (!result.valid || !result.entry) {
      setIssues(result.issues.map((i) => `${i.path || "entry"}: ${i.message}`));
      return;
    }
    setIssues([]);
    setBusy(true);
    try {
      await onSave(result.entry);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title={existing ? "自分の用語を編集 / Edit your term" : "自分の用語を追加 / Add your own term"}
      subtitle="Saved on this device and used by the question generator. Fields marked * are required by the schema."
    >
      <div className="form-grid">
        <Field label="用語 / Term *">
          <input className="input" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="例: 簡易審査" />
        </Field>
        <Field label="読み / kana *" hint="defaults to the term">
          <input className="input" value={kana} onChange={(e) => setKana(e.target.value)} placeholder="かんいしんさ" />
        </Field>
        <Field label="Romaji *" hint="auto-filled with the term if left empty">
          <input className="input" value={romaji} onChange={(e) => setRomaji(e.target.value)} placeholder="kangi shinsa" />
        </Field>
        <Field label="Translation *">
          <input
            className="input"
            value={translation}
            onChange={(e) => setTranslation(e.target.value)}
            placeholder="abbreviated screening"
          />
        </Field>
        <Field label="Alternative translations" hint="comma separated">
          <input className="input" value={alternatives} onChange={(e) => setAlternatives(e.target.value)} />
        </Field>
        <Field label="日本語定義 / definitionJa *">
          <textarea className="input" value={definitionJa} onChange={(e) => setDefinitionJa(e.target.value)} />
        </Field>
        <Field label="Meaning in English / explanationEn *" hint="the distinction mode compares these">
          <textarea className="input" value={explanationEn} onChange={(e) => setExplanationEn(e.target.value)} />
        </Field>
        <Field label="Where it is used / context *">
          <textarea className="input" value={context} onChange={(e) => setContext(e.target.value)} />
        </Field>
      </div>

      <Field
        label="例文 / example (ja + kana + romaji + translation)"
        hint="all four parts are required; the term must appear in the Japanese sentence for 空所補充 to work"
      >
        <textarea className="input" value={exampleJa} onChange={(e) => setExampleJa(e.target.value)} placeholder="例: 簡易審査で引き受け可否を判断する。" />
        <input className="input" value={exampleKana} onChange={(e) => setExampleKana(e.target.value)} placeholder="かんいしんさで ひきうけ かひを はんだん する。" />
        <input className="input" value={exampleRomaji} onChange={(e) => setExampleRomaji(e.target.value)} placeholder="kangi shinsa de hikiuke kahi o handan suru." />
        <input className="input" value={exampleTranslation} onChange={(e) => setExampleTranslation(e.target.value)} placeholder="We decide whether to accept the risk using abbreviated screening." />
      </Field>

      <div className="form-grid">
        <Field label="Category *">
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value as VocabularyEntry["category"])}>
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.ja} ({c.en})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Difficulty *">
          <select
            className="input"
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value as VocabularyEntry["difficulty"])}
          >
            {(Object.keys(DIFFICULTY_LABELS) as VocabularyEntry["difficulty"][]).map((d) => (
              <option key={d} value={d}>
                {DIFFICULTY_LABELS[d].ja} / {DIFFICULTY_LABELS[d].en}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Domains *" hint="at least one">
          <div className="chips">
            {(Object.keys(DOMAIN_LABELS) as Domain[]).map((d) => (
              <Chip
                key={d}
                active={domains.includes(d)}
                onClick={() =>
                  setDomains(domains.includes(d) ? domains.filter((v) => v !== d) : [...domains, d])
                }
              >
                {DOMAIN_LABELS[d].ja}
              </Chip>
            ))}
          </div>
        </Field>
        <Field label="Domain note" hint="when life / non-life wording differs">
          <input className="input" value={domainNote} onChange={(e) => setDomainNote(e.target.value)} />
        </Field>
        <Field label="Blank variants" hint="comma separated surface forms used for 空所補充">
          <input className="input" value={blankVariants} onChange={(e) => setBlankVariants(e.target.value)} />
        </Field>
        <Field label="Tags" hint="comma separated">
          <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} />
        </Field>
      </div>

      <Field label="Confused terms / 混同しやすい語" hint="term + how it differs — feeds the 類似語の区別 questions">
        {confusables.map((c, index) => (
          <div className="conf-row" key={index}>
            <input className="input" placeholder="語" value={c.term} onChange={(e) => patchConfusable(index, { term: e.target.value })} />
            <input className="input" placeholder="読み" value={c.reading ?? ""} onChange={(e) => patchConfusable(index, { reading: e.target.value })} />
            <input
              className="input wide"
              placeholder="how it differs (EN or JA)"
              value={c.distinction}
              onChange={(e) => patchConfusable(index, { distinction: e.target.value })}
            />
            <button className="ghost" onClick={() => setConfusables(confusables.filter((_, i) => i !== index))}>
              ✕
            </button>
          </div>
        ))}
        <button className="ghost" onClick={() => setConfusables([...confusables, emptyConfusable()])}>
          + add confusable
        </button>
      </Field>

      <Field label="Related terms / 関連語" hint="type to filter, click to link an existing entry">
        <input
          className="input"
          value={relatedQuery}
          onChange={(e) => setRelatedQuery(e.target.value)}
          placeholder="filter by term, reading or id"
        />
        <div className="chips scroll">
          {relatedCandidates.shown.map((e) => (
            <Chip
              key={e.id}
              active={related.includes(e.id)}
              title={e.id}
              onClick={() => setRelated(related.includes(e.id) ? related.filter((r) => r !== e.id) : [...related, e.id])}
            >
              {e.term}
            </Chip>
          ))}
        </div>
        <span className="field-hint">
          showing {relatedCandidates.shown.length} of {relatedCandidates.total} · {related.length} linked
        </span>
      </Field>

      <div className="form-grid">
        <Field label="Verification">
          <select className="input" value={verification} onChange={(e) => setVerification(e.target.value as NonNullable<VocabularyEntry["verification"]>)}>
            <option value="review-needed">要確認 / review needed</option>
            <option value="industry-standard">industry standard</option>
            <option value="verified">verified against a source</option>
          </select>
        </Field>
        <Field label="Verification note">
          <input className="input" value={verificationNote} onChange={(e) => setVerificationNote(e.target.value)} />
        </Field>
        <Field label="Source URL" hint="http(s) only">
          <input className="input" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} />
        </Field>
      </div>

      {issues.length > 0 && (
        <ul className="errors">
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}

      <div className="row-actions">
        <button className="btn primary" onClick={() => void save()} disabled={busy}>
          {busy ? "saving…" : "保存 / Save"}
        </button>
        <button className="ghost" onClick={onCancel}>
          cancel
        </button>
      </div>
    </Card>
  );
}



