// TF-0502 A/B v2.1 runner.
// Protocol is frozen in ab-protocol-v2.json (v2.1) BEFORE this run.
// Usage: TF0502_API_KEY=<env-only> openclaw_runtime/node_modules/.bin/tsx run-ab-v2.mts
// Refuses to rerun once ab-run-v2.json exists.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

type ToolDef = { id: string; name: string; description: string; parameters: Record<string, unknown> };
type Turn = { role: 'user' | 'assistant' | 'tool'; content: string };
type CallResult =
  | { ok: true; latencyMs: number; inputTokens: number; outputTokens: number; text: string }
  | { ok: false; latencyMs: number; error: string };
type ArmOutcome = {
  pass: boolean;
  chosen: string | null;
  inputTokens: number;
  turns: number;
  ok: boolean;
  usedDescribe: boolean;
  error?: string;
  responseText: string;
};
type PairRecord = {
  fixtureId: string;
  stratum: 'toolSelection' | 'schemaExpansion';
  query: string;
  expected: string;
  control: ArmOutcome;
  treatment: ArmOutcome;
};

const root = process.cwd();
const dir = 'tests/unit/fixtures/capability-registry-v3/acceptance/TF-0502';
const protocolPath = path.join(root, dir, 'ab-protocol-v2.json');
const runPath = path.join(root, dir, 'ab-run-v2.json');
const apiKey = process.env.TF0502_API_KEY?.trim();
if (!apiKey) throw new Error('TF0502_API_KEY is required (env only)');
if (!fs.existsSync(protocolPath)) throw new Error('ab-protocol-v2.json must be frozen before running');
if (fs.existsSync(runPath)) throw new Error('ab-run-v2.json already exists; protocol forbids rerun');
const protocol = JSON.parse(fs.readFileSync(protocolPath, 'utf8'));
if (!String(protocol.schemaVersion).includes('v2.1')) throw new Error('expected amended protocol v2.1, found ' + protocol.schemaVersion);

const catalog: ToolDef[] = [
  { id: 'openclaw:workspace-read', name: 'workspace_read', description: 'Read one workspace file.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { id: 'mcp:github-search', name: 'search_issues', description: 'Search GitHub issues.', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { id: 'openclaw:exec', name: 'exec', description: 'Run a shell command.', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } },
];
const summaries = catalog.map((entry) => ({ id: entry.id, name: entry.name, description: entry.description }));
const fullSchemas = catalog.map((entry) => ({ id: entry.id, name: entry.name, description: entry.description, parameters: entry.parameters }));
const toolDescribeSchema = { name: 'tool_describe', description: 'Return the full schema of one catalog tool.', parameters: { type: 'object', properties: { tool: { type: 'string' } }, required: ['tool'] } };

const norm = (value: string): string => value.trim().toLowerCase();
function lookup(value: string): ToolDef | undefined {
  const key = norm(value);
  return catalog.find((entry) => norm(entry.name) === key || norm(entry.id) === key);
}
function matchesExpected(value: string, expected: string): boolean {
  const entry = lookup(value);
  return entry !== undefined && norm(entry.name) === norm(expected);
}
const describe = (value: string): ToolDef | undefined => lookup(value);

type Fixture = { id: string; stratum: 'toolSelection' | 'schemaExpansion'; query: string; expected: string };
const fixtures: Fixture[] = [];
for (let i = 0; i < 20; i += 1) {
  const tool = i % 3 === 0 ? 'workspace_read' : i % 3 === 1 ? 'search_issues' : 'exec';
  const query = tool === 'workspace_read' ? 'read the workspace file at src/index.ts' : tool === 'search_issues' ? 'search GitHub issues for open bugs' : 'run a shell command to list files';
  fixtures.push({ id: 'select-' + i, stratum: 'toolSelection', query, expected: tool });
}
for (let i = 0; i < 20; i += 1) {
  const tool = i % 2 === 0 ? 'workspace_read' : 'search_issues';
  fixtures.push({ id: 'expand-' + i, stratum: 'schemaExpansion', query: 'describe the full schema of ' + tool, expected: tool });
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}
function systemPrompt(arm: 'control' | 'treatment'): string {
  const header = arm === 'control' ? 'Full catalog schemas:' : 'Short catalog summaries; use tool_describe for full schemas:';
  const payload = arm === 'control' ? JSON.stringify(fullSchemas) : JSON.stringify(summaries);
  return ['You are a coding agent.', header, payload, '', 'Return only JSON. Choose exactly one tool. Do not explain.'].join('\n');
}

async function call(input: Turn[]): Promise<CallResult> {
  const started = Date.now();
  try {
    const response = await fetch(protocol.design.endpoint, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: protocol.design.model, input, temperature: protocol.design.temperature, max_output_tokens: protocol.design.maxOutputTokens }),
      signal: AbortSignal.timeout(120_000),
    });
    const latencyMs = Date.now() - started;
    const raw = await response.text();
    if (!response.ok) return { ok: false, latencyMs, error: 'HTTP ' + response.status + ': ' + raw.slice(0, 200) };
    let payload: any;
    try { payload = JSON.parse(raw); } catch { return { ok: false, latencyMs, error: 'non-JSON body' }; }
    let text = '';
    if (typeof payload.output_text === 'string') text = payload.output_text;
    else if (Array.isArray(payload.output)) {
      for (const item of payload.output) {
        if (!item || !Array.isArray(item.content)) continue;
        for (const block of item.content) if (typeof block.text === 'string') text += block.text + '\n';
      }
    }
    const usage = payload.usage ?? {};
    return {
      ok: true,
      latencyMs,
      inputTokens: Number(usage.input_tokens ?? usage.prompt_tokens ?? 0),
      outputTokens: Number(usage.output_tokens ?? usage.completion_tokens ?? 0),
      text,
    };
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - started, error: error instanceof Error ? error.message : String(error) };
  }
}

