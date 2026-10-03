#!/usr/bin/env node
/**
 * RC-02 shadow-census evidence generator.
 *
 * Runs the RC-02 acceptance suites, then writes a bounded evidence artifact to
 * artifacts/runtime-authority-convergence/rc-02/census.json. The artifact is
 * derived from the real run: every surface row is marked `real` only when its
 * driving test appears as passing in the captured output, and every surface
 * that has no real driver is reported as an explicit `gap` with the reason.
 * Nothing here may be hand-edited into a pass.
 *
 * Usage:
 *   node scripts/rc02-shadow-census-report.mjs [--output <path>] [--reuse-log <path>]
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeDir = path.join(repoRoot, "openclaw_runtime");
const defaultOutput = path.join(
  repoRoot,
  "artifacts",
  "runtime-authority-convergence",
  "rc-02",
  "census.json",
);

const MATRIX_FILE = "rc02-entry-matrix.acceptance.test.ts";
const SUITE_FILES = [
  "receipt-store.test.ts",
  "shadow-census.test.ts",
  "rc02-shadow-census.acceptance.test.ts",
  MATRIX_FILE,
  "rc02-inbound-entry.acceptance.test.ts",
  "rc02-cron-entry.acceptance.test.ts",
  "rc02-cli-entry.acceptance.test.ts",
];
const SUITE_COMMAND = `node scripts/run-vitest.mjs run --config test/vitest/vitest.agents.config.ts ${SUITE_FILES.join(" ")} --passWithNoTests=false`;

/**
 * The eight surfaces the RC-02 spec names. `test` is the driving test that must
 * pass for the row to count as real; a row without a passing driver stays a gap.
 */
const SURFACES = [
  {
    id: "embedded-attempt",
    test: "embedded attempt: runEmbeddedAgent yields a dual receipt per real model call",
    driver: "openclaw_runtime/src/agents/embedded-agent-runner/run.ts (runEmbeddedAgent)",
  },
  {
    id: "provider-payload-hook",
    test:
      "provider payload hook: the production cache-trace hook installs onPayload and receipts still bind the final bytes",
    driver:
      "openclaw_runtime/src/agents/cache-trace.ts (wrapStreamFn/onPayload) installed by run/attempt.ts:3060",
  },
  {
    id: "context-engine",
    test:
      "context engine: the sealed context bundle and the guarded wire body join through one correlation digest",
    driver:
      "openclaw_runtime/src/context-engine/rc03-seal-hook.ts (runRc03SealHook) + provider-transport-fetch.ts (guarded boundary)",
  },
  {
    id: "provider-transport",
    test:
      "uses the production source transport registry as the provider coverage denominator",
    driver:
      "openclaw_runtime/src/agents/provider-transport-stream.ts (listSourceRuntimeTransportDescriptors registry)",
    suite: "rc02-shadow-census.acceptance.test.ts",
  },
  {
    id: "desktop-chat",
    test:
      "desktop chat inbound: dispatchInboundMessage drives a real model call with dual receipts",
    driver:
      "openclaw_runtime/src/auto-reply/dispatch.ts dispatchInboundMessageWithBufferedDispatcher (the shared inbound entry behind chat.send), driven with a bounded bootstrap",
    suite: "rc02-inbound-entry.acceptance.test.ts",
  },
  {
    id: "cron",
    test:
      "cron isolated-agent entry: the real entry drives model calls through the guarded boundary with dual receipts",
    driver:
      "openclaw_runtime/src/cron/isolated-agent/run.ts runCronIsolatedAgentTurn -> run-executor -> runEmbeddedAgent, driven with the bounded bootstrap",
    suite: "rc02-cron-entry.acceptance.test.ts",
  },
  {
    id: "channel-conformance-fixture",
    test:
      "channel conformance fixture inbound: the fixture surface reaches the same guarded boundary",
    driver:
      "openclaw_runtime/src/auto-reply/dispatch.ts dispatchInboundMessageWithBufferedDispatcher with the rc05 operator fixture surface; the fixture adapter itself is transport-only and is proven by its own conformance test",
    suite: "rc02-inbound-entry.acceptance.test.ts",
  },
  {
    id: "cli-compact",
    test:
      "cli agentCommand entry: the real entry drives a model call through the guarded boundary with dual receipts",
    driver:
      "openclaw_runtime/src/agents/agent-command.ts agentCommand, driven with the bounded bootstrap; the compact half of this surface (compactEmbeddedAgentSessionDirect) is not separately driven and is named as a residual",
    suite: "rc02-cli-entry.acceptance.test.ts",
  },
];

