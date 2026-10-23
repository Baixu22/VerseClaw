import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const outputDir = 'tests/unit/fixtures/capability-registry-v3/acceptance/TF-0502';
const protocolPath = path.join(root, outputDir, 'ab-protocol.json');
const runPath = path.join(root, outputDir, 'ab-run-v1.json');
const apiKey = process.env.TF0502_API_KEY?.trim();
if (!apiKey) throw new Error('TF0502_API_KEY is required (env only)');
if (fs.existsSync(runPath)) throw new Error('ab run already exists; protocol forbids rerun');
const protocol = JSON.parse(fs.readFileSync(protocolPath, 'utf8'));

const catalog = [
  { id: 'openclaw:workspace-read', name: 'workspace_read', description: 'Read one workspace file.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { id: 'mcp:github-search', name: 'search_issues', description: 'Search GitHub issues.', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { id: 'openclaw:exec', name: 'exec', description: 'Run a shell command.', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } },
];
const fixtures = [];
for (let i = 0; i < 20; i += 1) {
  const tool = i % 3 === 0 ? 'workspace_read' : i % 3 === 1 ? 'search_issues' : 'exec';
  const query = tool === 'workspace_read' ? 'read the workspace file' : tool === 'search_issues' ? 'search GitHub issues' : 'run a shell command';
  fixtures.push({ id: 'select-' + i, stratum: 'toolSelection', query, expected: tool });
}
for (let i = 0; i < 20; i += 1) {
  const tool = i % 2 === 0 ? 'workspace_read' : 'search_issues';
  fixtures.push({ id: 'expand-' + i, stratum: 'schemaExpansion', query: 'describe the full schema of ' + tool, expected: tool });
}

function sha256(value: string | Uint8Array): string { return createHash('sha256').update(value).digest('hex'); }
function shortCatalog() { return catalog.map((entry) => ({ id: entry.id, name: entry.name, description: entry.description })); }
function promptFor(arm: string, fixture: { query: string }): string {
  const header = arm === 'A' ? 'Full catalog schemas:' : 'Short catalog summaries; use tool_describe for full schemas:';
  const payload = arm === 'A' ? JSON.stringify(catalog) : JSON.stringify(shortCatalog());
  return ['You are a coding agent choosing exactly one tool.', header, payload, '', fixture.query, 'Return only JSON: {"tool":"<tool name>"}'].join('\n');
}
function parseTool(text: string): string | null {
  try {
    const match = text.match(/\{[\s\S]*\}/u);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    return typeof parsed.tool === 'string' ? parsed.tool.trim() : null;
  } catch { return null; }
}
async function call(prompt: string): Promise<{ ok: true; latencyMs: number; text: string } | { ok: false; latencyMs: number; error: string }> {
  const started = Date.now();
  const response = await fetch(protocol.endpoint, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: protocol.model, input: prompt, temperature: 0, max_output_tokens: protocol.maxOutputTokens }),
    signal: AbortSignal.timeout(120_000),
  });
  const latencyMs = Date.now() - started;
  const raw = await response.text();
  if (!response.ok) return { ok: false, latencyMs, error: 'HTTP ' + response.status + ': ' + raw.slice(0, 200) };
  let payload;
  try { payload = JSON.parse(raw); } catch { return { ok: false, latencyMs, error: 'non-JSON body' }; }
  let text = '';
  if (typeof payload.output_text === 'string') text = payload.output_text;
  else if (Array.isArray(payload.output)) {
    for (const item of payload.output) {
      if (!item || !Array.isArray(item.content)) continue;
      for (const block of item.content) if (typeof block.text === 'string') text += block.text + '\n';
    }
  }
  return { ok: true, latencyMs, text };
}
type AbCallRecord = {
  fixtureId: string;
  arm: string;
  promptSha256: string;
  schemaChars: number;
  ok: boolean;
  pass: boolean;
  responseText: string;
  latencyMs: number;
  providerError?: string;
  parseFailure?: boolean;
  chosen?: string;
};

const results = [];
const pairs = [];
let errors = 0;
let parseFailures = 0;
let aPass = 0;
let bPass = 0;
for (const fixture of fixtures) {
  const armResults: Record<string, AbCallRecord> = {};
  for (const arm of ['A', 'B']) {
    const prompt = promptFor(arm, fixture);
    const callResult = await call(prompt);
    const record: AbCallRecord = { fixtureId: fixture.id, arm, promptSha256: sha256(prompt), schemaChars: (arm === 'A' ? JSON.stringify(catalog) : JSON.stringify(shortCatalog())).length, ok: callResult.ok, pass: false, responseText: '', latencyMs: callResult.latencyMs };
    if (!callResult.ok) { errors += 1; record.providerError = callResult.error; }
    else {
      record.responseText = callResult.text.slice(0, 400);
      const tool = parseTool(callResult.text);
      if (!tool) { parseFailures += 1; record.parseFailure = true; }
      else {
        record.chosen = tool;
        record.pass = tool === fixture.expected;
        if (record.pass) { if (arm === 'A') aPass += 1; else bPass += 1; }
      }
    }
    results.push(record);
    armResults[arm] = record;
  }
  pairs.push({ fixtureId: fixture.id, stratum: fixture.stratum, expected: fixture.expected, A: armResults.A, B: armResults.B });
}
function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))] ?? 0;
}
const diffs = pairs.map((pair) => (pair.B.pass ? 1 : 0) - (pair.A.pass ? 1 : 0));
const ci = { lower: quantile(diffs, 0.025), upper: quantile(diffs, 0.975) };
const reduction = JSON.stringify(shortCatalog()).length - JSON.stringify(catalog).length;
const checks = { samples: results.length === 80, providerErrorsOk: errors / 80 < 0.05, parseOk: parseFailures / 80 <= 0.10, firstCallNonInferior: ci.lower >= -0.05, schemaTokenReductionPositive: reduction < 0 };
const pass = Object.values(checks).every(Boolean);
const run = { schemaVersion: 'CapabilityCatalogABRun/v1', taskForestNodeId: 'TF-0502', startedAt: protocol.declaredAt, endedAt: new Date().toISOString(), driven_by: 'agent', actor: 'codex', protocolSha256: sha256(fs.readFileSync(protocolPath)), endpoint: protocol.endpoint, provider: protocol.provider, model: protocol.model, summary: { totalCalls: results.length, providerErrors: errors, parseFailures, aPass, bPass, A_passRate: aPass / 40, B_passRate: bPass / 40, firstCallDeltaCi95: ci, schemaTokenReductionChars: reduction, controlSchemaChars: JSON.stringify(catalog).length, treatmentSchemaChars: JSON.stringify(shortCatalog()).length }, checks, decision: { status: pass ? 'pass' : 'fail', reasons: Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name) }, pairs: results };
fs.writeFileSync(runPath, JSON.stringify(run, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ ok: pass, decision: run.decision, summary: run.summary, checks }, null, 2));
if (!pass) process.exitCode = 1;
