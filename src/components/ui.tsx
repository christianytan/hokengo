import type { ReactNode } from "react";
import type { Difficulty, VerificationStatus } from "../types/vocabulary";
import type { LearningStatus } from "../types/progress";
import { DIFFICULTY_LABELS } from "../data/categories";

export function Card({
  title,
  subtitle,
  actions,
  children,
  className = "",
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className}`.trim()}>
      {(title || actions) && (
        <header className="card-head">
          <div>
            {title && <h2 className="card-title">{title}</h2>}
            {subtitle && <p className="card-sub">{subtitle}</p>}
          </div>
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint, tone = "" }: { label: string; value: ReactNode; hint?: string; tone?: string }) {
  return (
    <div className={`stat ${tone}`.trim()}>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
      {hint && <span className="stat-hint">{hint}</span>}
    </div>
  );
}

export function Bar({ value, max, label, tone = "" }: { value: number; max: number; label?: string; tone?: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="bar" title={label ?? `${value} / ${max}`}>
      <div className={`bar-fill ${tone}`.trim()} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Chip({
  active,
  onClick,
  children,
  title,
}: {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
  title?: string;
}) {
  return (
    <button type="button" className={`chip ${active ? "active" : ""}`.trim()} onClick={onClick} title={title} aria-pressed={!!active}>
      {children}
    </button>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: ReactNode;
  hint?: string;
}) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-label">
        {label}
        {hint && <span className="toggle-hint">{hint}</span>}
      </span>
    </label>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">
        {label}
        {hint && <span className="field-hint">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {hint && <p className="empty-hint">{hint}</p>}
    </div>
  );
}

const STATUS_LABELS: Record<string, { ja: string; en: string; tone: string }> = {
  new: { ja: "未学習", en: "new", tone: "muted" },
  learning: { ja: "学習中", en: "learning", tone: "warn" },
  relearning: { ja: "やり直し", en: "relearning", tone: "bad" },
  review: { ja: "復習", en: "review", tone: "info" },
  mastered: { ja: "習得", en: "mastered", tone: "good" },
};

export function StatusPill({ status }: { status: LearningStatus }) {
  const meta = STATUS_LABELS[status] ?? STATUS_LABELS.new;
  return (
    <span className={`pill ${meta.tone}`}>
      {meta.ja} <span className="pill-en">{meta.en}</span>
    </span>
  );
}

export function DifficultyPill({ difficulty }: { difficulty: Difficulty }) {
  const label = DIFFICULTY_LABELS[difficulty];
  return <span className={`pill diff-${difficulty}`}>{label.ja}</span>;
}

const VERIFICATION_LABELS: Record<VerificationStatus, { text: string; tone: string }> = {
  verified: { text: "source checked", tone: "good" },
  "industry-standard": { text: "industry usage", tone: "info" },
  "review-needed": { text: "wording varies", tone: "warn" },
};

export function VerificationPill({ status }: { status?: VerificationStatus }) {
  if (!status) return null;
  const meta = VERIFICATION_LABELS[status];
  return <span className={`pill ${meta.tone}`}>{meta.text}</span>;
}

export function percent(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  return `${Math.round(value * 100)}%`;
}

export function relativeTime(iso: string | null): string {
  if (!iso) return "まだ学習していません / never";
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "たった今 / just now";
  if (minutes < 60) return `${minutes}分前 / ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}時間前 / ${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}日前 / ${days} d ago`;
  return new Date(iso).toLocaleDateString();
}
