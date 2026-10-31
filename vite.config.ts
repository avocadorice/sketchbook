import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const localAssets = mkdtempSync(join(tmpdir(), "practicepad-design-assets-"));

// Excalidraw resolves fonts at runtime; serve every font locally in both dev and builds.
cpSync(
  fileURLToPath(new URL("./node_modules/@excalidraw/excalidraw/dist/prod/fonts", import.meta.url)),
  `${localAssets}/excalidraw-assets/fonts`,
  { recursive: true },
);

export default defineConfig({
  base: "./",
  resolve: { dedupe: ["react", "react-dom"] },
  publicDir: localAssets,
  build: {
    outDir: "dist/practice",
    emptyOutDir: true,
  },
});
