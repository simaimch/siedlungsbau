import { defineConfig, loadEnv } from "vite";
import path from "node:path";

const MODULE_ID = "siedlungsbau";

// Normaler Build (npm run build)         -> dist/
// Lokaler Foundry-Build (--mode foundry) -> $FOUNDRY_MODULES_DIR/siedlungsbau  (aus .env.foundry)
export default defineConfig(({ mode }) => {
  let outDir = "dist";

  if (mode === "foundry") {
    const env = loadEnv(mode, process.cwd(), "");
    const modulesDir = env.FOUNDRY_MODULES_DIR;
    if (!modulesDir) {
      throw new Error("FOUNDRY_MODULES_DIR fehlt. Lege .env.foundry an (siehe .env.foundry.example).");
    }
    outDir = path.join(modulesDir, MODULE_ID);
  }

  return {
    publicDir: "static",
    build: {
      outDir,
      emptyOutDir: true, // geleert wird nur .../siedlungsbau
      sourcemap: true,
      minify: false,
      target: "es2022",
      lib: {
        entry: "src/main.ts",
        formats: ["es"],
        fileName: () => "scripts/main.js"
      }
    }
  };
});