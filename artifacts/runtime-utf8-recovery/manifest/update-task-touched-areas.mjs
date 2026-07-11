import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function listFiles(root, relativeDirectory) {
  const absoluteDirectory = path.join(root, relativeDirectory);
  const result = [];
  for (const entry of fs.readdirSync(absoluteDirectory, { withFileTypes: true })) {
    const relativePath = path.posix.join(relativeDirectory.replaceAll("\\", "/"), entry.name);
    if (entry.isDirectory()) {
      result.push(...listFiles(root, relativePath));
    } else if (entry.isFile()) {
      result.push(relativePath);
    }
  }
  return result;
}

export function collectTouchedAreas(repoRoot, manifest) {
  const fixedPaths = [
    "harness/specs/tasks/runtime-utf8-baseline-remediation.md",
    "docs/superpowers/specs/2026-07-11-dcs-stage1-recovery-orchestration-design.md",
    "docs/superpowers/plans/2026-07-11-dcs-stage1-recovery-orchestration.md",
    "docs/superpowers/plans/2026-07-11-runtime-utf8-recovery-window-launch-pack.md",
    "openclaw_runtime/scripts/runtime-utf8-inventory.mjs",
    "openclaw_runtime/scripts/runtime-utf8-inventory.test.mjs",
  ];
  const evidencePaths = listFiles(repoRoot, "artifacts/runtime-utf8-recovery");
  const productionPaths = manifest.repairs.map((repair) => repair.path);
  return [...new Set([...fixedPaths, ...evidencePaths, ...productionPaths])].sort();
}

export function updateTaskTouchedAreas({ repoRoot, taskPath, manifestPath }) {
  const absoluteTaskPath = path.resolve(repoRoot, taskPath);
  const manifest = JSON.parse(fs.readFileSync(path.resolve(repoRoot, manifestPath), "utf8"));
  const touchedAreas = collectTouchedAreas(repoRoot, manifest);
  const original = fs.readFileSync(absoluteTaskPath, "utf8");
  const blockPattern = /touchedAreas:\r?\n(?:  - [^\r\n]+\r?\n)+expectedUserBehavior:/;
  if (!blockPattern.test(original)) {
    throw new Error("task touchedAreas block was not found");
  }
  const replacement = `touchedAreas:\n${touchedAreas
    .map((touchedPath) => `  - ${touchedPath}`)
    .join("\n")}\nexpectedUserBehavior:`;
  fs.writeFileSync(absoluteTaskPath, original.replace(blockPattern, replacement), "utf8");
  return touchedAreas;
}

function main() {
  const repoRoot = process.argv[2];
  if (!repoRoot) {
    throw new Error("repository root argument is required");
  }
  const touchedAreas = updateTaskTouchedAreas({
    repoRoot: path.resolve(repoRoot),
    taskPath: "harness/specs/tasks/runtime-utf8-baseline-remediation.md",
    manifestPath: "artifacts/runtime-utf8-recovery/manifest/repair-manifest.json",
  });
  console.log(`touchedAreas=${touchedAreas.length}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
