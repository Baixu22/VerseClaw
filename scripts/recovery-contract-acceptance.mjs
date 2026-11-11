#!/usr/bin/env node
/** Run the unchanged frozen workload on a clean candidate; retain failed attempts and raw evidence. */
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  copyFileSync,
  openSync,
  closeSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { freemem } from "node:os";
import { gzipSync } from "node:zlib";
import { buildRecoveryContractManifest } from "../shared/recovery-contract-eval.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (key, fallback) => {
  const index = process.argv.indexOf(key);
  return index < 0 ? fallback : process.argv[index + 1];
};
const out = resolve(arg("--out", "D:/tmp/recovery-frozen-acceptance"));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const git = (...args) =>
  execFileSync("git", args, { cwd: root, windowsHide: true, maxBuffer: 32 * 1024 * 1024 })
    .toString()
    .trim();
if (git("status", "--porcelain")) throw new Error("freeze a clean candidate before sampling");
mkdirSync(out, { recursive: true });
const freezeFile = join(out, "candidate.json");
const candidate = {
  commit: git("rev-parse", "HEAD"),
  tree: git("rev-parse", "HEAD^{tree}"),
  dirty: false,
};
if (
  existsSync(freezeFile) &&
  JSON.parse(readFileSync(freezeFile, "utf8")).commit !== candidate.commit
)
  throw new Error("candidate changed; use a new output directory");
writeFileSync(
  freezeFile,
  JSON.stringify(
    { ...candidate, driven_by: "agent", actor: "recovery-acceptance", realHumanEvidence: false },
    null,
    2,
  ) + "\n",
);
const resource = {};
const resourceFile = arg("--resource-file", "");
if (resourceFile) {
  const saved = readFileSync(resolve(resourceFile), "utf8");
  for (const key of ["BASE_URL", "API_KEY", "MODEL"]) {
    const match = saved.match(
      new RegExp("\\$env:RECOVERY_LIVE_" + key + '\\s*=\\s*["\x27]([^"\x27]+)["\x27]'),
    );
    if (!match) throw new Error("authorized live resource missing: " + key);
    resource["RECOVERY_LIVE_" + key] = match[1];
  }
}
for (const key of ["BASE_URL", "API_KEY", "MODEL"])
  if (!(resource["RECOVERY_LIVE_" + key] ?? process.env["RECOVERY_LIVE_" + key]))
    throw new Error("live resource missing: " + key);
const stagesFile = join(out, "stages.json");
const stages = existsSync(stagesFile) ? JSON.parse(readFileSync(stagesFile, "utf8")) : [];
async function run(name, args, env = {}) {
  let waited = 0;
  while (freemem() < 1200 * 1024 * 1024) {
    console.log(
      `[acceptance] ${name}: waiting for memory (${Math.round(freemem() / 1024 / 1024)} MB)`,
    );
    await new Promise((resolveWait) => setTimeout(resolveWait, 15_000));
    waited += 15_000;
  }
  const log = join(
    out,
    `${String(stages.length).padStart(2, "0")}-${name.replaceAll(/[^a-z0-9-]/gi, "-")}.log`,
  );
  const fd = openSync(log, "w");
  const startedAt = Date.now();
  console.log(`[acceptance] start ${name}`);
  const proc = spawn(process.execPath, args, {
    cwd: root,
    windowsHide: true,
    stdio: ["ignore", fd, fd],
    env: { ...process.env, ...resource, ...env, TEMP: "D:/tmp", TMP: "D:/tmp" },
  });
  const exit = await new Promise((resolveRun, reject) => {
    proc.once("error", reject);
    proc.once("exit", (code, signal) => resolveRun({ code, signal }));
  });
  closeSync(fd);
  stages.push({
    name,
    ...exit,
    startedAt: new Date(startedAt).toISOString(),
    elapsedMs: Date.now() - startedAt,
    setupWaitMs: waited,
    log,
  });
  writeFileSync(stagesFile, JSON.stringify(stages, null, 2) + "\n");
  console.log(`[acceptance] end ${name}: ${exit.code}`);
  return exit.code;
}
const manifest = buildRecoveryContractManifest();
for (const arm of ["candidate", "legacy"])
  for (const family of ["handoff", "fork", "compression", "revocation", "restart"]) {
    const dir = join(out, "quality", arm);
    mkdirSync(dir, { recursive: true });
    for (let attempt = 0; attempt < 3; attempt++) {
      const missing = manifest.longSessionPairs
        .filter((pair) => pair.family === family && !existsSync(join(dir, `pair-${pair.id}.json`)))
        .map((pair) => pair.id);
      if (!missing.length) break;
      const runDir = join(out, "quality-runs", arm, `${family}-${stages.length}`);
      mkdirSync(runDir, { recursive: true });
      await run(
        `quality-${arm}-${family}-${attempt}`,
        [
          join(root, "node_modules/@playwright/test/cli.js"),
          "test",
          "tests/e2e/recovery-longsession-eval.spec.ts",
          "--reporter=list",
        ],
        {
          RECOVERY_ARM: arm,
          RECOVERY_LONGSESSION_FAMILY: family,
          RECOVERY_LONGSESSION_IDS: missing.join(","),
          RECOVERY_LONGSESSION_OUT: runDir,
          CLAWX_E2E_KEEP_TEMP: "1",
          CLAWX_E2E_APP_LOGS: "1",
        },
      );
      for (const name of readdirSync(runDir).filter(
        (name) => name.startsWith("pair-") && name.endsWith(".json"),
      )) {
        if (existsSync(join(dir, name)))
          throw new Error("completed quality sample would be overwritten");
        copyFileSync(join(runDir, name), join(dir, name));
      }
    }
  }
