import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { StoreProvider } from "./state/store";
import "./styles/app.css";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Missing #root element");

createRoot(rootElement).render(
  <StrictMode>
    <StoreProvider>
      <App />
    </StoreProvider>
  </StrictMode>
);

// The vocabulary data and the learner's progress already live in the browser, so
// caching the app shell is enough for the trainer to keep working with no network
// at all. Registration is skipped in dev so the worker never hides fresh sources.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      // Offline support is a bonus, never a requirement for the app to run.
    });
  });
}