/**
 * Drives that were actually attempted for the open surfaces and did not produce
 * a usable real-entry proof. Recorded so the gap reasons are measured facts
 * rather than "nobody wrote a driver yet"; the probe files were deleted and are
 * not part of the suite.
 */
const PROBE_ATTEMPTS = [
  {
    id: "inbound-dispatch",
    entry:
      "openclaw_runtime/src/auto-reply/dispatch.ts:532 dispatchInboundMessageWithBufferedDispatcher (the shared inbound entry behind desktop chat and the channel fixture)",
    command:
      "node scripts/run-vitest.mjs run --config test/vitest/vitest.agents.config.ts rc02-inbound-probe.test.ts --passWithNoTests=false",
    observed:
      "no stdout for 120000ms; the vitest no-output watchdog terminated the stalled process group before any assertion ran",
    conclusion:
      "not a config-only fixture: the entry needs a channel plugin, session store and agent workspace harness; no test in the repo drives a gateway chat send end to end",
    followUpProbe: {
      command:
        "node scripts/run-vitest.mjs run --config test/vitest/vitest.agents.config.ts rc02-diag-probe.test.ts [--pool=forks] --passWithNoTests=false",
      observed: [
        "the model boundary was never reached: the fetch spy logged zero requests before the stall",
        "a 5s heartbeat printed the active resources once (12-20 recursive FSEventWrap watchers plus Timeouts) and then stopped firing, so the event loop is blocked synchronously rather than awaiting something",
        "moving process.cwd() to a temp directory under the forks pool (where chdir is supported) did not change the stall, so repo-shaped CWD scanning is not the cause",
        "the per-test timeout never fired because a blocked event loop cannot run its timer",
      ],
      conclusion:
        "the blocker is synchronous work inside the runtime bootstrap (plugin/workspace loading) that a minimal config does not bound; a driver needs the repo's own bounded harness or a pre-warmed bootstrap, not another config field",
      boundedBootstrapAttempts: [
        {
          attempt: "OPENCLAW_DISABLE_BUNDLED_PLUGINS=1",
          observed:
            "the same entry completes in 2.2s instead of stalling, which pins the block to bundled plugin loading; but the bundled provider catalog goes with it, so the run fails with `Unknown model: openai/gpt-rc02-inbound (model_not_found)` and never reaches the model boundary",
        },
        {
          attempt: 'plugins.allow=["openai"] with bundled discovery enabled',
          observed:
            "still stalls past 120s, so the allowlist does not prevent the full bundled load",
        },
        {
          attempt:
            "OPENCLAW_BUNDLED_PLUGINS_DIR pointing at a temp root with a junction to extensions/openai",
          observed:
            "rejected before running: the fs-safe root guard raises `Symlink escapes plugin root`, so a bounded plugin root cannot be built by symlink",
        },
        {
          attempt:
            "OPENCLAW_DISABLE_BUNDLED_PLUGINS=1 plus explicit registration of the openai plugin's provider and modelCatalogProviders collections into the active registry",
          observed:
            "still `model_not_found`: the model catalog is not resolved from those registry collections, so explicit registration is not enough to make the configured model resolvable",
        },
      ],
      boundedBootstrapConclusion:
        "the entry is drivable only when bundled plugin loading is fast or bounded AND the model catalog still resolves; neither the allowlist nor explicit registration achieves that today, so this row stays a gap until a bounded-bootstrap harness exists",
      resolution:
        "resolved 2026-09-23: with bundled discovery disabled the entry completes in about 2s, and the model catalog is satisfied by seeding the resolved agent models.json (resolveDefaultAgentDir + providers.openai) plus OPENAI_API_KEY for auth. The same recipe then drove every previously open surface: desktop chat and the channel fixture through dispatchInboundMessageWithBufferedDispatcher, cron through runCronIsolatedAgentTurn, and the CLI through agentCommand, so all eight named surfaces now have a real driver. Remaining narrowing: bundled plugin discovery is not exercised, the channel plugin layer is not exercised, and the compact half of the CLI/compact surface is not separately driven",
    },
    probeFileRemoved: true,
  },
  {
    id: "cron-isolated-agent",
    entry:
      "openclaw_runtime/src/cron/isolated-agent/run.ts:1259 runCronIsolatedAgentTurn",
    command:
      "node scripts/run-vitest.mjs run --config test/vitest/vitest.agents.config.ts rc02-cron-probe.test.ts --passWithNoTests=false",
    observed:
      "no stdout for 120000ms with OPENCLAW_TEST_FAST=1 and a minimal cfg; the watchdog terminated the stalled process group (the 90s per-test timeout never surfaced)",
    conclusion:
      "the only existing driver (run.test-harness.ts) mocks run-embedded.runtime.js, so it cannot prove the real entry; an unmocked driver stalls on the same runtime bootstrap",
    probeFileRemoved: true,
  },
];