function parseJson(text: string): Record<string, unknown> | null {
  const match = text.match(/\{[\s\S]*\}/u);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch { return null; }
}

async function runArm(arm: 'control' | 'treatment', fixture: Fixture): Promise<ArmOutcome> {
  const input: Turn[] = [
    { role: 'user', content: systemPrompt(arm) },
    { role: 'user', content: fixture.query + '\nReturn only JSON.' },
  ];
  let chosen: string | null = null;
  let inputTokens = 0;
  let usedDescribe = false;
  let lastText = '';
  for (let turn = 1; turn <= 2; turn += 1) {
    const result = await call(input);
    if (!result.ok) return { pass: false, chosen, inputTokens, turns: turn, ok: false, usedDescribe, error: result.error, responseText: lastText };
    inputTokens += result.inputTokens;
    lastText = result.text.slice(0, 400);
    const parsed = parseJson(result.text);
    if (!parsed) return { pass: false, chosen, inputTokens, turns: turn, ok: true, usedDescribe, responseText: lastText };
    const tool = typeof parsed.tool === 'string' ? parsed.tool.trim() : null;
    const wantsDescribe = parsed.call === 'tool_describe';
    if (tool !== null && (arm === 'control' || !wantsDescribe)) {
      chosen = tool;
      const pass = matchesExpected(tool, fixture.expected);
      return { pass, chosen, inputTokens, turns: turn, ok: true, usedDescribe, responseText: lastText };
    }
    if (tool !== null && wantsDescribe && arm === 'treatment' && turn < 2) {
      usedDescribe = true;
      const def = describe(tool);
      if (!def) return { pass: false, chosen: tool, inputTokens, turns: turn, ok: true, usedDescribe, responseText: lastText };
      input.push({ role: 'assistant', content: result.text });
      input.push({ role: 'tool', content: 'tool_describe(' + def.name + ') => ' + JSON.stringify(def.parameters) });
      continue;
    }
    return { pass: false, chosen: tool, inputTokens, turns: turn, ok: true, usedDescribe, responseText: lastText };
  }
  return { pass: false, chosen, inputTokens, turns: 2, ok: true, usedDescribe, responseText: lastText };
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function bootstrapCi(values: number[], seed: number, resamples: number): { lower: number; upper: number; mean: number } {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const random = mulberry32(seed);
  const means: number[] = [];
  for (let r = 0; r < resamples; r += 1) {
    let total = 0;
    for (let i = 0; i < values.length; i += 1) total += values[Math.floor(random() * values.length)];
    means.push(total / values.length);
  }
  means.sort((left, right) => left - right);
  const at = (q: number) => means[Math.min(means.length - 1, Math.max(0, Math.floor(q * (means.length - 1))))];
  return { lower: at(0.025), upper: at(0.975), mean };
}

const pairs: PairRecord[] = [];
for (const fixture of fixtures) {
  const control = await runArm('control', fixture);
  const treatment = await runArm('treatment', fixture);
  pairs.push({ fixtureId: fixture.id, stratum: fixture.stratum, query: fixture.query, expected: fixture.expected, control, treatment });
  console.log([fixture.id, 'control=' + (control.pass ? 'pass' : 'fail'), 'treatment=' + (treatment.pass ? 'pass' : 'fail'), 'describe=' + (treatment.usedDescribe ? 'yes' : 'no')].join(' '));
}

const totalCalls = pairs.reduce((sum, pair) => sum + pair.control.turns + pair.treatment.turns, 0);
const providerErrors = pairs.reduce((sum, pair) => sum + (pair.control.ok ? 0 : 1) + (pair.treatment.ok ? 0 : 1), 0);
const controlPass = pairs.filter((pair) => pair.control.pass).length;
const treatmentPass = pairs.filter((pair) => pair.treatment.pass).length;
const successDiffs = pairs.map((pair) => (pair.treatment.pass ? 1 : 0) - (pair.control.pass ? 1 : 0));
const tokenDiffs = pairs.map((pair) => pair.control.inputTokens - pair.treatment.inputTokens);
const successCi = bootstrapCi(successDiffs, 20261023, 10000);
const tokenCi = bootstrapCi(tokenDiffs, 20261023, 10000);
const checks = {
  pairs: pairs.length === 40,
  providerErrorsOk: providerErrors === 0,
  firstCallNonInferior: successCi.lower >= -0.05,
  schemaTokenReductionPositive: tokenCi.mean > 0 && tokenCi.lower > 0,
};
const pass = Object.values(checks).every(Boolean);
const controlChars = JSON.stringify(fullSchemas).length;
const treatmentChars = JSON.stringify(summaries).length + JSON.stringify(toolDescribeSchema).length;
const run = {
  schemaVersion: 'CapabilityCatalogABRun/v2.1',
  taskForestNodeId: 'TF-0502',
  driven_by: 'agent',
  actor: 'codex',
  startedAt: protocol.declaredAt,
  amendedAt: protocol.amendedAt,
  endedAt: new Date().toISOString(),
  protocolSha256: sha256(fs.readFileSync(protocolPath)),
  endpoint: protocol.design.endpoint,
  model: protocol.design.model,
  summary: {
    totalCalls,
    providerErrors,
    controlPass,
    treatmentPass,
    controlPassRate: controlPass / pairs.length,
    treatmentPassRate: treatmentPass / pairs.length,
    successDeltaMean: successCi.mean,
    successDeltaCi95: { lower: successCi.lower, upper: successCi.upper },
    inputTokenReductionMean: tokenCi.mean,
    inputTokenReductionCi95: { lower: tokenCi.lower, upper: tokenCi.upper },
    controlInputTokens: pairs.reduce((sum, pair) => sum + pair.control.inputTokens, 0),
    treatmentInputTokens: pairs.reduce((sum, pair) => sum + pair.treatment.inputTokens, 0),
    treatmentDescribeTurns: pairs.filter((pair) => pair.treatment.usedDescribe).length,
    diagnosticCharDelta: treatmentChars - controlChars,
  },
  checks,
  decision: { status: pass ? 'pass' : 'fail', reasons: Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name) },
  pairs,
};
fs.writeFileSync(runPath, JSON.stringify(run, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ ok: pass, decision: run.decision, summary: run.summary, checks }, null, 2));
if (!pass) process.exitCode = 1;
