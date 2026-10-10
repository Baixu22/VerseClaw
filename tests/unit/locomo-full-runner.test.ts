// @vitest-environment node
// CLI orchestration only: the child and verifier below are synthetic, never model evidence.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, expect, it } from "vitest";

const RUNNER = "scripts/run-locomo-full-evaluation.mjs";
const FACTS_CACHE = "extracted-facts-cache-v6-additive-p0.json";

/** Stubs the child spawn and the network-touching helpers, and records the child options. */
const PRELOAD = `
  import childProcess from 'node:child_process';
  import fs from 'node:fs';
  import { registerHooks, syncBuiltinESMExports } from 'node:module';
  childProcess.spawnSync = (_command, _args, options) => {
    fs.writeFileSync(process.env.PROBE_CAPTURE, JSON.stringify({
      timeout: options.timeout,
      model: options.env.RUNTIME_MEMORY_LLM_MODEL,
      fullEval: options.env.FULL_EVAL,
      artifactDir: options.env.RUNTIME_MEMORY_EVAL_ARTIFACT_DIR,
      suiteTimeoutMinutes: options.env.RUNTIME_MEMORY_FULL_TEST_TIMEOUT_MINUTES ?? null,
    }));
    return { status: 0 };
  };
  syncBuiltinESMExports();
  registerHooks({ load(url, context, next) {
    if (url.endsWith('/scripts/check-locomo-evidence.mjs')) return { format: 'module', shortCircuit: true, source: 'export function verifyLocomoEvidenceFile() { return { synthetic: true }; }' };
    if (url.endsWith('/tests/unit/helpers/locomo-embedding-provider.ts')) return { format: 'module', shortCircuit: true, source: 'export async function verifyLocomoEmbeddingResources() {}' };
    return next(url, context);
  }});
`;

const scratchDirs: string[] = [];

afterEach(() => {
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scratch(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratchDirs.push(dir);
  return dir;
}

function writePreload(dir: string): string {
  const preload = join(dir, "synthetic-preload.mjs");
  writeFileSync(preload, PRELOAD);
  return preload;
}

function runCli(args: string[], capture: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(
    process.execPath,
    ["--import", pathToFileURL(writePreload(scratch("locomo-cli-preload-"))).href, RUNNER, ...args],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      windowsHide: true,
      env: {
        ...process.env,
        PROBE_CAPTURE: capture,
        RUNTIME_MEMORY_LLM_MODEL: "",
        DEEPSEEK_MODEL: "",
        RUNTIME_MEMORY_LLM_API_KEY: "synthetic-not-a-credential",
        RUNTIME_MEMORY_FULL_TIMEOUT_MINUTES: "",
      },
    },
  );
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function readCapture(capture: string): { timeout: number; model: string; fullEval: string; artifactDir: string; suiteTimeoutMinutes: string | null } {
  return JSON.parse(readFileSync(capture, "utf8"));
}

it("initializes the verifier after CLI model options, not at module load", () => {
  const dir = scratch("locomo-cli-config-");
  const preload = join(dir, "synthetic-preload.mjs");
  const output = join(dir, "output");
  writeFileSync(preload, `
    import childProcess from 'node:child_process';
    import { registerHooks, syncBuiltinESMExports } from 'node:module';
    childProcess.spawnSync = (_command, _args, options) => {
      if (options.env.RUNTIME_MEMORY_LLM_MODEL !== 'step-5-preview' || options.env.FULL_EVAL !== '1') throw Error('Wrong child configuration');
      return { status: 0 };
    };
    syncBuiltinESMExports();
    registerHooks({ load(url, context, next) {
      if (url.endsWith('/scripts/check-locomo-evidence.mjs')) return { format: 'module', shortCircuit: true, source: \`const capturedModel = process.env.RUNTIME_MEMORY_LLM_MODEL; export function verifyLocomoEvidenceFile() { if (capturedModel !== 'step-5-preview') throw Error('Verifier captured stale model'); return { synthetic: true, capturedModel }; }\` };
      if (url.endsWith('/tests/unit/helpers/locomo-embedding-provider.ts')) return { format: 'module', shortCircuit: true, source: 'export async function verifyLocomoEmbeddingResources() {}' };
      return next(url, context);
    }});
  `);
  const result = spawnSync(process.execPath, ["--import", pathToFileURL(preload).href, RUNNER, "--base-url", "https://synthetic.invalid/v1", "--model", "step-5-preview", "--output-dir", output], {
    cwd: process.cwd(), encoding: "utf8", windowsHide: true,
    env: { ...process.env, RUNTIME_MEMORY_LLM_MODEL: "", DEEPSEEK_MODEL: "", RUNTIME_MEMORY_LLM_API_KEY: "synthetic-not-a-credential" },
  });
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ synthetic: true, capturedModel: "step-5-preview" });
  expect(result.stdout + result.stderr).not.toContain("synthetic-not-a-credential");
});

it("caps the child at 90 minutes by default so the budget never silently reverts", () => {
  const capture = join(scratch("locomo-timeout-default-"), "capture.json");
  const output = join(scratch("locomo-timeout-default-out-"), "output");
  const result = runCli(["--base-url", "https://synthetic.invalid/v1", "--model", "step-5-preview", "--output-dir", output], capture);
  expect(result.status, result.stderr).toBe(0);
  expect(readCapture(capture).timeout).toBe(90 * 60 * 1000);
});