const PARITY_PROOFS = [
  {
    id: "observer-off-on-byte-parity",
    test:
      "observer off/on parity: identical serialized bytes and tool order per registry api",
    claim: "installing the observer does not change the serialized request bytes",
  },
  {
    id: "tool-order-parity",
    test:
      "observer off/on parity: identical serialized bytes and tool order per registry api",
    claim:
      "tool order stays canonical and identical with the observer installed (the transport sorts tools; observation does not reorder them)",
  },
  {
    id: "retry-identity-parity",
    test: "retry identity: a repeated wire attempt keeps the bytes and gets its own receipt",
    claim:
      "a repeated wire attempt keeps identical bytes and gets its own wire_attempt_index receipt",
  },
  {
    id: "no-extra-side-effect-traffic",
    test: "no approval or delivery traffic is added by observation",
    claim: "observation adds no approval or delivery HTTP traffic",
  },
];

function parseArgs(argv) {
  const options = { output: defaultOutput };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--output") options.output = path.resolve(argv[++index]);
  }
  return options;
}

function runSuite(resultsPath) {
  const result = spawnSync(
    process.execPath,
    [
      "scripts/run-vitest.mjs",
      "run",
      "--config",
      "test/vitest/vitest.agents.config.ts",
      ...SUITE_FILES,
      "--passWithNoTests=false",
      "--reporter=default",
      "--reporter=json",
      `--outputFile=${resultsPath}`,
    ],
    {
      cwd: runtimeDir,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  return {
    exitCode: result.status ?? 1,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

function parseCounts(output) {
  // Anchor to line start: test titles can contain the words "Tests"/"Test Files".
  const files = /^\s*Test Files\s+(.*)$/mu.exec(output)?.[1]?.trim() ?? "unknown";
  const tests = /^\s*Tests\s+(.*)$/mu.exec(output)?.[1]?.trim() ?? "unknown";
  return { testFiles: files, tests };
}

/**
 * Read the machine-readable Vitest results. The default reporter only prints
 * tests above a duration threshold, so parsing its checkmarks silently misses
 * fast tests and would under-report coverage.
 */
function passedTestsFromResults(resultsPath) {
  const raw = JSON.parse(fs.readFileSync(resultsPath, "utf8"));
  const passed = new Set();
  const failed = new Set();
  for (const file of raw.testResults ?? []) {
    for (const assertion of file.assertionResults ?? []) {
      const name = assertion.title ?? assertion.fullName ?? "";
      if (!name) continue;
      if (assertion.status === "passed") passed.add(name);
      else failed.add(name);
    }
  }
  return { passed, failed, total: raw.numTotalTests ?? passed.size + failed.size };
}

function git(args) {
  const result = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
  return (result.stdout ?? "").trim();
}

/**
 * Porcelain output must not be trimmed: the first line's two-character status
 * prefix starts with a space, and trimming the whole output eats it.
 */
function gitPorcelainLines() {
  const result = spawnSync("git", ["status", "--porcelain"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return (result.stdout ?? "").split(/\r?\n/u).filter(Boolean);
}

function runCommand(command, cwd) {
  const result = spawnSync(process.env.ComSpec ?? "cmd.exe", ["/c", command], {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    command,
    cwd: path.relative(repoRoot, cwd).replaceAll("\\", "/") || ".",
    exitCode: result.status ?? 1,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

/** The spec's remaining requiredTests, run so the artifact is self-contained. */
function runRequiredGates() {
  const gates = [
    {
      id: "required-test-2",
      command: "pnpm exec vitest run tests/unit/agent-engineering-acceptance.test.ts",
    },
    {
      id: "required-test-3",
      command:
        "pnpm exec vitest run tests/unit/runtime-authority-convergence-control-pack.test.ts",
    },
    {
      id: "required-test-4",
      command:
        "pnpm harness validate --spec harness/specs/tasks/rc02-full-payload-shadow-census.md",
    },
  ];
  return gates.map((gate) => {
    const result = runCommand(gate.command, repoRoot);
    const counts = parseCounts(result.output);
    return {
      id: gate.id,
      command: result.command,
      exitCode: result.exitCode,
      testFiles: counts.testFiles,
      tests: counts.tests,
      outputSha256: createHash("sha256").update(result.output).digest("hex"),
      ...(gate.id === "required-test-4"
        ? { specValid: result.output.includes("Spec is valid") }
        : {}),
    };
  });
}

const ACCEPTANCE_RUN_DIR = "artifacts/agent-engineering-acceptance/runs/rc02r-accept-2";
const ACCEPTANCE_ARCHIVE_DIR = "artifacts/runtime-authority-convergence/rc-02/acceptance";

function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

/**
 * Formal RC-00 acceptance evidence, derived from the run's own reports on disk.
 * The reports are also archived byte-identically into the tracked rc-02 package
 * directory, because the runner keeps its run outputs gitignored.
 */
function acceptanceSection(gaps) {
  const runDir = path.join(repoRoot, ACCEPTANCE_RUN_DIR);
  const archiveDir = path.join(repoRoot, ACCEPTANCE_ARCHIVE_DIR);
  const reports = {
    manifest: path.join(runDir, "manifest.json"),
    plan: path.join(runDir, "plan.json"),
    executorReport: path.join(runDir, "executor-report.json"),
    verifierReport: path.join(runDir, "verifier-report.json"),
    finalReport: path.join(runDir, "final-report.json"),
  };
  const finalReport = readJsonIfPresent(reports.finalReport);
  if (!finalReport) {
    return {
      rc02SpecAcceptanceMet: false,
      reason: `no RC-00 acceptance run found at ${ACCEPTANCE_RUN_DIR}`,
      remainingGaps: gaps.map((gap) => gap.id),
    };
  }
  const executorReport = readJsonIfPresent(reports.executorReport);
  const manifest = readJsonIfPresent(reports.manifest);

  fs.mkdirSync(archiveDir, { recursive: true });
  const archivedReports = [];
  for (const [id, source] of Object.entries(reports)) {
    if (!fs.existsSync(source)) continue;
    const target = path.join(archiveDir, `${id}.json`);
    fs.copyFileSync(source, target);
    archivedReports.push({
      id,
      source: path.relative(repoRoot, source).replaceAll("\\", "/"),
      archive: path.relative(repoRoot, target).replaceAll("\\", "/"),
      sha256: createHash("sha256").update(fs.readFileSync(source)).digest("hex"),
    });
  }

  const failures = finalReport.failures ?? [];
  const met =
    finalReport.result === "pass" &&
    finalReport.engineeringAcceptedByAgent === true &&
    failures.length === 0 &&
    gaps.length === 0;
  return {
    rc02SpecAcceptanceMet: met,
    runDir: ACCEPTANCE_RUN_DIR,
    candidate: manifest?.candidate?.commit,
    cleanAtPlan: manifest?.candidate?.cleanAtPlan,
    gateCount: manifest?.gates?.length,
    executor: {
      role: executorReport?.role,
      result: executorReport?.result,
      actor: executorReport?.actor,
      failures: (executorReport?.failures ?? []).length,
      reportDigest: executorReport?.reportDigest,
      testCounts: executorReport?.testCounts,
    },
    final: {
      role: finalReport.role,
      result: finalReport.result,
      actor: finalReport.actor,
      engineeringAcceptedByAgent: finalReport.engineeringAcceptedByAgent,
      failures: failures.length,
      reportDigest: finalReport.reportDigest,
      testCounts: finalReport.testCounts,
    },
    archivedReports,
    ...(met ? {} : { remainingGaps: gaps.map((gap) => gap.id) }),
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const artifactDir = path.dirname(options.output);
  fs.mkdirSync(artifactDir, { recursive: true });
  // Keep the raw suite output and the machine-readable results next to the
  // artifact so a reader can re-check the counts and the per-test verdicts
  // instead of trusting this summary.
  const logPath = path.join(artifactDir, "suite.log");
  const resultsPath = path.join(artifactDir, "suite-results.json");
  // The suite has two pre-existing environment flakes on this host (a Windows
  // temp-dir cleanup EPERM and "database is locked" in the receipt-store
  // concurrent-writer tests). Retry a bounded number of times and record EVERY
  // attempt, so a green run is a real observation and the flakiness stays
  // visible instead of being averaged away.
  const attempts = [];
  let run = { exitCode: 1, output: "" };
  let passed = new Set();
  let failed = new Set();
  let total = 0;
  for (let index = 0; index < 3; index += 1) {
    run = runSuite(resultsPath);
    const attemptCounts = parseCounts(run.output);
    let attemptResults = { passed: new Set(), failed: new Set(), total: 0 };
    try {
      attemptResults = passedTestsFromResults(resultsPath);
    } catch {
      // No parseable results for this attempt; the exit code still counts.
    }
    attempts.push({
      attempt: index + 1,
      exitCode: run.exitCode,
      testFiles: attemptCounts.testFiles,
      tests: attemptCounts.tests,
      failedTests: [...attemptResults.failed].toSorted(),
      outputSha256: createHash("sha256").update(run.output).digest("hex"),
    });
    passed = attemptResults.passed;
    failed = attemptResults.failed;
    total = attemptResults.total;
    if (run.exitCode === 0) break;
  }
  const counts = parseCounts(run.output);
  fs.writeFileSync(logPath, run.output, "utf8");
  const requiredGates = runRequiredGates();
  const statusLines = gitPorcelainLines();

  const surfaces = SURFACES.map((surface) => {
    if (surface.gapReason) {
      return { id: surface.id, status: "gap", driver: null, gapReason: surface.gapReason };
    }
    const driven = passed.has(surface.test);
    return {
      id: surface.id,
      status: driven ? "real" : "gap",
      driver: surface.driver,
      test: surface.test,
      suite: surface.suite ?? MATRIX_FILE,
      ...(driven ? {} : { gapReason: `driving test did not pass in this run: ${surface.test}` }),
    };
  });

  const parity = PARITY_PROOFS.map((proof) => ({
    id: proof.id,
    status: passed.has(proof.test) ? "proved" : "not-proved",
    claim: proof.claim,
    test: proof.test,
  }));

  const realSurfaces = surfaces.filter((surface) => surface.status === "real").length;
  const gaps = surfaces.filter((surface) => surface.status === "gap");

  const evidence = {
    schema: "runtime-authority-convergence-rc-02-census/v1",
    generatedAt: new Date().toISOString(),
    node: process.version,
    candidate: {
      branch: git(["rev-parse", "--abbrev-ref", "HEAD"]),
      head: git(["rev-parse", "HEAD"]),
      headShort: git(["rev-parse", "--short", "HEAD"]),
      workingTree: statusLines.length > 0 ? "dirty" : "clean",
      changedPaths: statusLines
        .map((line) => line.slice(3).trim())
        .filter(Boolean)
        .toSorted(),
    },
    requiredGates,
    suite: {
      command: SUITE_COMMAND,
      cwd: "openclaw_runtime",
      exitCode: run.exitCode,
      green: run.exitCode === 0,
      attempts,
      testFiles: counts.testFiles,
      tests: counts.tests,
      totalTests: total,
      passedCount: passed.size,
      failedCount: failed.size,
      failedTests: [...failed].toSorted(),
      outputSha256: createHash("sha256").update(run.output).digest("hex"),
      outputBytes: Buffer.byteLength(run.output),
      log: path.relative(repoRoot, logPath).replaceAll("\\", "/"),
      results: path.relative(repoRoot, resultsPath).replaceAll("\\", "/"),
      passedTests: [...passed].toSorted(),
    },
    entryMatrix: {
      realSurfaces,
      namedSurfaces: SURFACES.length,
      complete: gaps.length === 0,
      surfaces,
    },
    parity,
    probeAttempts: PROBE_ATTEMPTS,
    ownerClassification: {
      claim:
        "every persisted wire receipt carries a named adapter and provider and runtime_mode=source; the matrix fails if any row is unowned",
      limitation:
        "buildWireOwnerCensus currently assigns every final-body leaf to the named transport adapter; a per-field producer/transform split is not implemented, so this is an ownership-completeness check, not a field-level attribution map",
      enforcedBy: MATRIX_FILE,
    },
    npmFallback: {
      claim: "runtimeMode=npm reports degraded, receiptCoverage=0, readiness=false and never counts as source coverage",
      enforcedBy: "rc02-shadow-census.acceptance.test.ts",
      verifiedInThisRun: passed.has("npm fallback reports runtimeMode=npm and never counts as source coverage"),
    },
    acceptance: acceptanceSection(gaps),
    productLocks: {
      liveReady: false,
      productApproved: false,
      defaultOn: false,
    },
  };

  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  process.stdout.write(
    `RC-02 census evidence -> ${path.relative(repoRoot, options.output)}\n` +
      `  suite exit=${run.exitCode} files=${counts.testFiles} tests=${counts.tests}\n` +
      `  real surfaces=${realSurfaces}/${SURFACES.length} gaps=${gaps.map((gap) => gap.id).join(",") || "none"}\n` +
      `  parity proved=${parity.filter((proof) => proof.status === "proved").length}/${parity.length}\n`,
  );
  if (run.exitCode !== 0) process.exitCode = 1;
}

main();
