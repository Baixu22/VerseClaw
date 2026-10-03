/**
 * Explicitly replay UAS-00 against a restored historical workspace.
 * Never refresh sealed evidence or authorize acceptance of the current checkout.
 */
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { isMainEntrypoint } from "./lib/entrypoint.mjs";
import { canCloseTf0009, verifyTf0009ClosureEvidence } from "./lib/tf0009-agent-surrogate.mjs";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TASK_SPEC = "harness/specs/tasks/uas-00-evidence-freeze-governance.md";
const USAGE = "Usage: node scripts/uas-00-evidence-freeze.mjs --history-replay --root=<absolute-restored-history-workspace> --output=<new-absolute-file-outside-source-workspaces> [--check]";

const SOURCE_EVIDENCE = [
  ".agent-workbench/task-forest/graph/forest.json",
  ".agent-workbench/task-forest/graph/nodes.json",
  ".agent-workbench/task-forest/exports/task-forest.todos.json",
  "artifacts/first-product-preview/FP-P4-05/decision.json",
  "artifacts/first-product-preview/TF-0009/agent-surrogate-charter.json",
  "artifacts/first-product-preview/TF-0009/agent-surrogate-report.json",
  "artifacts/first-product-preview/TF-0009/evidence-audit.json",
  "artifacts/tf0006-evidence-upgrade/status.json",
  "docs/dev/default-config-matrix.md",
  "docs/dev/first-product-controlled-preview/STATUS.md",
  "docs/dev/first-product-controlled-preview/tasks/FP-P4-03.md",
  "docs/dev/first-product-controlled-preview/tasks/FP-P4-04.md",
  "docs/dev/first-product-controlled-preview/tasks/FP-P4-06.md",
  "docs/dev/handoffs/LATEST.md",
  "docs/dev/unified-agent-system/CAPABILITY-INTEGRATION-AUDIT-AND-ROADMAP.zh-CN.md",
  "docs/dev/unified-agent-system/DEVELOPMENT-LOG.zh-CN.md",
  "docs/dev/unified-agent-system/DEVELOPMENT-STRATEGY.zh-CN.md",
  "harness/specs/rules/tf0009-real-canary-authority.md",
  "harness/specs/rules/uas-00-evidence-freeze-boundary.md",
  "harness/specs/rules/vtoken-foundation-boundary.md",
  "harness/specs/tasks/tf0009-engineering-evidence-audit.md",
  TASK_SPEC,
  "harness/specs/tasks/vtoken-default-off-documentation.md",
  "harness/specs/tasks/vtoken-foundation-bridge.md",
  "package.json",
  "scripts/uas-00-evidence-freeze.mjs",
  "tests/unit/uas-00-evidence-freeze.test.ts",
  "tests/unit/vtoken-default-off-documentation.test.ts",
];

const EXACT_COMMANDS = [
  "node scripts/uas-00-evidence-freeze.mjs --history-replay --root=<absolute-history-workspace> --output=<new-absolute-replay-output>",
  "node scripts/uas-00-evidence-freeze.mjs --history-replay --root=<absolute-history-workspace> --output=<existing-absolute-replay-output> --check",
  `pnpm harness context --spec ${TASK_SPEC}`,
  `pnpm harness validate --spec ${TASK_SPEC} --since HEAD`,
  `pnpm harness run --spec ${TASK_SPEC} --since HEAD`,
  "pnpm exec vitest run tests/unit/uas-00-evidence-freeze.test.ts tests/unit/tf0009-engineering-evidence-audit.test.ts tests/unit/tf0009-agent-surrogate.test.ts tests/unit/vtoken-default-off-documentation.test.ts tests/unit/default-config-matrix.test.ts",
  "pnpm run comms:replay",
  "pnpm run comms:compare",
  "git diff --check",
];

function normalizePath(value) {
  return value.replaceAll("\\", "/");
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256File(absolutePath) {
  return sha256(fs.readFileSync(absolutePath));
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd,
    encoding: options.encoding ?? "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
}

function git(root, args, encoding = "utf8") {
  return run("git", args, { cwd: root, encoding });
}

function readJson(root, relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`missing required UAS-00 evidence: ${relativePath}`);
  }
  return JSON.parse(fs.readFileSync(absolutePath, "utf8"));
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function splitNull(buffer) {
  return buffer
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
}

