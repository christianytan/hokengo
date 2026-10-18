import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base: "./" makes every built asset URL relative to index.html, so the same
// build works at the site root and under a GitHub Pages repository subpath
// such as https://<user>.github.io/<repo>/ without any extra configuration.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    target: "es2022",
    outDir: "dist",
    sourcemap: true,
  },
});
