// Gate: the repo root and openclaw_runtime are two separate pnpm workspaces.
// They must pin the identical pnpm version, and the pnpm executing the install
// must match that pin (pnpm >= 10 self-switches via packageManager; corepack too).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function pinnedPnpmVersion(packageJsonPath) {
  const spec = JSON.parse(readFileSync(packageJsonPath, "utf8")).packageManager ?? "";
  const match = /^pnpm@(\d+\.\d+\.\d+)/.exec(spec);
  if (!match) {
    console.error(`[pnpm-toolchain] ${packageJsonPath}: packageManager must pin a pnpm version, got "${spec}"`);
    process.exit(1);
  }
  return match[1];
}

const rootVersion = pinnedPnpmVersion(join(repoRoot, "package.json"));
const runtimeVersion = pinnedPnpmVersion(join(repoRoot, "openclaw_runtime", "package.json"));

if (rootVersion !== runtimeVersion) {
  console.error(
    `[pnpm-toolchain] packageManager mismatch: root pins pnpm@${rootVersion}, openclaw_runtime pins pnpm@${runtimeVersion}. Keep both pins identical.`,
  );
  process.exit(1);
}

const runningVersion = /pnpm\/(\d+\.\d+\.\d+)/.exec(process.env.npm_config_user_agent ?? "")?.[1];
if (runningVersion && runningVersion !== rootVersion) {
  console.error(
    `[pnpm-toolchain] running pnpm@${runningVersion}, but the repo pins pnpm@${rootVersion}. Use the pinned toolchain (pnpm >= 10 self-switches; or corepack enable pnpm).`,
  );
  process.exit(1);
}
