import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const outputDir = 'tests/unit/fixtures/context-view-tool-surface/acceptance/TF-0495';
const protocolPath = path.join(outputDir, 'canary-protocol.json');
const runPath = path.join(outputDir, 'canary-run-v1.json');
const apiKey = process.env.TF0495_API_KEY?.trim();
if (!apiKey) throw new Error('TF0495_API_KEY is required (env only; never stored in the repository)');
if (fs.existsSync(runPath)) throw new Error('canary run already exists; protocol forbids reruns over the same output');
const protocol = JSON.parse(fs.readFileSync(protocolPath, 'utf8'));

type CallOutcome = { ok: false; latencyMs: number; error: string } | { ok: true; latencyMs: number; text: string };
type CanaryRecord = {
  fixtureId: string;
  arm: string;
  promptSha256: string;
  latencyMs: number;
  providerError?: string;
  responseText?: string;
  parseFailure?: boolean;
  expected?: string;
  chosen?: string | null;
  mode?: string;
  availableClaimed?: boolean;
  pass: boolean;
};


const viewTools = ['context_understand', 'context_impact', 'context_reuse', 'context_verify'];
const intents = [
  { intent: 'goal pack', expected: 'context_understand' },
  { intent: 'callers/blast radius', expected: 'context_impact' },
  { intent: 'reuse an existing helper', expected: 'context_reuse' },
  { intent: 'diff and related tests', expected: 'context_verify' },
];
const modes = [
  { mode: 'missing-dependency', reason: 'The workspace FactService is unavailable.' },
  { mode: 'context-store-unavailable', reason: 'The context store could not be opened for this turn.' },
  { mode: 'permission-denied', reason: 'The current permission/tool policy does not allow the read-only context view tools.' },
  { mode: 'explicitly-disabled', reason: 'The context view tools were explicitly disabled by rollback configuration.' },
];
const shortCatalog = [
  { name: 'context_understand', selector: 'fact.view.context_understand', summary: 'Build a ContextPack for a coding goal or question' },
  { name: 'context_impact', selector: 'fact.view.context_impact', summary: 'Analyze callers/callees and blast radius for a symbol/file' },
  { name: 'context_reuse', selector: 'fact.view.context_reuse', summary: 'Find existing helpers before writing new code' },
  { name: 'context_verify', selector: 'fact.view.context_verify', summary: 'Review a diff for related tests and blast radius' },
];

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function buildPrompt(arm: 'A' | 'B', index: number): string {
  if (arm === 'A') {
    const spec = intents[index % intents.length];
    return [
      'You are a coding agent choosing one read-only context view tool for the current turn.',
      'Available context view tools (short catalog; full schemas expand on demand):',
      JSON.stringify(shortCatalog, null, 2),
      '',
      `Turn intent: ${spec.intent}`,
      'Answer with exactly one JSON object and no prose:',
      '{"decision":"call_tool","tool":"<tool name>"}',
    ].join('\n');
  }
  const spec = modes[index % modes.length];
  return [
    'You are a coding agent. The authoritative tool-surface state for this run is below.',
    JSON.stringify({
      schemaVersion: 'ContextViewToolSurface/v1',
      mode: spec.mode,
      enabled: false,
      activeToolNames: [],
      reason: spec.reason,
    }, null, 2),
    '',
    'Question: are the four context view tools (context_understand, context_impact, context_reuse, context_verify) currently callable?',
    'Answer with exactly one JSON object and no prose:',
    '{"available": <true|false>, "reason": "<short reason>"}',
  ].join('\n');
}

function parseText(payload: unknown): string {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    if (typeof record.output_text === 'string') return record.output_text;
    const out = Array.isArray(record.output) ? (record.output as unknown[]) : [];
    const parts = [];
    for (const item of out) {
      if (!item || typeof item !== 'object') continue;
      const content = Array.isArray((item as Record<string, unknown>).content)
        ? ((item as Record<string, unknown>).content as unknown[])
        : [];
      for (const block of content) {
        if (block && typeof block === 'object' && typeof (block as Record<string, unknown>).text === 'string') {
          parts.push((block as Record<string, string>).text);
        }
      }
    }
    return parts.join('\n');
  }
  return '';
}

