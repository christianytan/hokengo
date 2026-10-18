import { useEffect, useMemo, useState } from "react";
import { useStore } from "./state/store";
import { summarize } from "./lib/stats";
import DashboardPage from "./pages/DashboardPage";
import StudyPage from "./pages/StudyPage";
import KanjiPage from "./pages/KanjiPage";
import BrowserPage from "./pages/BrowserPage";
import StatisticsPage from "./pages/StatisticsPage";
import DataPage from "./pages/DataPage";

export type PageId = "dashboard" | "study" | "kanji" | "browser" | "stats" | "data";

export interface NavPayload {
  termIds?: string[];
  termId?: string;
  kind?: "mixed" | "due" | "new" | "weak" | "bookmarked" | "selected";
}

export interface Nav {
  (page: PageId, payload?: NavPayload): void;
}

const TABS: { id: PageId; ja: string; en: string }[] = [
  { id: "dashboard", ja: "ダッシュボード", en: "Dashboard" },
  { id: "study", ja: "学習", en: "Study" },
  { id: "kanji", ja: "漢字", en: "Kanji" },
  { id: "browser", ja: "用語一覧", en: "Vocabulary" },
  { id: "stats", ja: "統計", en: "Statistics" },
  { id: "data", ja: "データ・設定", en: "Data & settings" },
];

/**
 * Whether the browser currently reports a network. The app is local-first, so
 * being offline changes nothing except that the browser cannot fetch a newer
 * version of the app — the banner says exactly that rather than alarming anyone.
 */
function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine !== false));
  useEffect(() => {
    const update = () => setOnline(navigator.onLine !== false);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

export default function App() {
  const store = useStore();
  const online = useOnlineStatus();
  const [page, setPage] = useState<PageId>("dashboard");
  const [payload, setPayload] = useState<NavPayload>({});

  const navigate: Nav = (next, nextPayload) => {
    setPayload(nextPayload ?? {});
    setPage(next);
  };

  useEffect(() => {
    const media =
      typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
    const apply = () => {
      const prefersDark = media?.matches ?? false;
      const theme =
        store.settings.theme === "system" ? (prefersDark ? "dark" : "light") : store.settings.theme;
      document.documentElement.dataset.theme = theme;
    };
    apply();
    if (!media) return;
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [store.settings.theme]);

  // Only the daily goal is read here. Keeping the dependency this narrow means
  // changing the theme or the reading display cannot recompute the totals.
  const dailyGoal = store.settings.dailyGoal;
  const summary = useMemo(
    () => summarize(store.entries, store.progress, dailyGoal, store.activity),
    [store.entries, store.progress, dailyGoal, store.activity]
  );

  if (store.status === "loading") {
    return (
      <div className="boot">
        <div className="boot-card">
          <span className="spinner" aria-hidden />
          <p>データを読み込んでいます… / Loading local data…</p>
        </div>
      </div>
    );
  }

  if (store.status === "error") {
    return (
      <div className="boot">
        <div className="boot-card error">
          <h1>起動できませんでした / Could not start</h1>
          <p className="muted">{store.error}</p>
          <button className="btn primary" onClick={() => void store.reload()}>
            再試行 / Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        本文へ / skip to content
      </a>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">保</span>
          <div>
            <strong>ほけんご</strong>
            <span className="brand-sub">保険・IT 用語トレーナー · Hokengo</span>
          </div>
        </div>
        <nav className="tabs" aria-label="Main navigation">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={page === tab.id ? "tab active" : "tab"}
              onClick={() => navigate(tab.id)}
              aria-current={page === tab.id ? "page" : undefined}
            >
              <span className="tab-ja">{tab.ja}</span>
              <span className="tab-en">{tab.en}</span>
            </button>
          ))}
        </nav>
      </header>

      {store.storageKind === "memory" && (
        <div className="banner warn" role="status">
          <strong>ブラウザの保存領域が使えないため、このタブを開いている間だけデータが保持されます。</strong>
          <span>
            IndexedDB is unavailable ({store.storageWarning ?? "blocked"}); progress will be lost when this tab closes.
            Export a backup before closing.
          </span>
        </div>
      )}

      {!online && (
        <div className="banner info" role="status">
          <strong>オフラインですが、学習はそのまま続けられます。</strong>
          <span>
            You are offline. Nothing is sent anywhere in this app, so study, progress and your own terms all keep
            working; only a newer version of the app cannot be fetched.
          </span>
        </div>
      )}

      <main className="content" id="main" tabIndex={-1}>
        {page === "dashboard" && <DashboardPage store={store} summary={summary} navigate={navigate} />}
        {page === "study" && <StudyPage store={store} payload={payload} navigate={navigate} />}
        {page === "kanji" && <KanjiPage store={store} />}
        {page === "browser" && <BrowserPage store={store} payload={payload} navigate={navigate} />}
        {page === "stats" && <StatisticsPage store={store} navigate={navigate} />}
        {page === "data" && <DataPage store={store} />}
      </main>

      <footer className="footer">
        <span>
          {store.entries.length} terms · progress stays on this device (IndexedDB) · JSON backup available in
          データ・設定
        </span>
      </footer>
    </div>
  );
}