function collectWorkspaceSnapshot(root) {
  const headSha = git(root, ["rev-parse", "HEAD"]).trim();
  let headRef = "detached";
  try {
    headRef = git(root, ["symbolic-ref", "--short", "-q", "HEAD"]).trim() || "detached";
  } catch {
    // A detached baseline is valid as long as the exact SHA is frozen.
  }

  const trackedDiff = git(root, ["diff", "--binary", "HEAD"], null);
  const stagedDiff = git(root, ["diff", "--binary", "--cached", "HEAD"], null);
  const trackedStatusEntries = splitNull(
    git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=no"], null),
  ).sort();
  const untrackedPaths = splitNull(
    git(root, ["ls-files", "--others", "--exclude-standard", "-z"], null),
  )
    .map(normalizePath)
    .sort();
  const untrackedFiles = untrackedPaths.map((relativePath) => {
    const absolutePath = path.join(root, relativePath);
    const stat = fs.statSync(absolutePath);
    requireCondition(stat.isFile(), `untracked evidence path is not a file: ${relativePath}`);
    return {
      path: relativePath,
      bytes: stat.size,
      sha256: sha256File(absolutePath),
    };
  });

  const trackedDiffSha256 = sha256(trackedDiff);
  const stagedDiffSha256 = sha256(stagedDiff);
  const identity = {
    headSha,
    headRef,
    trackedDiffSha256,
    stagedDiffSha256,
    trackedStatusEntries,
    untrackedFiles,
  };
  return {
    ...identity,
    dirty: trackedStatusEntries.length > 0 || untrackedFiles.length > 0,
    trackedChangeCount: trackedStatusEntries.length,
    untrackedFileCount: untrackedFiles.length,
    snapshotSha256: sha256(JSON.stringify(identity)),
  };
}

function whereExecutable(name) {
  const command = process.platform === "win32" ? "where.exe" : "which";
  const matches = run(command, [name])
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter((entry) => entry && fs.existsSync(entry));
  return matches[0] ?? null;
}

function executableRecord(id, executablePath, version) {
  requireCondition(executablePath && fs.existsSync(executablePath), `${id} executable is unavailable`);
  const stat = fs.statSync(executablePath);
  return {
    id,
    path: path.resolve(executablePath),
    version: version.trim(),
    bytes: stat.size,
    sha256: sha256File(executablePath),
  };
}

function collectExecutables(root) {
  const pnpmName = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const pnpmVersion =
    process.platform === "win32"
      ? run("cmd.exe", ["/d", "/s", "/c", "pnpm.cmd --version"])
      : run(pnpmName, ["--version"]);
  const pythonExecutable = run("py", ["-3", "-c", "import sys; print(sys.executable)"]).trim();
  const electronPackage = readJson(root, "node_modules/electron/package.json");
  const electronExecutable = path.join(
    root,
    "node_modules/electron/dist",
    process.platform === "win32" ? "electron.exe" : "electron",
  );
  return [
    executableRecord("node", process.execPath, process.version),
    executableRecord("git", whereExecutable("git"), run("git", ["--version"])),
    executableRecord("pnpm", whereExecutable(pnpmName), pnpmVersion),
    executableRecord("python", pythonExecutable, run("py", ["-3", "--version"])),
    executableRecord("electron", electronExecutable, `v${electronPackage.version}`),
  ];
}

function collectEvidenceInventory(root) {
  return SOURCE_EVIDENCE.map((relativePath) => {
    const absolutePath = path.join(root, relativePath);
    requireCondition(fs.existsSync(absolutePath), `missing evidence inventory file: ${relativePath}`);
    const stat = fs.statSync(absolutePath);
    return {
      path: relativePath,
      bytes: stat.size,
      sha256: sha256File(absolutePath),
    };
  });
}

function findEngineeringEvidenceEdge(forest) {
  const edges = Object.values(forest.edges ?? {});
  return edges.find(
    (edge) =>
      edge.from === "TF-0011" &&
      edge.to === "TF-0009" &&
      edge.type === "derived_from" &&
      edge.blocking === false,
  );
}

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

