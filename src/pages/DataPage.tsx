import { useState } from "react";
import { MODE_LABELS } from "../data/categories";
import { BUILT_IN_VOCABULARY } from "../data";
import { QUESTION_MODES } from "../lib/questionGenerator";
import type { ImportMode, ImportPlan } from "../lib/backup";
import type { FieldIssue } from "../lib/schema";
import type { QuestionMode } from "../types/vocabulary";
import type { StoreValue } from "../state/store";
import { Card, Chip, Field, Stat, Toggle } from "../components/ui";

interface Props {
  store: StoreValue;
}

export default function DataPage({ store }: Props) {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<ImportMode>("merge");
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [issues, setIssues] = useState<FieldIssue[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const settings = store.settings;

  const download = () => {
    const json = store.exportJson();
    setText(json);
    try {
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `hokengo-backup-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setMessage("backup ready — the file was downloaded and copied into the text area below");
    } catch {
      // Downloads are blocked in some contexts; the text area still holds the JSON.
      setMessage("backup ready — copied into the text area below (download blocked by this browser)");
    }
  };

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    const content = await file.text();
    setText(content);
    setPlan(null);
    setIssues([]);
    setMessage(`loaded ${file.name} — check the preview before importing`);
  };

  const preview = () => {
    const result = store.previewImport(text, mode);
    setPlan(result.plan);
    setIssues(result.issues);
    setMessage(result.plan ? "preview ready — nothing has been changed yet" : "the file is not valid");
  };

  const commit = async () => {
    setBusy(true);
    try {
      await store.commitImport(text, mode);
      setMessage("import complete");
      setPlan(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "the import failed");
    } finally {
      setBusy(false);
    }
  };

  const toggleMode = (m: QuestionMode) => {
    const next = settings.enabledModes.includes(m)
      ? settings.enabledModes.filter((v) => v !== m)
      : [...settings.enabledModes, m];
    if (next.length === 0) return;
    void store.updateSettings({ enabledModes: next });
  };

  return (
    <div className="page">
      <Card title="設定 / Settings" subtitle="Stored with your progress on this device.">
        <div className="form-grid">
          <Field label="Theme / テーマ">
            <select
              className="input"
              value={settings.theme}
              onChange={(e) => void store.updateSettings({ theme: e.target.value as typeof settings.theme })}
            >
              <option value="system">system</option>
              <option value="light">light</option>
              <option value="dark">dark</option>
            </select>
          </Field>
          <Field label="Session size / 1セッションの問題数">
            <select
              className="input"
              value={settings.sessionSize}
              onChange={(e) => void store.updateSettings({ sessionSize: Number(e.target.value) })}
            >
              {[5, 10, 15, 20, 30].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Daily goal / 1日の目標回答数">
            <input
              className="input"
              type="number"
              min={1}
              max={500}
              value={settings.dailyGoal}
              onChange={(e) => void store.updateSettings({ dailyGoal: Math.max(1, Number(e.target.value) || 1) })}
            />
          </Field>
        </div>

        <div className="toggles">
          <Toggle
            checked={settings.showKana}
            onChange={(v) => void store.updateSettings({ showKana: v })}
            label="読み / show kana readings"
          />
          <Toggle
            checked={settings.showRomaji}
            onChange={(v) => void store.updateSettings({ showRomaji: v })}
            label="romaji"
          />
          <Toggle
            checked={settings.showEnglishExamples}
            onChange={(v) => void store.updateSettings({ showEnglishExamples: v })}
            label="例文の英語訳 / show example translations"
          />
          <Toggle
            checked={settings.selfGrading}
            onChange={(v) => void store.updateSettings({ selfGrading: v })}
            label="自己評価 / rate each answer (もう一度・難しい・正しい・簡単)"
            hint="off: a correct option is always recorded as 正しい, so the schedule cannot tell hard from easy"
          />
          <Toggle
            checked={settings.speechEnabled}
            onChange={(v) => void store.updateSettings({ speechEnabled: v })}
            label="🔊 再生 / read Japanese aloud"
            hint="uses the voices already installed in your browser — nothing is downloaded"
          />
          <Toggle
            checked={settings.speechAuto}
            onChange={(v) => void store.updateSettings({ speechAuto: v })}
            label="自動で読む / read the prompt when a question appears"
            hint="skipped for 空所補充 (it would say the answer) and 英語 → 日本語 (English prompt)"
          />
        </div>

        <Field label="Question modes / 出題形式" hint="at least one must stay enabled">
          <div className="chips">
            {QUESTION_MODES.map((m) => (
              <Chip key={m} active={settings.enabledModes.includes(m)} onClick={() => toggleMode(m)} title={MODE_LABELS[m].hint}>
                {MODE_LABELS[m].ja}
              </Chip>
            ))}
          </div>
        </Field>
      </Card>

      <Card
        title="バックアップ / Backup &amp; restore"
        subtitle="A plain JSON file: settings, your own terms, progress and activity. Nothing is sent to a server."
      >
        <div className="row-actions">
          <button className="btn primary" onClick={download}>
            エクスポート / export JSON
          </button>
          <label className="btn">
            choose a file…
            <input
              type="file"
              accept="application/json,.json"
              onChange={(e) => void readFile(e.target.files?.[0])}
              hidden
            />
          </label>
          <div className="chips">
            {(["merge", "replace"] as ImportMode[]).map((m) => (
              <Chip key={m} active={mode === m} onClick={() => setMode(m)}>
                {m === "merge" ? "merge (keep newer)" : "replace everything"}
              </Chip>
            ))}
          </div>
        </div>

        <Field label="Backup JSON" hint="paste a file here, or press export to fill this box">
          <textarea className="input mono tall" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
        </Field>

        <div className="row-actions">
          <button className="btn" onClick={preview} disabled={!text.trim()}>
            preview import
          </button>
          <button className="btn primary" onClick={() => void commit()} disabled={!text.trim() || busy}>
            {busy ? "importing…" : "import now"}
          </button>
          <button className="ghost" onClick={() => { setText(""); setPlan(null); setIssues([]); setMessage(null); }}>
            clear
          </button>
        </div>

        {message && <p className="note">{message}</p>}

        {issues.length > 0 && (
          <ul className="errors">
            {issues.map((issue, i) => (
              <li key={`${issue.path}-${i}`}>
                <b>{issue.path || "file"}</b>: {issue.message}
              </li>
            ))}
          </ul>
        )}

        {plan && (
          <div className="plan">
            <h3>preview ({plan.mode})</h3>
            <div className="stats">
              <Stat label="progress to add" value={plan.progressAdd} />
              <Stat label="progress to update" value={plan.progressUpdate} />
              <Stat label="progress skipped (older)" value={plan.progressSkip} />
              <Stat label="my terms to add" value={plan.vocabularyAdd} />
              <Stat label="my terms to update" value={plan.vocabularyUpdate} />
              <Stat label="conflicts kept" value={plan.vocabularyConflict} />
              <Stat label="activity days added" value={plan.activityAdd} />
              <Stat label="activity days merged" value={plan.activityMerge} />
              <Stat label="settings replaced" value={plan.settingsReplaced ? "yes" : "no"} />
              <Stat label="invalid records ignored" value={plan.invalidRecords} tone={plan.invalidRecords ? "warn" : ""} />
            </div>
          </div>
        )}
      </Card>

      <Card title="保存領域 / Storage" subtitle={`active backend: ${store.storageKind}`}>
        <div className="stats">
          <Stat label="built-in terms" value={store.entries.length - store.userEntries.length} />
          <Stat label="my terms" value={store.userEntries.length} />
          <Stat label="terms with progress" value={Object.keys(store.progress).length} />
          <Stat label="recorded days" value={Object.keys(store.activity).length} />
        </div>
        {store.storageKind === "memory" ? (
          <p className="note bad">
            IndexedDB is unavailable in this browser context, so data only lives until you close the tab. Export a
            backup before closing.
          </p>
        ) : (
          <p className="note">
            Everything is stored in this browser only (IndexedDB). Clearing site data deletes it — keep a backup file.
          </p>
        )}
      </Card>

      <Card title="危険な操作 / Danger zone" subtitle="These cannot be undone.">
        <div className="row-actions">
          <button
            className="btn danger"
            onClick={() => {
              const ok = window.confirm(
                "Reset everything on this device — progress, bookmarks, activity, settings and the terms you added? " +
                  "Export a backup first. This cannot be undone."
              );
              if (ok) void store.resetEverything();
            }}
          >
            reset everything / すべて初期化
          </button>
        </div>
        <p className="note">
          This deletes the local IndexedDB contents for the app. The
          {" "}{BUILT_IN_VOCABULARY.length}{" "}built-in terms are
          part of the app itself and come back on the next load.
        </p>
      </Card>
    </div>
  );
}

