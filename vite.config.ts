import { defineConfig } from "vite";

// "static/" (module.json, templates, lang, styles) wird 1:1 nach "dist/" kopiert.
// Der Bundle landet als dist/scripts/main.js, passend zu "esmodules" in module.json.
export default defineConfig({
  publicDir: "static",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    target: "es2022",
    lib: {
      entry: "src/main.ts",
      formats: ["es"],
      fileName: () => "scripts/main.js"
    }
  }
});