it("passes an explicit longer timeout to the child", () => {
  const capture = join(scratch("locomo-timeout-long-"), "capture.json");
  const output = join(scratch("locomo-timeout-long-out-"), "output");
  // 36h matches the test-level budget of the 500-question suite.
  const result = runCli(["--base-url", "https://synthetic.invalid/v1", "--model", "step-5-preview", "--output-dir", output, "--timeout-minutes", "2160"], capture);
  expect(result.status, result.stderr).toBe(0);
  expect(readCapture(capture).timeout).toBe(2160 * 60 * 1000);
});

it("lets the suite budget be raised, but never to at or above the wrapper budget", () => {
  const capture = join(scratch("locomo-child-budget-"), "capture.json");
  const output = join(scratch("locomo-child-budget-out-"), "output");
  const accepted = runCli(
    ["--base-url", "https://synthetic.invalid/v1", "--model", "step-5-preview", "--output-dir", output, "--timeout-minutes", "4800", "--test-timeout-minutes", "4680"],
    capture,
  );
  expect(accepted.status, accepted.stderr).toBe(0);
  expect(readCapture(capture).suiteTimeoutMinutes).toBe("4680");
  expect(readCapture(capture).timeout).toBe(4800 * 60 * 1000);

  // Equal or larger is rejected: the wrapper must never be the one that fires,
  // because a SIGTERM leaves no test failure and no report attempt.
  for (const value of ["4800", "5000"]) {
    const badCapture = join(scratch("locomo-child-budget-bad-"), "capture.json");
    const badOutput = join(scratch("locomo-child-budget-bad-out-"), "output");
    const rejected = runCli(
      ["--base-url", "https://synthetic.invalid/v1", "--model", "step-5-preview", "--output-dir", badOutput, "--timeout-minutes", "4800", "--test-timeout-minutes", value],
      badCapture,
    );
    expect(rejected.status, value).toBe(1);
    expect(rejected.stderr, value).toContain("test-timeout-minutes must be smaller than timeout-minutes");
    expect(existsSync(badOutput), value).toBe(false);
  }
});

it("rejects a non-positive or unparsable timeout instead of falling back", () => {
  for (const value of ["0", "-5", "abc"]) {
    const capture = join(scratch("locomo-timeout-bad-"), "capture.json");
    const output = join(scratch("locomo-timeout-bad-out-"), "output");
    // The `=` form keeps a leading dash from being parsed as another option.
    const result = runCli(["--base-url", "https://synthetic.invalid/v1", "--model", "step-5-preview", "--output-dir", output, `--timeout-minutes=${value}`], capture);
    expect(result.status, value).toBe(1);
    expect(result.stderr, value).toContain("timeout-minutes must be a positive number of minutes");
    expect(existsSync(output), value).toBe(false);
  }
});

it("seeds a fresh output directory from a previous run and records the provenance", () => {
  const capture = join(scratch("locomo-resume-"), "capture.json");
  const source = scratch("locomo-resume-source-");
  writeFileSync(join(source, FACTS_CACHE), JSON.stringify({ "conv-26": [{ text: "synthetic" }] }));
  const output = join(scratch("locomo-resume-out-"), "output");
  const result = runCli([
    "--base-url", "https://synthetic.invalid/v1", "--model", "step-5-preview", "--output-dir", output,
    "--resume-from", source, "--resume-source-revision", "f6fb59821c7efb2a22b3d44946d082cbc4fc0759",
  ], capture);
  expect(result.status, result.stderr).toBe(0);
  expect(existsSync(join(output, FACTS_CACHE))).toBe(true);
  const seed = JSON.parse(readFileSync(join(output, "resume-seed.json"), "utf8"));
  expect(seed.sourceRevision).toBe("f6fb59821c7efb2a22b3d44946d082cbc4fc0759");
  expect(seed.copied).toHaveLength(1);
  expect(seed.copied[0].file).toBe(FACTS_CACHE);
  expect(seed.copied[0].sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(readCapture(capture).artifactDir).toBe(output);
});

it("refuses an unattributed, empty or self-referential resume source", () => {
  const base = ["--base-url", "https://synthetic.invalid/v1", "--model", "step-5-preview"];
  const source = scratch("locomo-resume-guard-");
  writeFileSync(join(source, FACTS_CACHE), "{}");

  const missingRevision = runCli([...base, "--output-dir", join(scratch("locomo-guard-a-"), "output"), "--resume-from", source], join(scratch("locomo-guard-a-cap-"), "capture.json"));
  expect(missingRevision.status).toBe(1);
  expect(missingRevision.stderr).toContain("resume-source-revision");

  const empty = scratch("locomo-resume-empty-");
  const emptySource = runCli([...base, "--output-dir", join(scratch("locomo-guard-b-"), "output"), "--resume-from", empty, "--resume-source-revision", "abc"], join(scratch("locomo-guard-b-cap-"), "capture.json"));
  expect(emptySource.status).toBe(1);
  expect(emptySource.stderr).toContain("none of the resumable caches");

  const shared = scratch("locomo-resume-same-");
  const sameDir = runCli([...base, "--output-dir", join(shared, "output"), "--resume-from", join(shared, "output"), "--resume-source-revision", "abc"], join(scratch("locomo-guard-c-cap-"), "capture.json"));
  expect(sameDir.status).not.toBe(0);
});

it("still refuses to reuse an existing output directory", () => {
  const existing = scratch("locomo-existing-");
  mkdirSync(join(existing, "output"));
  const result = runCli(["--base-url", "https://synthetic.invalid/v1", "--model", "step-5-preview", "--output-dir", join(existing, "output")], join(scratch("locomo-existing-cap-"), "capture.json"));
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("previous run evidence is never overwritten");
});
