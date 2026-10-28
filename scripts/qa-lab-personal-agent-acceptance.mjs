#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeRoot = path.join(root, "openclaw_runtime");
const { values } = parseArgs({
  options: {
    preflight: { type: "boolean" },
    "negative-controls": { type: "boolean" },
    "output-dir": { type: "string" },
    scenario: { type: "string", multiple: true },
  },
});

function commandResult(command, args, cwd = root) {
  const result = spawnSync(command, args, {
    cwd,
    env: process.env,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return result;
}

async function readBuildBinding(candidate) {
  const stamps = {};
  for (const name of [".buildstamp", ".runtime-postbuildstamp"]) {
    const stamp = JSON.parse(await fs.readFile(path.join(runtimeRoot, "dist", name), "utf8"));
    assert.equal(
      stamp.head,
      candidate.commit,
      `Stale QA build ${name}; rebuild private QA for this candidate`,
    );
    stamps[name] = stamp;
  }
  const files = [];
  async function walk(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) {
        const bytes = await fs.readFile(absolute);
        files.push({
          path: path.relative(runtimeRoot, absolute).replaceAll("\\", "/"),
          bytes: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        });
      }
    }
  }
  await walk(path.join(runtimeRoot, "dist"));
  await walk(path.join(runtimeRoot, "dist-runtime"));
  files.sort((left, right) => left.path.localeCompare(right.path));
  return {
    stamps,
    files,
    digest: createHash("sha256").update(JSON.stringify(files)).digest("hex"),
  };
}

async function runNegativeControls() {
  const git = (args) => {
    const result = commandResult("git", args);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  assert.equal(
    git(["status", "--porcelain"]),
    "",
    "Negative controls require a clean source candidate",
  );
  const candidate = {
    commit: git(["rev-parse", "HEAD"]),
    tree: git(["rev-parse", "HEAD^{tree}"]),
    dirty: false,
  };
  const build = await readBuildBinding(candidate);
  const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), "clawx-qa-negative-"));
  const projection = path.join(runRoot, "source");
  await fs.mkdir(projection);
  const archivePath = path.join(runRoot, "source.tar");
  git(["archive", "--format=tar", `--output=${archivePath}`, "HEAD"]);
  const extracted = commandResult("tar", ["-xf", archivePath, "-C", projection]);
  assert.equal(extracted.status, 0, extracted.stderr);
  const packagePaths = git(["ls-files", "*package.json"]).split("\n");
  for (const packagePath of packagePaths) {
    const dependencyPath = path.join(path.dirname(packagePath), "node_modules");
    if (
      await fs.stat(path.join(root, dependencyPath)).then(
        () => true,
        () => false,
      )
    ) {
      await fs.symlink(
        path.join(root, dependencyPath),
        path.join(projection, dependencyPath),
        process.platform === "win32" ? "junction" : "dir",
      );
    }
  }
  const projectedRuntime = path.join(projection, "openclaw_runtime");
  for (const directory of ["dist", "dist-runtime"]) {
    await fs.cp(path.join(runtimeRoot, directory), path.join(projectedRuntime, directory), {
      recursive: true,
    });
  }
  for (const file of build.files) {
    const copied = await fs.readFile(path.join(projectedRuntime, file.path));
    assert.equal(
      createHash("sha256").update(copied).digest("hex"),
      file.sha256,
      `Copied build drift: ${file.path}`,
    );
  }
  const qa = await import(
    pathToFileURL(path.join(runtimeRoot, "dist/extensions/qa-lab/api.js")).href
  );
  const fixturesDir = path.join(projectedRuntime, "qa/scenarios");
  const originals = new Map(
    await Promise.all(
      qa.QA_PERSONAL_AGENT_SCENARIO_IDS.map(async (id) => [
        id,
        await fs.readFile(path.join(fixturesDir, `${id}.md`)),
      ]),
    ),
  );
  const controls = [];
  const run = async (id, args = []) => {
    const outputDir = `.artifacts/qa-e2e/${id}`;
    const invocation = [
      path.join(projection, "scripts/qa-lab-personal-agent-acceptance.mjs"),
      "--output-dir",
      outputDir,
      ...args,
    ];
    const result = commandResult(process.execPath, invocation, projection);
    await fs.writeFile(path.join(runRoot, `${id}.log`), result.stdout + result.stderr);
    assert.equal(result.status, 1, `${id} must exit nonzero`);
    return {
      id,
      command: [process.execPath, ...invocation],
      exitCode: result.status,
      outputDir: path.join(projectedRuntime, outputDir),
      logPath: path.join(runRoot, `${id}.log`),
      stderr: result.stderr,
    };
  };
  const restore = async () => {
    for (const [id, bytes] of originals)
      await fs.writeFile(path.join(fixturesDir, `${id}.md`), bytes);
  };
  try {
    const missingId = qa.QA_PERSONAL_AGENT_SCENARIO_IDS[0];
    await fs.unlink(path.join(fixturesDir, `${missingId}.md`));
    const missing = await run("missing-fixture");
    assert.ok(missing.stderr.includes(`unknown QA scenario id(s): ${missingId}`));
    controls.push(missing);
    await restore();
    for (const id of originals.keys()) await fs.unlink(path.join(fixturesDir, `${id}.md`));
    const emptyApiUrl = pathToFileURL(
      path.join(projectedRuntime, "dist/extensions/qa-lab/api.js"),
    ).href;
    const emptyCount = commandResult(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `const qa = await import(${JSON.stringify(emptyApiUrl)}); console.log(qa.readQaBootstrapScenarioCatalog().scenarios.length);`,
      ],
      projection,
    );
    assert.equal(emptyCount.status, 0, emptyCount.stderr);
    assert.equal(emptyCount.stdout.trim(), "0", "The actual catalog must be empty");
    const empty = await run("empty-catalog");
    assert.ok(empty.stderr.includes("unknown QA scenario id(s)"));
    controls.push({ ...empty, actualCatalogCount: 0 });
    await restore();
    const falseId = "personal-no-fake-progress";
    const falsePath = path.join(fixturesDir, `${falseId}.md`);
    const falseFixture = originals
      .get(falseId)
      .toString("utf8")
      .replace(
        /      - set: effect\r?\n/,
        '      - assert:\n          expr: "false"\n          message: "TF-0578 deliberate false final-state oracle"\n      - set: effect\n',
      );
    assert.ok(falseFixture.includes("deliberate false final-state oracle"));
    await fs.writeFile(falsePath, falseFixture);
    const failed = await run("false-final-state", [
      "--scenario",
      falseId,
      "--scenario",
      "personal-memory-preference-recall",
    ]);
    const summary = JSON.parse(
      await fs.readFile(path.join(failed.outputDir, "qa-suite-summary.json"), "utf8"),
    );
    assert.deepEqual(summary.counts, { total: 2, passed: 1, failed: 1 });
    assert.deepEqual(
      summary.scenarios.map((scenario) => scenario.status),
      ["fail", "pass"],
    );
    assert.ok(summary.scenarios[0].details.includes("deliberate false final-state oracle"));
    const continued = JSON.parse(summary.scenarios[1].steps.at(-1).details);
    assert.equal(continued.waitStatus, "ok");
    const actualArtifact = await fs.readFile(
      path.join(continued.workspaceDir, "personal-progress-proof.txt"),
      "utf8",
    );
    assert.ok(actualArtifact.includes("not sent; not published; not uploaded; not merged"));
    controls.push({
      ...failed,
      counts: summary.counts,
      continued,
      falseClaimArtifactObserved: true,
    });
  } finally {
    await restore();
  }
  assert.equal(git(["status", "--porcelain"]), "", "Original source must remain unchanged");
  const receipt = {
    driven_by: "agent",
    actor: "codex-tf0578-qa-pack",
    candidate,
    build,
    reusedDependencies: true,
    runRoot,
    projection,
    controls,
  };
  const receiptPath = path.join(runRoot, "negative-controls.json");
  await fs.writeFile(receiptPath, JSON.stringify(receipt, null, 2) + "\n");
  console.log(
    JSON.stringify(
      { receiptPath, controls: controls.map(({ id, exitCode }) => ({ id, exitCode })) },
      null,
      2,
    ),
  );
}

