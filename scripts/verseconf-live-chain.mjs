import crypto from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeRoot = path.join(root, "openclaw_runtime");
const runtimeEntry = path.join(runtimeRoot, "dist", "entry.js");
const schemaPath = path.join(runtimeRoot, "extensions", "verseconf-artifacts", "schemas", "research-source.schema.json");
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const args = process.argv.slice(2);
const argValue = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const outputDir = path.resolve(argValue("--output-dir") ?? process.env.VERSECONF_LIVE_OUTPUT_DIR ?? path.join(root, ".local", "verseconf-live", stamp));
const issueDir = path.join(outputDir, "issues");
const runtimeDir = path.join(outputDir, "runtime");
const transcriptPath = path.join(outputDir, "gateway-transcript.json");
const reportPath = path.join(outputDir, "report.json");
const checks = [];
const transcript = [];
const modelCalls = [];

function safe(value) {
  if (typeof value === "string") {
    const apiKey = process.env.VERSECONF_LIVE_API_KEY;
    return value
      .replace(apiKey ? new RegExp(apiKey.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "gu") : /(?!)/gu, "[REDACTED_API_KEY]")
      .replace(/sk-[A-Za-z0-9_-]{12,}/gu, "[REDACTED_API_KEY]")
      .replace(/Bearer\s+[^\s"']+/giu, "Bearer [REDACTED]");
  }
  if (Array.isArray(value)) return value.map(safe);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, safe(item)]));
  return value;
}

