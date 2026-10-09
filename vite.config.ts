import { cpSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const localAssets = fileURLToPath(new URL("./node_modules/.nexo-practice-assets/", import.meta.url));

// Excalidraw resolves fonts at runtime; serve every font locally in both dev and builds.
cpSync(
  fileURLToPath(new URL("./node_modules/@excalidraw/excalidraw/dist/prod/fonts", import.meta.url)),
  `${localAssets}/excalidraw-assets/fonts`,
  { recursive: true },
);

export default defineConfig({
  base: "./",
  publicDir: localAssets,
  build: {
    outDir: "dist/practice",
    emptyOutDir: true,
  },
});
