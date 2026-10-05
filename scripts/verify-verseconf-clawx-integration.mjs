#!/usr/bin/env node
/** Agent-driven verification for TF-0246..TF-0252. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import net from "node:net";
import { createRequire } from "node:module";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { values } = parseArgs({ options: { "output-dir": { type: "string" }, "seven-zip": { type: "string" } } });
const extensionRoot = path.join(root, "openclaw_runtime", "extensions", "verseconf-artifacts");
const packagedRuntimeRoot = path.join(root, "release", "win-unpacked", "resources", "openclaw-runtime");
const packagedExtensionRoot = path.join(packagedRuntimeRoot, "dist", "extensions", "verseconf-artifacts");
const appVersion = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
const installerPath = path.join(root, "release", `Verse Claw-${appVersion}-win-x64.exe`);
const sevenZip = values["seven-zip"] ?? (process.platform === "win32" ? "C:\\Program Files\\7-Zip\\7z.exe" : "7z");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const evidenceRoot = path.resolve(values["output-dir"] ?? path.join(root, "artifacts", "verseconf-clawx-integration", "runs", runId));
const reportPath = path.join(evidenceRoot, "verification.json");
if (existsSync(reportPath)) throw new Error("Verification output already exists; use a fresh output directory");
const manifestPath = path.join(evidenceRoot, "SHA256SUMS");
const credentialScanPath = path.join(evidenceRoot, "credential-scan.json");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const fileSha = (file) => sha256(readFileSync(file));
const checks = [];
function assertDelivery(pluginRoot) {
  const vendorRoot = path.join(pluginRoot, "vendor", "verseconf");
  assert.deepEqual(JSON.parse(readFileSync(path.join(pluginRoot, "verseconf-delivery-lock.json"), "utf8")), deliveryLock);
  assert.equal(fileSha(path.join(vendorRoot, "delivery-manifest.json")), deliveryLock.manifestSha256);
  const files = [{ path: "delivery-manifest.json" }, ...deliveryManifest.files];
  for (const file of files) {
    const target = path.join(vendorRoot, file.path);
    const stat = lstatSync(target);
    assert.equal(stat.isSymbolicLink(), false, `linked delivery file: ${target}`);
    assert.equal(stat.isFile(), true, `non-file delivery entry: ${target}`);
    if (file.sha256) {
      assert.equal(stat.size, file.bytes, target);
      assert.equal(fileSha(target), file.sha256, target);
    }
  }
  const actual = [];
  function visit(dir, prefix = "") {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      assert.equal(entry.isSymbolicLink(), false, `linked delivery entry: ${path.join(dir, entry.name)}`);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) visit(path.join(dir, entry.name), relative);
      else actual.push(relative);
    }
  }
  visit(vendorRoot);
  assert.deepEqual(actual.sort(), files.map((file) => file.path).sort());
}
function check(name, fn) {
  try { fn(); checks.push({ name, ok: true }); }
  catch (error) { checks.push({ name, ok: false, message: error instanceof Error ? error.message : String(error) }); }
}
async function asyncCheck(name, fn) {
  try { await fn(); checks.push({ name, ok: true }); }
  catch (error) { checks.push({ name, ok: false, message: error instanceof Error ? error.message : String(error) }); }
}
function unwrap(toolResult) {
  return toolResult?.details ?? JSON.parse(toolResult?.content?.[0]?.text ?? "null");
}

const pluginManifest = JSON.parse(readFileSync(path.join(extensionRoot, "openclaw.plugin.json"), "utf8"));
const packageManifest = JSON.parse(readFileSync(path.join(extensionRoot, "package.json"), "utf8"));
const vendorPackageManifest = JSON.parse(readFileSync(path.join(extensionRoot, "vendor", "verseconf", "package.json"), "utf8"));
const buildManifest = JSON.parse(readFileSync(path.join(extensionRoot, "vendor", "verseconf", "build-manifest.json"), "utf8"));
const deliveryLock = JSON.parse(readFileSync(path.join(extensionRoot, "verseconf-delivery-lock.json"), "utf8"));
const deliveryManifestPath = path.join(extensionRoot, "vendor", "verseconf", "delivery-manifest.json");
const deliveryManifest = JSON.parse(readFileSync(deliveryManifestPath, "utf8"));
const wasmPath = path.join(extensionRoot, "vendor", "verseconf", "pkg", "verseconf_wasm_bg.wasm");
const gluePath = path.join(extensionRoot, "vendor", "verseconf", "pkg", "verseconf_wasm.js");
const workerPath = path.join(extensionRoot, "vendor", "verseconf", "worker", "index.mjs");
const schemaPath = path.join(extensionRoot, "schemas", "research-source.schema.json");
const fixturePath = path.join(extensionRoot, "fixtures", "research-before.json");

check("manifest.plugin-is-disabled-by-default", () => assert.equal(pluginManifest.enabledByDefault, false));
check("manifest.node-delivery-is-locked", () => { assert.equal(buildManifest.deliveryTarget, "node"); assert.equal(buildManifest.locked, true); });
check("manifest.source-and-runtime-present", () => { for (const file of [wasmPath, gluePath, workerPath, schemaPath, fixturePath, path.join(extensionRoot, "templates", "slide-outline-template.pptx"), path.join(extensionRoot, "vendor", "verseconf", "LICENSE-MIT"), path.join(extensionRoot, "vendor", "verseconf", "LICENSE-APACHE")] ) assert.equal(existsSync(file), true, file); });
check("manifest.has-no-channel-surface", () => { assert.equal(pluginManifest.contracts?.channels ?? undefined, undefined); assert.equal(pluginManifest.enabledByDefault, false); });
check("manifest.package-version-is-pinned", () => {
  assert.equal(vendorPackageManifest.version, deliveryLock.packageVersion);
  assert.equal(vendorPackageManifest.version, deliveryManifest.package.version);
  assert.equal(vendorPackageManifest.verseconf.sourceVersion, buildManifest.package.version);
  assert.equal(fileSha(deliveryManifestPath), deliveryLock.manifestSha256);
  for (const file of deliveryManifest.files) assert.equal(fileSha(path.join(extensionRoot, "vendor", "verseconf", file.path)), file.sha256, file.path);
});
check("manifest.wasm-fingerprint-matches-build", () => { const expected = buildManifest.outputs.find((entry) => entry.path === "pkg/verseconf_wasm_bg.wasm"); assert.equal(fileSha(wasmPath), expected.sha256); });
check("manifest.glue-fingerprint-matches-build", () => { const expected = buildManifest.outputs.find((entry) => entry.path === "pkg/verseconf_wasm.js"); assert.equal(fileSha(gluePath), expected.sha256); });
check("electron-unpacked-plugin-present", () => {
  const files = [
    "index.js",
    "openclaw.plugin.json",
    "package.json",
    "schemas/research-source.schema.json",
    "templates/slide-outline-template.pptx",
    "vendor/verseconf/build-manifest.json",
    "vendor/verseconf/pkg/verseconf_wasm_bg.wasm",
    "vendor/verseconf/worker/index.mjs",
  ];
  for (const relative of files) assert.equal(existsSync(path.join(packagedExtensionRoot, relative)), true, relative);
});
check("electron-unpacked-plugin-has-no-developer-absolute-path", () => {
  const packageText = readFileSync(path.join(packagedExtensionRoot, "index.js"), "utf8");
  assert.equal(packageText.includes("C:/Users/27933/Desktop/verse-conf"), false);
  assert.equal(packageText.includes("C\\Users\\27933\\Desktop\\verse-conf"), false);
});
check("electron-installer-present", () => {
  assert.equal(existsSync(installerPath), true, installerPath);
  assert.ok(lstatSync(installerPath).size > 1_000_000);
});
for (const [label, pluginRoot] of [
  ["source", extensionRoot],
  ["runtime-dist", path.join(root, "openclaw_runtime", "dist", "extensions", "verseconf-artifacts")],
  ["runtime-overlay", path.join(root, "openclaw_runtime", "dist-runtime", "extensions", "verseconf-artifacts")],
  ["electron-dist", packagedExtensionRoot],
  ["electron-overlay", path.join(packagedRuntimeRoot, "dist-runtime", "extensions", "verseconf-artifacts")],
]) check(`delivery.${label}.complete-regular-files`, () => assertDelivery(pluginRoot));
const installerEvidence = { status: "not-run" };
await asyncCheck("electron-installer.embedded-delivery-matches-current-source", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "verseconf-installer-"));
  try {
    execFileSync(sevenZip, ["x", "-y", installerPath, `-o${tempRoot}`, "$PLUGINSDIR\\app-64.7z"], { stdio: "pipe", timeout: 120_000 });
    const embeddedArchive = path.join(tempRoot, "$PLUGINSDIR", "app-64.7z");
    // electron-builder removes the intermediate archive after a successful build.
    // Verify the installed payload itself against the locked source and unpacked build.
    const extractedRoot = path.join(tempRoot, "app");
    execFileSync(sevenZip, ["x", "-y", embeddedArchive, `-o${extractedRoot}`, "resources\\openclaw-runtime\\dist\\extensions\\verseconf-artifacts\\*", "resources\\openclaw-runtime\\dist-runtime\\extensions\\verseconf-artifacts\\*"], { stdio: "pipe", timeout: 120_000 });
    for (const layout of ["dist", "dist-runtime"]) {
      const extractedPlugin = path.join(extractedRoot, "resources", "openclaw-runtime", layout, "extensions", "verseconf-artifacts");
      assertDelivery(extractedPlugin);
      const packagedPlugin = path.join(packagedRuntimeRoot, layout, "extensions", "verseconf-artifacts");
      for (const file of ["index.js", "package.json", "openclaw.plugin.json"]) {
        assert.equal(fileSha(path.join(extractedPlugin, file)), fileSha(path.join(packagedPlugin, file)), `${layout}/${file}`);
      }
    }
    Object.assign(installerEvidence, { status: "passed", archiveSha256: fileSha(embeddedArchive), manifestSha256: deliveryLock.manifestSha256, layouts: ["dist", "dist-runtime"], filesPerLayout: deliveryManifest.files.length + 1, installedOnHost: false });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

const workerModule = await import(pathToFileURL(workerPath).href);
const source = readFileSync(fixturePath, "utf8");
const schema = readFileSync(schemaPath, "utf8");
const schemaIdentity = { schemaId: "urn:clawx:research-comparison:v1", version: "research-comparison/v1", digest: `sha256:${sha256(schema)}`, draft: "2020-12" };
const spec = { recordsPath: ["records"], idField: "id" };

const worker = workerModule.createComputeWorker();
const schemaWorker = workerModule.createComputeWorker({ profile: "schema-validation" });
const performanceEvidence = { workerSamples: [], packageBytes: { wasm: lstatSync(wasmPath).size, installer: existsSync(installerPath) ? lstatSync(installerPath).size : null } };
const workerLimits = {
  defaultWasmLinearMemoryMax: worker.limits.wasmLinearMemoryMax,
  schemaValidationWasmLinearMemoryMax: schemaWorker.limits.wasmLinearMemoryMax,
  provenance: workerModule.LIMIT_PROVENANCE,
};
const runtimeCases = [];
async function runtimeCase(name, fn) {
  try { await fn(); runtimeCases.push({ name, ok: true }); }
  catch (error) { runtimeCases.push({ name, ok: false, message: error instanceof Error ? error.message : String(error) }); }
}
await runtimeCase("clean-consumption-environment.load", async () => {
  const cleanRoot = await mkdtemp(path.join(os.tmpdir(), "verseconf-clean-consumer-"));
  await cp(path.join(extensionRoot, "vendor", "verseconf"), cleanRoot, { recursive: true });
  const probePath = path.join(cleanRoot, "probe.mjs");
  await writeFile(probePath, `import { createComputeWorker } from './worker/index.mjs';
const worker = createComputeWorker();
const result = await worker.call('capability', {});
console.log(JSON.stringify({ ok: result.outcome.ok, op: result.outcome.op }));
await worker.dispose();
`, "utf8");
  try {
    const output = execFileSync(process.execPath, [probePath], { cwd: cleanRoot, encoding: "utf8", timeout: 30_000, env: { ...process.env, NODE_PATH: "", NODE_OPTIONS: "" } });
    const line = output.trim().split(/\r?\n/u).at(-1);
    assert.deepEqual(JSON.parse(line), { ok: true, op: "capability" });
  } finally {
    await rm(cleanRoot, { recursive: true, force: true });
  }
});
await runtimeCase("full-module.node-esm-cjs-web-and-mcp", async () => {
  const vendorRoot = path.join(extensionRoot, "vendor", "verseconf");
  const esm = await import(pathToFileURL(path.join(vendorRoot, "dist", "index.mjs")).href);
  const cjs = createRequire(import.meta.url)(path.join(vendorRoot, "dist", "index.cjs"));
  for (const api of [esm, cjs]) {
    assert.equal(api.capability().ok, true);
    assert.equal(api.validate("port = 8080\n").isError, false);
    assert.equal(api.tools().length, 5);
    assert.equal(api.inspectRecord({ source, format: "json", spec, selectors: [] }).ok, true);
  }
  const web = await import(pathToFileURL(path.join(vendorRoot, "pkg-web", "verseconf_wasm.js")).href);
  web.initSync({ module: readFileSync(path.join(vendorRoot, "pkg-web", "verseconf_wasm_bg.wasm")) });
  assert.equal(JSON.parse(web.business_capability_json()).ok, true);
  const tools = JSON.parse(execFileSync(process.execPath, [path.join(vendorRoot, "bin", "verseconf-mcp-wasm.mjs"), "--list-tools"], { encoding: "utf8", timeout: 30_000 }));
  assert.equal(tools.tools.length, 5);
});
await runtimeCase("worker.rejects-version-and-digest-mismatch-without-spawn", async () => {
  for (const options of [{ expectedVersion: `${deliveryLock.packageVersion}-mismatch` }, { wasmExpectedSha256: "0".repeat(64) }]) {
    const rejectedWorker = workerModule.createComputeWorker(options);
    try {
      await assert.rejects(rejectedWorker.call("capability", {}), (error) => error?.code === "worker_unavailable");
      assert.equal(rejectedWorker.stats.spawns, 0);
    } finally {
      await rejectedWorker.dispose();
    }
  }
});
await runtimeCase("wasm.capability", async () => { const startedAt = performance.now(); const result = await worker.call("capability", {}); performanceEvidence.workerSamples.push({ label: "cold-capability", durationMs: Number((performance.now() - startedAt).toFixed(2)), metrics: result.metrics ?? null }); assert.equal(result.outcome.ok, true); });
await runtimeCase("wasm.capability-hot", async () => { const startedAt = performance.now(); const result = await worker.call("capability", {}); performanceEvidence.workerSamples.push({ label: "hot-capability", durationMs: Number((performance.now() - startedAt).toFixed(2)), metrics: result.metrics ?? null }); assert.equal(result.outcome.ok, true); });
await runtimeCase("wasm.inspect.unicode-crlf", async () => { const tricky = source.replace(/\n/g, "\r\n"); const result = await worker.call("inspect_record", { source: tricky, format: "json", spec, selectors: [{ recordId: "rec-managed", fieldPath: ["subject"] }] }); assert.equal(result.outcome.ok, true); });
await runtimeCase("wasm.apply.multi-field", async () => { const result = await worker.call("apply_batch", { source, format: "json", spec, changes: [{ recordId: "rec-managed", fieldPath: ["evidenceState"], op: "setValue", expect: { kind: "value", value: "unlinked" }, value: "linked" }, { recordId: "rec-managed", fieldPath: ["evidenceRefs"], op: "setValue", expect: { kind: "value", value: [] }, value: ["src-synthetic-check"] }] }); assert.equal(result.outcome.ok, true); });
await runtimeCase("wasm.reject.invalid-json", async () => { const result = await worker.call("inspect_record", { source: "{", format: "json", spec, selectors: [] }); assert.equal(result.outcome.ok, false); });
await runtimeCase("wasm.validate.trusted-schema-profile", async () => { const result = await schemaWorker.call("validate_trusted_candidate", { baseline: source, candidate: source, format: "json", schemaText: schema, identity: schemaIdentity }); assert.equal(result.outcome.ok, true); });
await runtimeCase("wasm.reject.bom", async () => { const result = await worker.call("inspect_record", { source: `\uFEFF${source}`, format: "json", spec, selectors: [] }); assert.equal(result.outcome.ok, false); });
const abort = new AbortController(); abort.abort();
await runtimeCase("wasm.cancelled-call", async () => { await assert.rejects(worker.call("capability", {}, { signal: abort.signal }), (error) => error?.code === "cancelled"); });
await worker.dispose();
await schemaWorker.dispose();

const realRuntimeCases = [];
const idempotencyEvidence = [];
async function realRuntimeCase(name, fn) {
  try { await fn(); realRuntimeCases.push({ name, ok: true }); }
  catch (error) { realRuntimeCases.push({ name, ok: false, message: error instanceof Error ? error.message : String(error) }); }
}
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  const port = address && typeof address !== "string" ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  if (!port) throw new Error("failed to allocate gateway probe port");
  return port;
}
async function waitForPort(child, port, stdout, stderr) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 60_000) {
    if (child.exitCode !== null) throw new Error(`gateway exited before listening (${child.exitCode})\nstdout=${stdout}\nstderr=${stderr}`);
    try {
      await new Promise((resolve, reject) => {
        const socket = net.connect({ host: "127.0.0.1", port });
        socket.once("connect", () => { socket.destroy(); resolve(); });
        socket.once("error", (error) => { socket.destroy(); reject(error); });
      });
      return;
    } catch { await new Promise((resolve) => setTimeout(resolve, 250)); }
  }
  throw new Error(`gateway did not listen within timeout\nstdout=${stdout}\nstderr=${stderr}`);
}
function gatewayResult(body) {
  const result = body?.result;
  return result?.details ?? JSON.parse(result?.content?.[0]?.text ?? "null");
}
await realRuntimeCase("gateway.real-runtime-managed-artifact-lifecycle", async () => {
  const runtimeRoot = path.join(root, "openclaw_runtime");
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "verseconf-gateway-"));
  const workspaceDir = path.join(tempRoot, "workspace");
  const stateDir = path.join(tempRoot, "state");
  const configPath = path.join(tempRoot, "openclaw.json");
  const port = await freePort();
  const token = `verseconf-gateway-${Date.now()}`;
  await mkdir(workspaceDir, { recursive: true });
  await mkdir(stateDir, { recursive: true });
  await writeFile(path.join(workspaceDir, "research.json"), source, "utf8");
  await writeFile(configPath, `${JSON.stringify({
    gateway: { port, bind: "loopback", auth: { mode: "token", token }, controlUi: { enabled: false } },
    hooks: { enabled: false },
    agents: { defaults: { workspace: workspaceDir } },
    plugins: { enabled: true, allow: ["verseconf-artifacts"], entries: { "verseconf-artifacts": { enabled: true } } },
  }, null, 2)}\n`, "utf8");
  const env = {
    ...process.env,
    OPENCLAW_STATE_DIR: stateDir,
    OPENCLAW_CONFIG_PATH: configPath,
    OPENCLAW_HOME: tempRoot,
    HOME: tempRoot,
    USERPROFILE: tempRoot,
    OPENCLAW_GATEWAY_TOKEN: token,
    OPENCLAW_SKIP_CHANNELS: "1",
    OPENCLAW_SKIP_PROVIDERS: "1",
    OPENCLAW_SKIP_CRON: "1",
    OPENCLAW_TEST_MINIMAL_GATEWAY: "1",
    VITEST: "1",
  };
  const child = spawn(process.execPath, [path.join(runtimeRoot, "dist", "entry.js"), "gateway", "--port", String(port), "--bind", "loopback"], { cwd: runtimeRoot, env, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = ""; let stderr = "";
  child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  try {
    await waitForPort(child, port, stdout, stderr);
    const invoke = async (name, args) => {
      const response = await fetch(`http://127.0.0.1:${port}/tools/invoke`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ name, sessionKey: "agent:main:main", args }),
      });
      const body = await response.json();
      return { status: response.status, body };
    };
    const created = await invoke("structured_artifact_create", { artifactId: "gateway-artifact", kind: "research-table", sourcePath: "research.json" });
    assert.equal(created.status, 200);
    const createdDetails = gatewayResult(created.body);
    assert.equal(createdDetails.artifactId, "gateway-artifact");
    const baseRevisionId = createdDetails.revision.revisionId;
    const revised = await invoke("structured_artifact_revise", { artifactId: "gateway-artifact", baseRevisionId, idempotencyKey: "gateway-revise-key", changes: [
      { recordId: "rec-managed", fieldPath: ["evidenceState"], op: "setValue", expect: { kind: "value", value: "unlinked" }, value: "linked" },
      { recordId: "rec-managed", fieldPath: ["evidenceRefs"], op: "setValue", expect: { kind: "value", value: [] }, value: ["src-synthetic-check"] },
    ] });
    assert.equal(revised.status, 200);
    assert.equal(gatewayResult(revised.body).state, "committed");
    const replay = await invoke("structured_artifact_revise", { artifactId: "gateway-artifact", baseRevisionId, idempotencyKey: "gateway-revise-key", changes: [
      { recordId: "rec-managed", fieldPath: ["evidenceState"], op: "setValue", expect: { kind: "value", value: "unlinked" }, value: "linked" },
      { recordId: "rec-managed", fieldPath: ["evidenceRefs"], op: "setValue", expect: { kind: "value", value: [] }, value: ["src-synthetic-check"] },
    ] });
    assert.equal(replay.status, 200);
    assert.deepEqual(gatewayResult(replay.body), gatewayResult(revised.body));
    await realRuntimeCase("gateway.revise.rejects-nested-idempotency-conflict", async () => {
      const beforeSha256 = fileSha(path.join(workspaceDir, "research.json"));
      const beforeHistory = await invoke("structured_artifact_history", { artifactId: "gateway-artifact" });
      const conflict = await invoke("structured_artifact_revise", { artifactId: "gateway-artifact", baseRevisionId, idempotencyKey: "gateway-revise-key", changes: [
        { recordId: "rec-managed", fieldPath: ["evidenceState"], op: "setValue", expect: { kind: "value", value: "unlinked" }, value: "unlinked" },
        { recordId: "rec-managed", fieldPath: ["evidenceRefs"], op: "setValue", expect: { kind: "value", value: [] }, value: ["src-synthetic-check"] },
      ] });
      const details = gatewayResult(conflict.body);
      assert.equal(conflict.status, 200);
      assert.equal(details.ok, false);
      assert.equal(details.state, "rejected");
      assert.equal(details.diagnostics[0].code, "idempotency_conflict");
      assert.equal(details.operationId, gatewayResult(revised.body).operationId);
      const afterSha256 = fileSha(path.join(workspaceDir, "research.json"));
      assert.equal(afterSha256, beforeSha256);
      const afterHistory = await invoke("structured_artifact_history", { artifactId: "gateway-artifact" });
      assert.deepEqual(afterHistory, beforeHistory);
      idempotencyEvidence.push({ tool: "structured_artifact_revise", response: details, beforeSha256, afterSha256, revisionCount: gatewayResult(afterHistory.body).revisions.length, historyUnchanged: true });
    });
    await realRuntimeCase("gateway.record-ops.rejects-nested-idempotency-conflict", async () => {
      const recordPath = path.join(workspaceDir, "records.json");
      await writeFile(recordPath, source, "utf8");
      const created = await invoke("structured_artifact_create", { artifactId: "gateway-records", kind: "research-table", sourcePath: "records.json" });
      assert.equal(created.status, 200);
      const record = { id: "rec-extra", subject: "Extra", finding: "Original", evidenceState: "unlinked", evidenceRefs: [], limitations: null };
      const request = { artifactId: "gateway-records", idempotencyKey: "gateway-record-key", operations: [{ op: "insertRecord", record, afterId: "rec-managed" }] };
      const committed = await invoke("structured_artifact_record_ops", request);
      assert.equal(committed.status, 200);
      assert.equal(gatewayResult(committed.body).state, "committed");
      assert.deepEqual(await invoke("structured_artifact_record_ops", request), committed);
      const beforeSha256 = fileSha(recordPath);
      const beforeHistory = await invoke("structured_artifact_history", { artifactId: request.artifactId });
      const conflict = await invoke("structured_artifact_record_ops", { ...request, operations: [{ ...request.operations[0], record: { ...record, finding: "Changed" } }] });
      const details = gatewayResult(conflict.body);
      assert.equal(conflict.status, 200);
      assert.equal(details.ok, false);
      assert.equal(details.state, "rejected");
      assert.equal(details.diagnostics[0].code, "idempotency_conflict");
      assert.equal(details.operationId, gatewayResult(committed.body).operationId);
      const afterSha256 = fileSha(recordPath);
      assert.equal(afterSha256, beforeSha256);
      const afterHistory = await invoke("structured_artifact_history", { artifactId: request.artifactId });
      assert.deepEqual(afterHistory, beforeHistory);
      idempotencyEvidence.push({ tool: "structured_artifact_record_ops", response: details, beforeSha256, afterSha256, revisionCount: gatewayResult(afterHistory.body).revisions.length, historyUnchanged: true });
    });
    const exported = await invoke("structured_artifact_export", { artifactId: "gateway-artifact", format: "xlsx" });
    assert.equal(exported.status, 200);
    assert.equal(gatewayResult(exported.body).output.format, "xlsx");
    const history = await invoke("structured_artifact_history", { artifactId: "gateway-artifact" });
    assert.equal(history.status, 200);
    const historyDetails = gatewayResult(history.body);
    assert.equal(historyDetails.revisions.length, 2);
    assert.equal(historyDetails.outputs.length, 1);

    const slideCreated = await invoke("structured_artifact_create", { artifactId: "gateway-slide-outline", kind: "slide-outline", sourcePath: "research.json" });
    assert.equal(slideCreated.status, 200);
    const slideRevisionId = gatewayResult(slideCreated.body).revision.revisionId;
    const slideRevised = await invoke("structured_artifact_revise", { artifactId: "gateway-slide-outline", baseRevisionId: slideRevisionId, idempotencyKey: "gateway-slide-revise-key", changes: [
      { recordId: "rec-managed", fieldPath: ["finding"], op: "setValue", expect: { kind: "value", value: "只验证契约中的引用关联，不推断实现已经通过。" }, value: "第二消费者复用同一受管契约。" },
    ] });
    assert.equal(slideRevised.status, 200);
    assert.equal(gatewayResult(slideRevised.body).state, "committed");
    const slideExported = await invoke("structured_artifact_export", { artifactId: "gateway-slide-outline", format: "pptx" });
    assert.equal(slideExported.status, 200);
    assert.equal(gatewayResult(slideExported.body).output.format, "pptx");

    await writeFile(path.join(workspaceDir, "research.json"), "{\"external\":true}\n", "utf8");
    const drift = await invoke("structured_artifact_inspect", { artifactId: "gateway-artifact" });
    assert.equal(drift.status, 500);
  } finally {
    if (child.exitCode === null) child.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (child.exitCode === null) child.kill("SIGKILL");
    await rm(tempRoot, { recursive: true, force: true });
  }
});


await realRuntimeCase("electron-unpacked.real-runtime-managed-artifact", async () => {
  const runtimeRoot = path.join(root, "release", "win-unpacked", "resources", "openclaw-runtime");
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "verseconf-packaged-gateway-"));
  const workspaceDir = path.join(tempRoot, "workspace");
  const stateDir = path.join(tempRoot, "state");
  const configPath = path.join(tempRoot, "openclaw.json");
  const port = await freePort();
  const token = `verseconf-packaged-${Date.now()}`;
  await mkdir(workspaceDir, { recursive: true });
  await mkdir(stateDir, { recursive: true });
  await writeFile(path.join(workspaceDir, "research.json"), source, "utf8");
  await writeFile(configPath, `${JSON.stringify({
    gateway: { port, bind: "loopback", auth: { mode: "token", token }, controlUi: { enabled: false } },
    hooks: { enabled: false },
    agents: { defaults: { workspace: workspaceDir } },
    plugins: { enabled: true, allow: ["verseconf-artifacts"], entries: { "verseconf-artifacts": { enabled: true } } },
  }, null, 2)}\n`, "utf8");
  const env = {
    ...process.env,
    OPENCLAW_STATE_DIR: stateDir,
    OPENCLAW_CONFIG_PATH: configPath,
    OPENCLAW_HOME: tempRoot,
    HOME: tempRoot,
    USERPROFILE: tempRoot,
    OPENCLAW_GATEWAY_TOKEN: token,
    OPENCLAW_SKIP_CHANNELS: "1",
    OPENCLAW_SKIP_PROVIDERS: "1",
    OPENCLAW_SKIP_CRON: "1",
    OPENCLAW_TEST_MINIMAL_GATEWAY: "1",
    VITEST: "1",
  };
  const child = spawn(process.execPath, [path.join(runtimeRoot, "dist", "entry.js"), "gateway", "--port", String(port), "--bind", "loopback"], { cwd: runtimeRoot, env, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = ""; let stderr = "";
  child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  try {
    await waitForPort(child, port, stdout, stderr);
    const invoke = async (name, args) => {
      const response = await fetch(`http://127.0.0.1:${port}/tools/invoke`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ name, sessionKey: "agent:main:main", args }),
      });
      return { status: response.status, body: await response.json() };
    };
    const created = await invoke("structured_artifact_create", { artifactId: "packaged-artifact", kind: "research-table", sourcePath: "research.json" });
    assert.equal(created.status, 200);
    const baseRevisionId = gatewayResult(created.body).revision.revisionId;
    const revised = await invoke("structured_artifact_revise", { artifactId: "packaged-artifact", baseRevisionId, idempotencyKey: "packaged-revise-key", changes: [
      { recordId: "rec-managed", fieldPath: ["evidenceState"], op: "setValue", expect: { kind: "value", value: "unlinked" }, value: "linked" },
      { recordId: "rec-managed", fieldPath: ["evidenceRefs"], op: "setValue", expect: { kind: "value", value: [] }, value: ["src-synthetic-check"] },
    ] });
    assert.equal(revised.status, 200);
    assert.equal(gatewayResult(revised.body).state, "committed");
    const history = await invoke("structured_artifact_history", { artifactId: "packaged-artifact" });
    assert.equal(history.status, 200);
    assert.equal(gatewayResult(history.body).revisions.length, 2);
  } finally {
    if (child.exitCode === null) child.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (child.exitCode === null) child.kill("SIGKILL");
    await rm(tempRoot, { recursive: true, force: true });
  }
});

const credentialPatterns = [
  { id: "openai-style-key", pattern: /\bsk-[A-Za-z0-9_-]{12,}/gu },
  { id: "bearer-token", pattern: /\bBearer\s+[A-Za-z0-9._~+\/-=]{8,}/gu },
  { id: "aws-access-key-id", pattern: /\bAKIA[0-9A-Z]{16}\b/gu },
  { id: "github-token", pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}/gu },
  { id: "slack-token", pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/gu },
  { id: "private-key-block", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/gu },
  { id: "generic-secret-assignment", pattern: /\b(?:api[_-]?key|secret|password|token)\b\s*[:=]\s*["'][^"']{16,}["']/giu },
];
async function listFiles(dir, relative = "") {
  const entries = (await readdir(dir, { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const files = [];
  for (const entry of entries) {
    const next = relative ? path.posix.join(relative, entry.name) : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(full, next));
    else if (entry.isFile()) files.push(next);
  }
  return files;
}
function credentialHits(bytes) {
  const text = bytes.toString("latin1");
  return credentialPatterns
    .map(({ id, pattern }) => ({ id, count: text.match(new RegExp(pattern.source, pattern.flags))?.length ?? 0 }))
    .filter((entry) => entry.count > 0);
}
async function writeEvidenceIntegrity() {
  const files = (await listFiles(evidenceRoot))
    .filter((relative) => relative !== "SHA256SUMS" && relative !== "credential-scan.json");
  const scan = {
    actor: "agent/verseconf-clawx-verifier",
    driven_by: "agent",
    credentialScanHits: 0,
    filesScanned: files.length,
    method: "API/GitHub/AWS token patterns, not an exhaustive detector; generated credential report excluded",
    patterns: credentialPatterns.map(({ id, pattern }) => ({ id, pattern: pattern.source })),
    hits: [],
  };
  for (const relative of files) {
    for (const hit of credentialHits(await readFile(path.join(evidenceRoot, relative)))) {
      scan.hits.push({ file: relative, ...hit });
    }
  }
  scan.credentialScanHits = scan.hits.reduce((sum, hit) => sum + hit.count, 0);
  await writeFile(credentialScanPath, `${JSON.stringify(scan, null, 2)}\n`, "utf8");
  const manifestFiles = (await listFiles(evidenceRoot)).filter((relative) => relative !== "SHA256SUMS");
  const manifest = [];
  for (const relative of manifestFiles) {
    const bytes = await readFile(path.join(evidenceRoot, relative));
    manifest.push(`${sha256(bytes)} *${relative.replaceAll("\\", "/")}`);
  }
  await writeFile(manifestPath, `${manifest.join("\n")}\n`, "utf8");
  return {
    manifest: path.relative(root, manifestPath).replaceAll("\\", "/"),
    credentialScan: path.relative(root, credentialScanPath).replaceAll("\\", "/"),
    credentialScanHits: scan.credentialScanHits,
    filesScanned: scan.filesScanned,
    manifestFiles: manifestFiles.length,
  };
}

async function sourceStats(dir) {
  let files = 0; let bytes = 0; let lines = 0;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await sourceStats(full);
      files += nested.files; bytes += nested.bytes; lines += nested.lines;
      continue;
    }
    if (!/\.(?:ts|mjs|json)$/u.test(entry.name)) continue;
    const content = await readFile(full, "utf8");
    files += 1; bytes += Buffer.byteLength(content); lines += content.split(/\r?\n/u).length;
  }
  return { files, bytes, lines };
}

const engineUrl = pathToFileURL(path.join(extensionRoot, "src", "engine.ts")).href;
const storeUrl = pathToFileURL(path.join(extensionRoot, "src", "store.ts")).href;
const toolsUrl = pathToFileURL(path.join(extensionRoot, "src", "tools.ts")).href;
const { VerseConfComputeEngine } = await import(engineUrl);
const { VerseConfArtifactStore } = await import(storeUrl);
const { createVerseConfTools } = await import(toolsUrl);
const workspaceDir = await mkdtemp(path.join(os.tmpdir(), "verseconf-clawx-verify-"));
const sourcePath = "research.json";
await writeFile(path.join(workspaceDir, sourcePath), source, "utf8");
const store = new VerseConfArtifactStore({ path: path.join(workspaceDir, ".state", "artifacts.sqlite") });
const engine = new VerseConfComputeEngine();
const context = { workspaceDir, sessionKey: "agent:verify:verseconf", sessionId: "session-verify", agentId: "agent-verseconf-verifier" };
const tools = createVerseConfTools({ store, engine, api: {}, context });
const tool = (name) => { const value = tools.find((candidate) => candidate.name === name); assert.ok(value, name); return value; };
const toolCases = [];
async function toolCase(name, fn) { try { await fn(); toolCases.push({ name, ok: true }); } catch (error) { toolCases.push({ name, ok: false, message: error instanceof Error ? error.message : String(error) }); } }
let artifact;
await toolCase("tool.create", async () => { const result = unwrap(await tool("structured_artifact_create").execute("verify-create", { artifactId: "artifact-verify", kind: "research-table", sourcePath })); assert.ok(result.ok); artifact = store.getArtifact("artifact-verify"); assert.ok(artifact); });
const firstRevision = artifact ? store.getRevision(artifact.currentRevisionId) : null;
await toolCase("tool.revise.managed-submit", async () => { const result = unwrap(await tool("structured_artifact_revise").execute("verify-revise", { artifactId: "artifact-verify", baseRevisionId: firstRevision.revisionId, idempotencyKey: "verify-revise-key", changes: [{ recordId: "rec-managed", fieldPath: ["evidenceState"], op: "setValue", expect: { kind: "value", value: "unlinked" }, value: "linked" }, { recordId: "rec-managed", fieldPath: ["evidenceRefs"], op: "setValue", expect: { kind: "value", value: [] }, value: ["src-synthetic-check"] }] })); assert.equal(result.state, "committed"); assert.ok(result.journalRef); });
await toolCase("tool.revise.idempotent-replay", async () => { const result = unwrap(await tool("structured_artifact_revise").execute("verify-revise-retry", { artifactId: "artifact-verify", baseRevisionId: firstRevision.revisionId, idempotencyKey: "verify-revise-key", changes: [{ recordId: "rec-managed", fieldPath: ["evidenceState"], op: "setValue", expect: { kind: "value", value: "unlinked" }, value: "linked" }, { recordId: "rec-managed", fieldPath: ["evidenceRefs"], op: "setValue", expect: { kind: "value", value: [] }, value: ["src-synthetic-check"] }] })); assert.ok(result.ok); assert.equal(store.listRevisions("artifact-verify").length, 2); });
await toolCase("tool.export.xlsx", async () => { const result = unwrap(await tool("structured_artifact_export").execute("verify-export", { artifactId: "artifact-verify", format: "xlsx" })); assert.equal(result.output.format, "xlsx"); assert.ok(result.output.journalRef); });
await toolCase("tool.record-ops", async () => { const result = unwrap(await tool("structured_artifact_record_ops").execute("verify-records", { artifactId: "artifact-verify", idempotencyKey: "verify-record-key", operations: [{ op: "insertRecord", record: { id: "rec-extra", subject: "Extra", finding: "Added", evidenceState: "unlinked", evidenceRefs: [], limitations: null }, afterId: "rec-managed" }] })); assert.equal(result.state, "committed"); });
await toolCase("tool.restore-new-revision", async () => { const result = unwrap(await tool("structured_artifact_restore").execute("verify-restore", { artifactId: "artifact-verify", revisionId: firstRevision.revisionId, idempotencyKey: "verify-restore-key" })); assert.equal(result.state, "committed"); assert.ok(store.listRevisions("artifact-verify").length >= 4); });
await toolCase("tool.reject.external-drift", async () => { await writeFile(path.join(workspaceDir, sourcePath), "{\"external\":true}\n", "utf8"); await assert.rejects(tool("structured_artifact_inspect").execute("verify-drift", { artifactId: "artifact-verify" }), /drifted/); });
await toolCase("tool.history-survives-reopen", async () => { store.close(); const reopened = new VerseConfArtifactStore({ path: path.join(workspaceDir, ".state", "artifacts.sqlite") }); assert.ok(reopened.listRevisions("artifact-verify").length >= 4); assert.ok(reopened.listOutputs("artifact-verify").length >= 1); reopened.close(); });
await toolCase("tool.disable-preserves-history", async () => { const reopened = new VerseConfArtifactStore({ path: path.join(workspaceDir, ".state", "artifacts.sqlite") }); const reopenedTools = createVerseConfTools({ store: reopened, engine, api: {}, context }); const disableTool = reopenedTools.find((candidate) => candidate.name === "structured_artifact_disable"); assert.ok(disableTool); const result = unwrap(await disableTool.execute("verify-disable", { artifactId: "artifact-verify" })); assert.equal(result.historyPreserved, true); assert.ok(reopened.listRevisions("artifact-verify").length >= 4); assert.ok(reopened.getArtifact("artifact-verify")?.disabledAt); reopened.close(); });
await toolCase("store.backup-restore-preserves-history", async () => { const sourceDb = path.join(workspaceDir, ".state", "artifacts.sqlite"); const backupDb = path.join(workspaceDir, ".state", "artifacts-backup.sqlite"); await cp(sourceDb, backupDb); const backup = new VerseConfArtifactStore({ path: backupDb }); assert.ok(backup.listRevisions("artifact-verify").length >= 4); assert.ok(backup.listOutputs("artifact-verify").length >= 1); backup.close(); });
await toolCase("store.rejects-unknown-schema-version", async () => { const versionPath = path.join(workspaceDir, ".state", "version-check.sqlite"); const versionStore = new VerseConfArtifactStore({ path: versionPath }); versionStore.db.prepare("UPDATE verseconf_schema_meta SET value = '999' WHERE key = 'version'").run(); versionStore.close(); assert.throws(() => new VerseConfArtifactStore({ path: versionPath }), /unsupported verseconf artifact store schema version/); });
await toolCase("store.rejects-capacity-at-boundary", async () => { const capacityPath = path.join(workspaceDir, ".state", "capacity-check.sqlite"); const capacityStore = new VerseConfArtifactStore({ path: capacityPath }); const insert = capacityStore.db.prepare("INSERT INTO verseconf_artifacts (artifact_id, kind, workspace_dir, source_path, current_revision_id, schema_text, schema_identity_json, created_at, updated_at) VALUES (?, 'research-table', ?, 'research.json', 'rev-capacity', '{}', '{}', 1, 1)"); for (let i = 0; i < 256; i += 1) insert.run(`capacity-${i}`, workspaceDir); assert.throws(() => capacityStore.assertArtifactCapacity(), /artifact capacity exceeded/); capacityStore.close(); });
await engine.dispose();

const visualDir = path.join(evidenceRoot, "visual");
let visualRender = { status: "not-run", visualAcceptance: "not-run", reason: "LibreOffice or PyMuPDF is unavailable" };
try {
  const { renderArtifact } = await import(pathToFileURL(path.join(extensionRoot, "src", "render.ts")).href);
  await mkdir(visualDir, { recursive: true });
  const pptxPath = path.join(visualDir, "slide-outline.pptx");
  const pdfPath = path.join(visualDir, "slide-outline.pdf");
  const rendered = await renderArtifact(source, "slide-outline", "pptx");
  writeFileSync(pptxPath, rendered.content);
  const soffice = process.platform === "win32"
    ? "C:\\Program Files\\LibreOffice\\program\\soffice.exe"
    : "soffice";
  execFileSync(soffice, ["--headless", "--convert-to", "pdf", "--outdir", visualDir, pptxPath], { stdio: "pipe" });
  const pyCode = [
    "import fitz, json, os, sys",
    "pdf=os.environ['VERSECONF_PDF']",
    "doc=fitz.open(pdf)",
    "rows=[]",
    "for i,page in enumerate(doc):",
    " text=page.get_text('text')",
    " pix=page.get_pixmap(matrix=fitz.Matrix(1,1), alpha=False)",
    " png=pdf.rsplit('.',1)[0]+f'-page-{i+1}.png'",
    " pix.save(png)",
    " rows.append({'page':i+1,'text':text[:1200],'png':png,'width':pix.width,'height':pix.height})",
    "print(json.dumps({'pages':len(doc),'rows':rows},ensure_ascii=False))",
    "sys.exit(0 if len(doc)>=3 and all(row['text'].strip() for row in rows) else 2)",
  ].join("\n");
  const visual = execFileSync("py", ["-3", "-c", pyCode], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    env: { ...process.env, PYTHONIOENCODING: "utf-8", VERSECONF_PDF: pdfPath },
  });
  const visualJsonLine = visual
    .trim()
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{"))
    .at(-1);
  if (!visualJsonLine) throw new Error(`visual probe emitted no JSON report: ${visual.trim()}`);
  const visualReport = JSON.parse(visualJsonLine);
  writeFileSync(path.join(visualDir, "visual-report.json"), `${JSON.stringify(visualReport, null, 2)}\n`, "utf8");
  visualRender = { status: "rendered", visualAcceptance: "not-run", driven_by: "agent", renderer: "LibreOffice + PyMuPDF", ...visualReport };
} catch (error) {
  visualRender = { status: "not-run", visualAcceptance: "not-run", reason: error instanceof Error ? error.message : String(error), driven_by: "agent" };
}

const allCases = [...checks, ...runtimeCases, ...realRuntimeCases, ...toolCases];
const packagedElectron = {
  status: allCases.filter((entry) => entry.name.startsWith("electron-") || entry.name.startsWith("delivery.electron-")).every((entry) => entry.ok) ? "passed" : "failed",
  root: path.relative(root, packagedExtensionRoot).replaceAll("\\", "/"),
  installer: {
    status: installerEvidence.status === "passed" ? "passed" : "failed",
    path: path.relative(root, installerPath).replaceAll("\\", "/"),
    sha256: existsSync(installerPath) ? fileSha(installerPath) : null,
    embeddedDelivery: installerEvidence,
  },
};

const maintenanceCostProxy = await sourceStats(extensionRoot);
const report = {
  schema: "verseconf-clawx-integration-verification/v1",
  generatedAt: new Date().toISOString(),
  actor: "agent/verseconf-clawx-verifier",
  drivenBy: "agent",
  driven_by: "agent",
  realHumanEvidence: false,
  paidModelCalls: 0,
  source: { pluginManifest, package: packageManifest, vendorPackage: vendorPackageManifest, buildManifest, deliveryLock, deliveryManifest, wasmSha256: fileSha(wasmPath), glueSha256: fileSha(gluePath) },
  packagedElectron,
  idempotency: {
    sourceGateway: idempotencyEvidence,
    sourceToolsSha256: fileSha(path.join(extensionRoot, "src", "tools.ts")),
    runtimePluginSha256: fileSha(path.join(root, "openclaw_runtime", "dist", "extensions", "verseconf-artifacts", "index.js")),
    packagedGateway: { status: "not-run", reason: "Nested idempotency conflict checks cover the rebuilt local runtime; the existing installer is prior delivery evidence." },
  },
  limits: workerLimits,
  visualRender,
  scenarioCounts: { total: allCases.length, passed: allCases.filter((entry) => entry.ok).length, failed: allCases.filter((entry) => !entry.ok).length },
  cases: allCases,
  boundaries: { defaultOn: false, productApproved: false, liveReady: false, publicPublish: false, sourceRuntimePathIsolation: true, noChannelInstallFallback: true },
  evidenceIntegrity: { status: "pending", drivenBy: "agent" },
  performance: {
    drivenBy: "agent",
    failureDenominator: { totalCases: allCases.length, failedCases: allCases.filter((entry) => !entry.ok).length },
    workerSamples: performanceEvidence.workerSamples,
    packageBytes: performanceEvidence.packageBytes,
    limits: { coldWorkerMs: 5000, hotWorkerMs: 2000, ...workerLimits },
    maintenanceCostProxy: { metric: "extension-source-files-bytes-lines", ...maintenanceCostProxy },
  },
};
await mkdir(path.dirname(reportPath), { recursive: true });
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
report.evidenceIntegrity = await writeEvidenceIntegrity();
report.evidenceIntegrity.status = report.evidenceIntegrity.credentialScanHits === 0 ? "passed" : "failed";
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
report.evidenceIntegrity = await writeEvidenceIntegrity();
if (report.scenarioCounts.failed > 0 || report.evidenceIntegrity.credentialScanHits > 0) { console.error(JSON.stringify(report, null, 2)); process.exitCode = 1; }
else { console.log(JSON.stringify({ reportPath, scenarioCounts: report.scenarioCounts }, null, 2)); }