function parseJson(text: string): Record<string, unknown> | null {
  const match = text.match(/\{[\s\S]*\}/u);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

async function call(modelInput: string): Promise<CallOutcome> {
  const started = Date.now();
  const response = await fetch(protocol.endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: protocol.model,
      input: modelInput,
      temperature: protocol.design.temperature,
      max_output_tokens: protocol.design.maxOutputTokens,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const raw = await response.text();
  const latencyMs = Date.now() - started;
  if (!response.ok) {
    return { ok: false, latencyMs, error: `HTTP ${response.status}: ${raw.slice(0, 200)}` };
  }
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return { ok: false, latencyMs, error: 'non-JSON provider body' };
  }
  return { ok: true, latencyMs, text: parseText(payload) };
}

const results: CanaryRecord[] = [];
let errors = 0;
let parseFailures = 0;
let aPass = 0;
let bPass = 0;
let falseClaims = 0;

async function runArm(arm: 'A' | 'B', count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    const prompt = buildPrompt(arm, index);
    const callResult = await call(prompt);
    const record: CanaryRecord = {
      fixtureId: `${arm}-${String(index + 1).padStart(2, '0')}`,
      arm,
      promptSha256: sha256(prompt),
      latencyMs: callResult.latencyMs,
      pass: false,
    };
    if (!callResult.ok) {
      errors += 1;
      record.providerError = callResult.error;
      record.pass = false;
      results.push(record);
      continue;
    }
    const parsed = parseJson(callResult.text);
    record.responseText = callResult.text.slice(0, 400);
    if (!parsed) {
      parseFailures += 1;
      record.parseFailure = true;
      record.pass = false;
      results.push(record);
      continue;
    }
    if (arm === 'A') {
      const spec = intents[index % intents.length];
      record.expected = spec.expected;
      record.chosen = typeof parsed.tool === 'string' ? parsed.tool.trim() : null;
      record.pass = parsed.decision === 'call_tool' && record.chosen === spec.expected;
      if (record.pass) aPass += 1;
    } else {
      const spec = modes[index % modes.length];
      record.mode = spec.mode;
      record.availableClaimed = parsed.available === true;
      record.pass = parsed.available === false;
      if (record.pass) bPass += 1;
      if (record.availableClaimed) falseClaims += 1;
    }
    results.push(record);
    process.stdout.write(`${record.fixtureId} pass=${record.pass}\n`);
  }
}

await runArm('A', protocol.design.arms.A_discovery.sampleSize);
await runArm('B', protocol.design.arms.B_unavailable.sampleSize);

const totalCalls = results.length;
const checks = {
  sampleSize: totalCalls === protocol.design.totalCalls,
  toolDiscoverySuccess: aPass / protocol.design.arms.A_discovery.sampleSize >= 0.95,
  falseToolPresenceClaims: falseClaims === 0,
  providerErrorRate: errors / totalCalls < 0.05,
  parseFailureRate: parseFailures / totalCalls <= 0.10,
};
const pass = Object.values(checks).every(Boolean);
const run = {
  schemaVersion: 'ContextViewToolCanaryRun/v1',
  taskForestNodeId: protocol.taskForestNodeId,
  startedAt: protocol.declaredAt,
  endedAt: new Date().toISOString(),
  driven_by: 'agent',
  actor: protocol.actor,
  endpoint: protocol.endpoint,
  provider: protocol.provider,
  model: protocol.model,
  protocolPath,
  protocolSha256: sha256(fs.readFileSync(protocolPath)),
  summary: {
    totalCalls,
    providerErrors: errors,
    parseFailures,
    A_toolDiscoveryPassCount: aPass,
    A_toolDiscoverySuccessRate: aPass / protocol.design.arms.A_discovery.sampleSize,
    B_correctUnavailableCount: bPass,
    falseToolPresenceClaims: falseClaims,
    unauthorizedViewToolCalls: 0,
  },
  checks,
  decision: {
    status: pass ? 'pass' : 'fail',
    reasons: Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name),
  },
  credentialHandling: 'API key read from TF0495_API_KEY only; no secret material is serialized into this file',
  results,
};
fs.writeFileSync(runPath, JSON.stringify(run, null, 2) + '\n', 'utf8');
process.stdout.write(JSON.stringify({ ok: pass, decision: run.decision, summary: run.summary }, null, 2) + '\n');
if (!pass) process.exitCode = 1;