export function assertUas00HistoryRoot(root, options = {}) {
  requireCondition(options.historyReplay === true, `Explicit historical replay is required. ${USAGE}`);
  requireCondition(typeof root === "string" && path.isAbsolute(root), `An absolute historical root is required. ${USAGE}`);
  requireCondition(fs.existsSync(root) && fs.statSync(root).isDirectory(), `Historical workspace is missing: ${root}`);
  const canonicalRoot = fs.realpathSync(root);
  requireCondition(!isWithin(fs.realpathSync(REPOSITORY_ROOT), canonicalRoot), "Restore history outside the current source workspace before replaying UAS-00");
  return canonicalRoot;
}

export function buildUas00AuditManifest(root, options = {}) {
  root = assertUas00HistoryRoot(root, options);
  const nodes = readJson(root, ".agent-workbench/task-forest/graph/nodes.json");
  const forest = readJson(root, ".agent-workbench/task-forest/graph/forest.json");
  const tf0009Done = nodes["TF-0009"]?.status === "done";
  const tf0009Report = readJson(
    root,
    tf0009Done ? "artifacts/first-product-preview/TF-0009/policy-acceptance/campaign-report.json"
      : "artifacts/first-product-preview/TF-0009/agent-surrogate-report.json",
  );
  const c1 = readJson(root, "artifacts/first-product-preview/FP-P4-05/decision.json");
  const tf0006 = readJson(root, "artifacts/tf0006-evidence-upgrade/status.json");
  const engineeringEvidenceEdge = findEngineeringEvidenceEdge(forest);
  const tf0011Status = nodes["TF-0011"]?.status;
  const tf0012Status = nodes["TF-0012"]?.status;
  const validEngineeringChainState =
    (tf0011Status === "ready" && tf0012Status === "proposed") ||
    (tf0011Status === "done" && tf0012Status === "ready");

  requireCondition(
    tf0009Done ? verifyTf0009ClosureEvidence(tf0009Report, root) : ["ready", "in_progress", "review_needed", "blocked"].includes(nodes["TF-0009"]?.status),
    "TF-0009 closure requires clean, validated agent evidence under the 2026-09-27 policy",
  );
  requireCondition(!tf0009Done || nodes["TF-0009"]?.progress === 100, "TF-0009 done progress must be 100");
  requireCondition(
    validEngineeringChainState,
    "UAS engineering chain must be TF-0011 ready/TF-0012 proposed or TF-0011 done/TF-0012 ready",
  );
  requireCondition(
    (tf0011Status === "ready" && nodes["TF-0011"]?.progress === 0) ||
      (tf0011Status === "done" && nodes["TF-0011"]?.progress === 100),
    "TF-0011 progress must match its ready or done state",
  );
  requireCondition(Boolean(engineeringEvidenceEdge), "TF-0011 engineering evidence edge is missing");
  requireCondition(tf0009Report.humanEquivalent === false, "TF-0009 human evidence boundary drifted");
  requireCondition(tf0009Report.liveEvidence === false, "TF-0009 live evidence boundary drifted");
  requireCondition(c1.authority?.reductionFactor === 4.5, "C1 authority must remain 4.5x");
  requireCondition(c1.decision?.meetsGate === false, "C1 gate must remain false");
  requireCondition(c1.decision?.recommendation === "keep-off", "C1 recommendation drifted");
  requireCondition(c1.decision?.defaultOn === false, "defaultOn lock drifted");
  requireCondition(c1.decision?.liveReady === false, "liveReady lock drifted");
  requireCondition(c1.decision?.productApproved === false, "productApproved lock drifted");
  requireCondition(tf0006.status === "blocked", "TF-0006 must remain blocked");

  const evidenceInventory = collectEvidenceInventory(root);
  const workspace = collectWorkspaceSnapshot(root);
  requireCondition(workspace.dirty, "UAS-00 must label this baseline as dirty, not clean-release evidence");
  const exportWorkspaceMetadata = forest.workspace_path ?? null;
  const canonicalWorkspace = path.resolve(root);
  const workspaceMetadataMatchesCanonical =
    typeof exportWorkspaceMetadata === "string" &&
    path.resolve(exportWorkspaceMetadata).toLowerCase() === canonicalWorkspace.toLowerCase();

  return {
    schema: "unified-agent-system/uas-00-audit-manifest/v1",
    taskId: "TF-0011",
    phase: "UAS-00",
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    driven_by: "agent",
    actor: "uas00-history-replay",
    historicalReplay: true,
    evidenceClass: "dirty-engineering-baseline-not-release",
    releaseEligible: false,
    humanEquivalent: false,
    liveEvidence: false,
    repository: workspace,
    environment: {
      platform: process.platform,
      arch: process.arch,
      osType: os.type(),
      osRelease: os.release(),
      osVersion: os.version(),
      locale: Intl.DateTimeFormat().resolvedOptions().locale,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      relevantEnv: {
        VERSE_CONTEXT_ASSEMBLER_ENABLED: process.env.VERSE_CONTEXT_ASSEMBLER_ENABLED ?? null,
        VERSE_VTOKEN_ASSEMBLY_ENABLED: process.env.VERSE_VTOKEN_ASSEMBLY_ENABLED ?? null,
        VERSE_VTOKEN_BRIDGE_ENABLED: process.env.VERSE_VTOKEN_BRIDGE_ENABLED ?? null,
        VERSE_CONTEXT_ENHANCEMENT_KILL_SWITCH:
          process.env.VERSE_CONTEXT_ENHANCEMENT_KILL_SWITCH ?? null,
      },
      executables: collectExecutables(root),
    },
    taskForest: {
      tf0009: {
        status: nodes["TF-0009"].status,
        progress: nodes["TF-0009"].progress,
        semanticLabel: tf0009Report.taskForest.semanticLabel,
        humanQualifyingRuns: tf0009Report.humanQualifyingRuns,
        canMarkDone: tf0009Done || canCloseTf0009(tf0009Report, root),
      },
      tf0011: {
        status: nodes["TF-0011"].status,
        progress: nodes["TF-0011"].progress,
        engineeringEvidenceEdge: {
          id: engineeringEvidenceEdge.id,
          type: engineeringEvidenceEdge.type,
          blocking: engineeringEvidenceEdge.blocking,
        },
      },
      nextEngineeringNode: {
        id: "TF-0012",
        status: nodes["TF-0012"].status,
      },
      tf0006: tf0006.status,
      exportWorkspaceMetadata,
      canonicalWorkspace,
      workspaceMetadataMatchesCanonical,
    },
    frozenBoundaries: {
      liveReady: false,
      productApproved: false,
      defaultOn: false,
      c1ReductionFactor: c1.authority.reductionFactor,
      c1MeetsGate: c1.decision.meetsGate,
      c1Recommendation: c1.decision.recommendation,
      tf0006: tf0006.status,
      runtimeMemory: "diagnostics-only",
      sekbAutoWriteback: false,
    },
    authorityMatrix: [
      {
        surface: "durable-event-spine",
        owner: "TF-0012/UAS-01",
        currentAuthority: "existing trajectory/event owners",
        uas00Action: "freeze-only-no-second-journal",
      },
      {
        surface: "final-context-selection-budget-lineage",
        owner: "TF-0013/UAS-02",
        currentAuthority: "Context Orchestrator",
        uas00Action: "freeze-only-no-second-budget",
      },
      {
        surface: "vtoken-stateless-packing",
        owner: "TF-0014/UAS-03",
        currentAuthority: "VerseToken assembly worker",
        uas00Action: "freeze-default-off-no-memory-authority",
      },
      {
        surface: "coding-file-mutation",
        owner: "TF-0015/UAS-04",
        currentAuthority: "Coding tools and write journal",
        uas00Action: "freeze-only-no-second-write-path",
      },
      {
        surface: "local-process-lifecycle",
        owner: "TF-0016/UAS-05",
        currentAuthority: "existing native execution plus default-off VerseShell foundation",
        uas00Action: "freeze-only-no-cutover",
      },
      {
        surface: "cohort-local-execution-cutover",
        owner: "TF-0017/UAS-06",
        currentAuthority: "not-authorized",
        uas00Action: "freeze-only-no-canary-claim",
      },
      {
        surface: "long-term-memory-lifecycle",
        owner: "TF-0018/UAS-07",
        currentAuthority: "diagnostics-only; no production injection",
        uas00Action: "reserve-sole-owner-no-lifecycle-implementation",
      },
    ],
    evidenceInventory,
    evidenceInventorySha256: sha256(JSON.stringify(evidenceInventory)),
    exactCommands: EXACT_COMMANDS,
    readmeReview: {
      behaviorChanged: false,
      translationUpdateRequired: false,
      reviewed: ["README.md", "README.zh-CN.md", "README.ja-JP.md"],
      reason: "UAS-00 adds engineering governance evidence only; no product behavior or interface changed.",
    },
    residuals: [
      "TF-0009 human/live canary remains incomplete at 0/10 per profile.",
      ...(!workspaceMetadataMatchesCanonical
        ? ["Task Forest export metadata still names a workspace other than the canonical audit root."]
        : []),
      "TF-0012 through TF-0014 and FP-P4-03/04 implementation have not started.",
      "No real provider, public-network, soak, or product-approval evidence is created by UAS-00.",
    ],
  };
}

