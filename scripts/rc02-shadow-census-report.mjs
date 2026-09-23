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
    gapReason:
      'the outermost chatHandlers["chat.send"] handler (src/gateway/server-methods/chat.ts:3152) needs a full GatewayRequestContext, webchat channel plugin and session store fixture. Measured 2026-09-23: driving the shared inbound entry dispatchInboundMessageWithBufferedDispatcher (src/auto-reply/dispatch.ts:532) with a minimal cfg produced no output for 120s and was killed by the vitest no-output watchdog, so this is not a config-only fixture. No test in the repo drives a gateway chat send end to end.',
  },
  {
    id: "cron",
    gapReason:
      "runCronIsolatedAgentTurn (src/cron/isolated-agent/run.ts:1259) is only exercised through run.test-harness.ts, which mocks run-embedded.runtime.js, so the existing coverage cannot prove the real entry. Measured 2026-09-23: an unmocked driver with OPENCLAW_TEST_FAST=1 and a minimal cfg produced no output for 120s and was killed by the no-output watchdog.",
  },
  {
    id: "channel-conformance-fixture",
    gapReason:
      "the inbound leg dispatchInboundMessage (src/auto-reply/dispatch.ts:476) shares the stalled driver above, and the rc05 operator fixture (extensions/channels/rc05-operator-fixture/adapter.ts) is transport-only: it makes no model call, so it cannot carry receipts on its own.",
  },
  {
    id: "cli-compact",
    gapReason:
      "the CLI entry agentCommand (src/agents/agent-command.ts:2229) needs full config/session/env fixtures, and compactEmbeddedAgentSessionDirect (src/agents/embedded-agent-runner/compact.ts:526) needs a pre-filled session transcript past the token budget plus the same runtime bootstrap the stalled entries above hit.",
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

function main() {
  const options = parseArgs(process.argv.slice(2));
  const artifactDir = path.dirname(options.output);
  fs.mkdirSync(artifactDir, { recursive: true });
  // Keep the raw suite output and the machine-readable results next to the
  // artifact so a reader can re-check the counts and the per-test verdicts
  // instead of trusting this summary.
  const logPath = path.join(artifactDir, "suite.log");
  const resultsPath = path.join(artifactDir, "suite-results.json");
  const run = runSuite(resultsPath);
  const counts = parseCounts(run.output);
  fs.writeFileSync(logPath, run.output, "utf8");
  const { passed, failed, total } = passedTestsFromResults(resultsPath);
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
    acceptance: {
      rc02SpecAcceptanceMet: false,
      reason:
        "acceptance requires both receipts for every source-runtime model call in all eight named entry surfaces; only the surfaces listed as real are driven by a real entry today, and no independent RC-00 Executor/Verifier run exists for this increment",
      remainingGaps: gaps.map((gap) => gap.id),
    },
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