async function saveJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(safe(value), null, 2)}\n`, "utf8");
}

function check(id, ok, details = {}) {
  checks.push({ id, ok: Boolean(ok), ...details });
  if (!ok) throw new Error(`${id}: ${details.message ?? "check failed"}`);
}

function parseJsonText(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/iu);
  const candidate = (fenced?.[1] ?? text).trim();
  try { return JSON.parse(candidate); } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(candidate.slice(start, end + 1));
    throw new Error("model response did not contain a JSON object");
  }
}

function responseText(body) {
  if (typeof body?.output_text === "string") return body.output_text;
  const parts = [];
  for (const item of body?.output ?? []) {
    if (item?.type && item.type !== "message" && item.type !== "output_message") continue;
    for (const content of item?.content ?? []) {
      if (content?.type && content.type !== "output_text" && content.type !== "text") continue;
      if (typeof content?.text === "string") parts.push(content.text);
      else if (typeof content?.text?.value === "string") parts.push(content.text.value);
    }
  }
  return parts.join("\n").trim();
}

async function callModel(label, prompt) {
  const baseUrl = process.env.VERSECONF_LIVE_BASE_URL;
  const apiKey = process.env.VERSECONF_LIVE_API_KEY;
  const model = process.env.VERSECONF_LIVE_MODEL;
  if (!baseUrl || !apiKey || !model) throw new Error("set VERSECONF_LIVE_BASE_URL, VERSECONF_LIVE_API_KEY, and VERSECONF_LIVE_MODEL");
  const startedAt = Date.now();
  const response = await fetch(baseUrl, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ model, input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }] }),
    signal: AbortSignal.timeout(120_000),
  });
  const body = await response.json().catch(() => null);
  const text = responseText(body);
  const call = { label, status: response.status, ok: response.ok, elapsedMs: Date.now() - startedAt, responseId: body?.id ?? null, outputText: text };
  modelCalls.push(call);
  await saveJson(path.join(outputDir, `${label}-response.json`), body);
  if (!response.ok) throw new Error(`${label}: model endpoint returned HTTP ${response.status}`);
  if (!text) throw new Error(`${label}: model endpoint returned no text output`);
  return text;
}

function validateSource(source) {
  const keys = Object.keys(source ?? {}).sort().join(",");
  if (keys !== "records,schemaVersion,sources,title") throw new Error(`source top-level keys are ${keys}`);
  if (source.schemaVersion !== "research-comparison/v1" || !source.title || !Array.isArray(source.sources) || !Array.isArray(source.records)) throw new Error("source required fields are invalid");
  if (!source.sources.length || !source.records.length) throw new Error("source must contain at least one source and record");
  for (const item of source.sources) {
    if (!/^src-[a-z0-9-]{1,48}$/u.test(item.id) || !item.locator || !item.label || Object.keys(item).sort().join(",") !== "id,label,locator") throw new Error(`invalid source entry ${item.id ?? "<missing>"}`);
  }
  for (const item of source.records) {
    const allowed = new Set(["id", "subject", "finding", "evidenceState", "evidenceRefs", "limitations", "notes"]);
    if (!["id", "subject", "finding", "evidenceState", "evidenceRefs", "limitations"].every((key) => key in item) || Object.keys(item).some((key) => !allowed.has(key))) throw new Error(`invalid record fields ${item.id ?? "<missing>"}`);
    if (!/^rec-[a-z0-9-]{1,48}$/u.test(item.id) || item.evidenceState !== "unlinked" || !Array.isArray(item.evidenceRefs) || item.evidenceRefs.length) throw new Error(`record ${item.id ?? "<missing>"} must start unlinked with no refs`);
  }
  const managed = source.records.find((item) => item.id === "rec-managed");
  if (!managed) throw new Error("source must include rec-managed for the controlled edit path");
}

function validateChanges(changes, source) {
  if (!changes || !Array.isArray(changes.changes) || changes.changes.length !== 2) throw new Error("revision response must contain exactly two changes");
  const sourceId = source.sources[0].id;
  const expected = [
    { field: "evidenceState", from: "unlinked", to: "linked" },
    { field: "evidenceRefs", from: [], to: [sourceId] },
  ];
  for (const [index, change] of changes.changes.entries()) {
    const target = expected[index];
    if (change.recordId !== "rec-managed" || change.op !== "setValue" || JSON.stringify(change.fieldPath) !== JSON.stringify([target.field]) || change.expect?.kind !== "value" || JSON.stringify(change.expect.value) !== JSON.stringify(target.from) || JSON.stringify(change.value) !== JSON.stringify(target.to)) throw new Error(`revision change ${index} does not match the controlled contract`);
  }
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  const port = address && typeof address !== "string" ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  if (!port) throw new Error("could not allocate a gateway port");
  return port;
}

async function waitForPort(child, port) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 60_000) {
    if (child.exitCode !== null) throw new Error(`gateway exited before listening (${child.exitCode})`);
    try {
      await new Promise((resolve, reject) => {
        const socket = net.connect({ host: "127.0.0.1", port });
        socket.once("connect", () => { socket.destroy(); resolve(); });
        socket.once("error", (error) => { socket.destroy(); reject(error); });
      });
      return;
    } catch { await new Promise((resolve) => setTimeout(resolve, 250)); }
  }
  throw new Error("gateway did not listen within 60 seconds");
}

function gatewayDetails(body) {
  const result = body?.result;
  return result?.details ?? JSON.parse(result?.content?.[0]?.text ?? "null");
}

async function sha256(filePath) {
  return crypto.createHash("sha256").update(await readFile(filePath)).digest("hex");
}

async function main() {
  await mkdir(outputDir, { recursive: true });
  await mkdir(runtimeDir, { recursive: true });
  const schema = JSON.parse(await readFile(schemaPath, "utf8"));
  await saveJson(path.join(outputDir, "schema.json"), schema);
  check("runtime-entry-present", true, { path: runtimeEntry });
  const modelLocator = `model://${process.env.VERSECONF_LIVE_MODEL}`;
  const sourcePrompt = `Return only one JSON object and no markdown. It must satisfy the research-comparison/v1 schema below exactly. Preserve these exact top-level keys: schemaVersion, title, sources, records. Include one source with id "src-live-model", locator "${modelLocator}", and a truthful label saying it is an agent-driven model output. Include records with ids "rec-baseline", "rec-managed", and "rec-kernel". Every record must have subject, finding, evidenceState "unlinked", evidenceRefs [], and limitations (string or null); optional notes is allowed. Do not add any other keys. The findings must describe a testable comparison and must not claim human evidence, paid model approval, or product acceptance. Schema: ${JSON.stringify(schema)}`;
  const sourceText = await callModel("round-1-source", sourcePrompt);
  await writeFile(path.join(outputDir, "round-1-source.txt"), `${sourceText}\n`, "utf8");
  let source;
  try { source = parseJsonText(sourceText); validateSource(source); check("model-source-local-shape", true, { recordCount: source.records.length }); }
  catch (error) { check("model-source-local-shape", false, { message: error.message }); }
  await saveJson(path.join(outputDir, "model-source.json"), source);

  const tempRoot = await mkdtemp(path.join(runtimeDir, "run-"));
  const workspaceDir = path.join(tempRoot, "workspace");
  const stateDir = path.join(tempRoot, "state");
  const configPath = path.join(tempRoot, "openclaw.json");
  await mkdir(workspaceDir, { recursive: true });
  await mkdir(stateDir, { recursive: true });
  await writeFile(path.join(workspaceDir, "research.json"), `${JSON.stringify(source, null, 2)}\n`, "utf8");
  const port = await freePort();
  const token = `verseconf-live-${Date.now()}`;
  await writeFile(configPath, `${JSON.stringify({ gateway: { port, bind: "loopback", auth: { mode: "token", token }, controlUi: { enabled: false } }, hooks: { enabled: false }, agents: { defaults: { workspace: workspaceDir } }, plugins: { enabled: true, allow: ["verseconf-artifacts"], entries: { "verseconf-artifacts": { enabled: true } } } }, null, 2)}\n`, "utf8");
  const child = spawn(process.execPath, [runtimeEntry, "gateway", "--port", String(port), "--bind", "loopback"], { cwd: runtimeRoot, env: { ...process.env, OPENCLAW_STATE_DIR: stateDir, OPENCLAW_CONFIG_PATH: configPath, OPENCLAW_HOME: tempRoot, HOME: tempRoot, USERPROFILE: tempRoot, OPENCLAW_GATEWAY_TOKEN: token, OPENCLAW_SKIP_CHANNELS: "1", OPENCLAW_SKIP_PROVIDERS: "1", OPENCLAW_SKIP_CRON: "1", OPENCLAW_TEST_MINIMAL_GATEWAY: "1", VITEST: "1" }, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = ""; let stderr = "";
  child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const invoke = async (name, invokeArgs) => {
    const response = await fetch(`http://127.0.0.1:${port}/tools/invoke`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ name, sessionKey: "agent:main:main", args: invokeArgs }), signal: AbortSignal.timeout(60_000) });
    const body = await response.json();
    const event = { name, status: response.status, request: invokeArgs, response: body };
    transcript.push(event);
    await saveJson(transcriptPath, transcript);
    return { status: response.status, body, details: gatewayDetails(body) };
  };
  try {
    await waitForPort(child, port);
    check("gateway-listening", true, { port });
    const created = await invoke("structured_artifact_create", { artifactId: "live-model-artifact", kind: "research-table", sourcePath: "research.json" });
    check("gateway-create", created.status === 200 && created.details?.artifactId === "live-model-artifact", { status: created.status, details: created.details });
    const baseRevisionId = created.details.revision.revisionId;
    const revisionPrompt = `Return only one JSON object and no markdown. Based on this source, return exactly two changes for record rec-managed: set evidenceState from unlinked to linked, and set evidenceRefs from [] to [the first source id]. Use the exact shape {"changes":[{"recordId":"rec-managed","fieldPath":["evidenceState"],"op":"setValue","expect":{"kind":"value","value":"unlinked"},"value":"linked"},{"recordId":"rec-managed","fieldPath":["evidenceRefs"],"op":"setValue","expect":{"kind":"value","value":[]},"value":["${source.sources[0].id}"]}]}. Do not add keys or prose. Source: ${JSON.stringify(source)}`;
    const revisionText = await callModel("round-2-revision", revisionPrompt);
    await writeFile(path.join(outputDir, "round-2-revision.txt"), `${revisionText}\n`, "utf8");
    let proposed;
    try { proposed = parseJsonText(revisionText); validateChanges(proposed, source); check("model-revision-local-shape", true); }
    catch (error) { check("model-revision-local-shape", false, { message: error.message }); }
    await saveJson(path.join(outputDir, "model-revision.json"), proposed);
    const revision = await invoke("structured_artifact_revise", { artifactId: "live-model-artifact", baseRevisionId, idempotencyKey: "live-model-revise-1", changes: proposed.changes });
    check("gateway-revise", revision.status === 200 && revision.details?.state === "committed", { status: revision.status, details: revision.details });
    const replay = await invoke("structured_artifact_revise", { artifactId: "live-model-artifact", baseRevisionId, idempotencyKey: "live-model-revise-1", changes: proposed.changes });
    check("idempotency-replay", replay.status === 200 && JSON.stringify(replay.details) === JSON.stringify(revision.details), { status: replay.status, sameDetails: JSON.stringify(replay.details) === JSON.stringify(revision.details) });
    const beforeConflictSha = await sha256(path.join(workspaceDir, "research.json"));
    const beforeConflictHistory = await invoke("structured_artifact_history", { artifactId: "live-model-artifact" });
    const conflictChanges = structuredClone(proposed.changes); conflictChanges[0].value = "unlinked";
    const conflict = await invoke("structured_artifact_revise", { artifactId: "live-model-artifact", baseRevisionId, idempotencyKey: "live-model-revise-1", changes: conflictChanges });
    const afterConflictSha = await sha256(path.join(workspaceDir, "research.json"));
    const afterConflictHistory = await invoke("structured_artifact_history", { artifactId: "live-model-artifact" });
    check("idempotency-conflict", conflict.status === 200 && conflict.details?.state === "rejected" && conflict.details?.diagnostics?.[0]?.code === "idempotency_conflict" && beforeConflictSha === afterConflictSha && JSON.stringify(beforeConflictHistory.details) === JSON.stringify(afterConflictHistory.details), { status: conflict.status, details: conflict.details, fileUnchanged: beforeConflictSha === afterConflictSha, historyUnchanged: JSON.stringify(beforeConflictHistory.details) === JSON.stringify(afterConflictHistory.details) });
    const inspected = await invoke("structured_artifact_inspect", { artifactId: "live-model-artifact" });
    check("gateway-inspect", inspected.status === 200 && inspected.details?.artifact?.artifactId === "live-model-artifact", { status: inspected.status, artifactId: inspected.details?.artifact?.artifactId });
    const exported = await invoke("structured_artifact_export", { artifactId: "live-model-artifact", format: "xlsx" });
    check("gateway-export", exported.status === 200 && exported.details?.output?.format === "xlsx", { status: exported.status, output: exported.details?.output });
    const history = await invoke("structured_artifact_history", { artifactId: "live-model-artifact" });
    check("gateway-history", history.status === 200 && history.details?.revisions?.length === 2 && history.details?.outputs?.length === 1, { status: history.status, revisions: history.details?.revisions?.length, outputs: history.details?.outputs?.length });
    await writeFile(path.join(outputDir, "gateway-stdout.log"), safe(stdout), "utf8");
    await writeFile(path.join(outputDir, "gateway-stderr.log"), safe(stderr), "utf8");
    const report = { schemaVersion: 1, status: "passed", driven_by: "agent", actor: "codex/verseconf-live-chain", providerAuthorizedByUser: true, model: process.env.VERSECONF_LIVE_MODEL, modelCalls: modelCalls.map(({ label, status, ok, elapsedMs, responseId }) => ({ label, status, ok, elapsedMs, responseId })), checks, outputDir, runtimeWorkspace: tempRoot, credentialPersistence: "checked-after-run" };
    await saveJson(reportPath, report);
    const serialized = JSON.stringify(report) + JSON.stringify(transcript) + stdout + stderr;
    check("credential-not-written", !serialized.includes(process.env.VERSECONF_LIVE_API_KEY), { message: "API key absent from saved report/transcript/logs" });
    await saveJson(reportPath, { ...report, checks });
    console.log(JSON.stringify({ status: report.status, outputDir, reportPath, checks: checks.length, failed: checks.filter((item) => !item.ok).length, modelCalls: modelCalls.length }, null, 2));
  } finally {
    if (child.exitCode === null) child.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (child.exitCode === null) child.kill("SIGKILL");
  }
}

try {
  await main();
} catch (error) {
  const issue = { issueId: `VC-LIVE-${stamp}`, status: "open", severity: "P1", driven_by: "agent", actor: "codex/verseconf-live-chain", title: "VerseConf live chain failed", message: error instanceof Error ? error.message : String(error), checks, modelCalls: modelCalls.map(({ label, status, ok, elapsedMs, responseId }) => ({ label, status, ok, elapsedMs, responseId })), reproduction: `pnpm verseconf:live`, outputDir };
  await saveJson(path.join(issueDir, `${issue.issueId}.json`), issue);
  await writeFile(path.join(issueDir, `${issue.issueId}.md`), `# ${issue.issueId}\n\n- Status: open\n- Severity: ${issue.severity}\n- Driven by: agent\n- Message: ${issue.message}\n- Evidence: ${outputDir}\n`, "utf8");
  await saveJson(reportPath, { schemaVersion: 1, status: "failed", driven_by: "agent", actor: "codex/verseconf-live-chain", checks, modelCalls: issue.modelCalls, issue: issue.issueId, outputDir });
  console.error(JSON.stringify({ status: "failed", issue: issue.issueId, outputDir, message: issue.message }, null, 2));
  process.exitCode = 1;
}
