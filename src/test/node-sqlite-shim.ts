// Test-only shim for `node:sqlite`.
//
// Vite 5.4 (used by Vitest) can't resolve the native `node:sqlite` builtin —
// it strips the `node:` prefix and tries to bundle a non-existent "sqlite"
// package. We load the real builtin through `createRequire`, which is a plain
// runtime call Vite never tries to transform. The Vitest config aliases
// `node:sqlite` to this file, so `src/lib/db.ts` keeps its normal static import
// and stays unchanged for the actual Next.js app.

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sqlite = require("node:sqlite") as typeof import("node:sqlite");

export const DatabaseSync = sqlite.DatabaseSync;