const matrixDir = join(out, "windows");
if (!existsSync(join(matrixDir, "matrix-run.json"))) {
  await run(
    "windows-both-arms",
    ["scripts/recovery-contract-matrix.mjs", "--arm", "both", "--repeats", "3", "--out", matrixDir],
    { RECOVERY_SHADOW: "1" },
  );
}
if (git("rev-parse", "HEAD") !== candidate.commit || git("status", "--porcelain"))
  throw new Error("candidate changed during sampling");
const windows = [],
  quality = [],
  artifacts = new Map();
for (const arm of ["legacy", "candidate"])
  for (const [kind, receipts] of [
    ["windows", windows],
    ["quality", quality],
  ]) {
    const dir = join(out, kind, arm);
    if (!existsSync(dir)) continue;
    const prefix = kind === "windows" ? "trial-" : "pair-";
    for (const name of readdirSync(dir).filter(
      (name) => name.startsWith(prefix) && name.endsWith(".json"),
    )) {
      const receipt = JSON.parse(readFileSync(join(dir, name), "utf8"));
      receipts.push(receipt);
      for (const artifact of receipt.artifacts) {
        const bytes = readFileSync(artifact.path);
        if (sha(bytes) !== artifact.sha256)
          throw new Error("raw evidence changed: " + artifact.path);
        artifacts.set(artifact.path, {
          path: artifact.path,
          sha256: artifact.sha256,
          base64: bytes.toString("base64"),
        });
      }
    }
  }
const bundle = {
  schema: "RecoveryRawEvidence/v1",
  candidate,
  manifestHash: manifest.manifestHash,
  windows,
  quality,
  artifacts: [...artifacts.values()],
  stages,
  driven_by: "agent",
  actor: "recovery-acceptance",
  realHumanEvidence: false,
};
const bundlePath = join(out, "raw-evidence.json.gz");
writeFileSync(bundlePath, gzipSync(JSON.stringify(bundle), { level: 9 }));
for (const arm of ["legacy", "candidate"])
  await run(`report-${arm}`, [
    "scripts/recovery-contract-eval.mjs",
    "--bundle",
    bundlePath,
    "--batch",
    "--arm",
    arm,
    "--output",
    join(out, arm + "-report.json"),
  ]);
console.log(
  JSON.stringify({
    candidate,
    windowSamples: windows.length,
    qualitySamples: quality.length,
    bundleSha256: sha(readFileSync(bundlePath)),
    out,
  }),
);
process.exitCode = windows.length === 30 && quality.length === 60 ? 0 : 1;
