#!/usr/bin/env node
// Issue #157: run the runtime performance benchmark with the root tsconfig
// active so the electron/* `@shared/*` path aliases resolve.
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Windows requires file:// URLs for --import and for an absolute ESM entry.
const loaderUrl = pathToFileURL(join(repoRoot, "openclaw_runtime", "node_modules", "tsx", "dist", "loader.mjs")).href;
const entryPath = join(repoRoot, "scripts", "runtime-perf-benchmark.mjs");
const result = spawnSync(
  process.execPath,
  [
    "--import",
    loaderUrl,
    entryPath,
    ...process.argv.slice(2),
  ],
  {
    cwd: repoRoot,
    stdio: "inherit",
    env: { ...process.env, TSX_TSCONFIG_PATH: join(repoRoot, "tsconfig.node.json") },
  },
);
process.exit(result.status ?? 1);