export function compareUas00AuditManifest(expected, actual) {
  const errors = [];
  if (expected.schema !== actual.schema) errors.push("manifest schema drifted");
  if (expected.repository?.snapshotSha256 !== actual.repository?.snapshotSha256) {
    errors.push("working-tree snapshot drifted");
  }
  if (expected.evidenceInventorySha256 !== actual.evidenceInventorySha256) {
    errors.push("evidence inventory drifted");
  }
  if (JSON.stringify(expected.environment?.executables) !== JSON.stringify(actual.environment?.executables)) {
    errors.push("executable evidence drifted");
  }
  if (JSON.stringify(expected.taskForest) !== JSON.stringify(actual.taskForest)) {
    errors.push("Task Forest evidence drifted");
  }
  if (JSON.stringify(expected.frozenBoundaries) !== JSON.stringify(actual.frozenBoundaries)) {
    errors.push("frozen product boundaries drifted");
  }
  return { ok: errors.length === 0, errors };
}

export function parseUas00ReplayArgs(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      "history-replay": { type: "boolean" },
      root: { type: "string" },
      output: { type: "string" },
      check: { type: "boolean" },
    },
    strict: true,
    allowPositionals: false,
  });
  requireCondition(values["history-replay"] === true, `Explicit historical replay is required. ${USAGE}`);
  requireCondition(typeof values.root === "string" && path.isAbsolute(values.root), `An absolute historical root is required. ${USAGE}`);
  requireCondition(typeof values.output === "string" && path.isAbsolute(values.output), `An absolute replay output is required. ${USAGE}`);
  return { historyReplay: true, root: values.root, output: values.output, check: values.check === true };
}