try {
  if (values["negative-controls"]) {
    await runNegativeControls();
    process.exit(0);
  }
  const qa = await import(
    pathToFileURL(path.join(runtimeRoot, "dist/extensions/qa-lab/api.js")).href
  );
  const requestedIds = values.scenario?.length
    ? values.scenario
    : [...qa.QA_PERSONAL_AGENT_SCENARIO_IDS];
  const scenarioIds = values.preflight ? requestedIds.slice(0, 1) : requestedIds;
  const result = await qa.runQaSuite({
    repoRoot: runtimeRoot,
    outputDir: values["output-dir"],
    providerMode: "mock-openai",
    scenarioIds,
    concurrency: 1,
    controlUiEnabled: false,
    startLab: qa.startQaLabServer,
  });
  const summary = JSON.parse(await fs.readFile(result.summaryPath, "utf8"));
  assert.deepEqual(
    summary.run.scenarioIds,
    scenarioIds,
    "Selected scenarios must match the request",
  );
  assert.equal(summary.counts.total, scenarioIds.length, "Every requested scenario must execute");
  assert.equal(
    summary.scenarios.length,
    scenarioIds.length,
    "Empty or partial execution is a failure",
  );
  assert.equal(summary.counts.failed, 0, "Failed final-state assertions must fail acceptance");
  assert.equal(summary.counts.passed, scenarioIds.length);
  for (const scenario of summary.scenarios) {
    assert.equal(scenario.status, "pass", `${scenario.name} must pass without skips`);
    assert.ok(scenario.steps.length > 0, "A scenario requires observed steps");
    assert.ok(
      scenario.steps.every((step) => step.status === "pass"),
      "Unexpected skipped steps fail acceptance",
    );
  }
  console.log(
    JSON.stringify(
      {
        driven_by: "agent",
        actor: "codex-tf0578-qa-pack",
        providerMode: "mock-openai",
        evidenceLevel: "source-host",
        summaryPath: result.summaryPath,
        scenarioIds,
        counts: summary.counts,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
