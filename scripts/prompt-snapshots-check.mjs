#!/usr/bin/env node
// Gate prompt snapshot drift when the bundled Codex test API is available.
//
// The source distribution does not vendor `openclaw_runtime/extensions/codex/test-api.{ts,js}`,
// so local dev runs skip this gate instead of failing on a missing artifact.
// CI should set OPENCLAW_PROMPT_SNAPSHOTS_REQUIRED=1 to make a missing artifact
// a hard failure before attempting the snapshot check.

import { access, constants } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const candidates = [
  join(root, "openclaw_runtime", "extensions", "codex", "test-api.ts"),
  join(root, "openclaw_runtime", "extensions", "codex", "test-api.js"),
];

let available = false;
for (const candidate of candidates) {
  try {
    await access(candidate, constants.F_OK);
    available = true;
    break;
  } catch {
    // keep looking
  }
}

if (!available) {
  if (process.env.OPENCLAW_PROMPT_SNAPSHOTS_REQUIRED === "1") {
    console.error(
      "[prompt-snapshots] Codex test API is missing and OPENCLAW_PROMPT_SNAPSHOTS_REQUIRED=1.",
    );
    process.exit(1);
  }
  console.warn(
    "[prompt-snapshots] SKIP: bundled Codex test API is not present in this source distribution.",
  );
  process.exit(0);
}

const result = spawnSync(
  process.execPath,
  ["--import", "tsx", "scripts/generate-prompt-snapshots.ts", "--check"],
  {
    cwd: join(root, "openclaw_runtime"),
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  },
);
process.exit(result.status ?? 1);