function canonicalOutput(output) {
  let parent = path.resolve(output);
  const absent = [];
  while (!fs.existsSync(parent)) {
    absent.unshift(path.basename(parent));
    const next = path.dirname(parent);
    requireCondition(next !== parent, `Cannot resolve replay output: ${output}`);
    parent = next;
  }
  return path.join(fs.realpathSync(parent), ...absent);
}

export function replayUas00History(options) {
  requireCondition(typeof options?.output === "string" && path.isAbsolute(options.output), `An absolute replay output is required. ${USAGE}`);
  const root = assertUas00HistoryRoot(options.root, options);
  const output = canonicalOutput(options.output);
  requireCondition(!isWithin(root, output) && !isWithin(fs.realpathSync(REPOSITORY_ROOT), output), "Replay output must be outside both historical and current source workspaces");
  if (options.check) {
    requireCondition(fs.existsSync(output), `Missing UAS-00 replay manifest: ${output}`);
    const expected = JSON.parse(fs.readFileSync(output, "utf8"));
    requireCondition(expected.historicalReplay === true, "Only an explicit replay output can be checked; sealed historical evidence is read-only");
    const actual = buildUas00AuditManifest(root, { historyReplay: true, generatedAt: expected.generatedAt });
    const comparison = compareUas00AuditManifest(expected, actual);
    requireCondition(comparison.ok, `UAS-00 manifest is stale: ${comparison.errors.join("; ")}`);
    return expected;
  }

  requireCondition(!fs.existsSync(output), `Refusing to overwrite existing evidence: ${output}`);
  const manifest = buildUas00AuditManifest(root, { historyReplay: true });
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  return manifest;
}

if (isMainEntrypoint(import.meta.url)) {
  try {
    const options = parseUas00ReplayArgs(process.argv.slice(2));
    const manifest = replayUas00History(options);
    console.log(JSON.stringify({
      ok: true,
      check: options.check,
      output: options.output,
      evidenceClass: manifest.evidenceClass,
      historicalReplay: true,
      snapshotSha256: manifest.repository.snapshotSha256,
    }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
