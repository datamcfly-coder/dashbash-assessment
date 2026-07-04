import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Vite 5.4 can't resolve the native `node:sqlite` builtin (it strips the
// `node:` prefix and looks for a "sqlite" package). For test runs only, we
// alias `node:sqlite` to a small shim that loads the real builtin via
// `createRequire`. The app code (src/lib/db.ts) is left untouched — it imports
// `node:sqlite` normally, which Next.js handles fine.
export default defineConfig({
  resolve: {
    alias: {
      "node:sqlite": fileURLToPath(new URL("./src/test/node-sqlite-shim.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
  },
});
