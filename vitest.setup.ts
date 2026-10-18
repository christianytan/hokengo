import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";

// jsdom has no matchMedia. The app guards against its absence, but a stub keeps
// the theme effect on the same code path a browser would take.
if (typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}
