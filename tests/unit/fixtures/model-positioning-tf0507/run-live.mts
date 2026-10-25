// TF-0507 live positioning evaluation.
// The protocol and all 24 expected answers are frozen before this script runs.
// Usage: TF0507_API_KEY=<env-only> pnpm --dir openclaw_runtime exec tsx ../tests/unit/fixtures/model-positioning-tf0507/run-live.mts
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildFixtureProfile,
  probeToolDecision,
  restrictionNames,
  
  scoreAnswer,
  sha256,
  type JsonValue,
  type PositioningProtocol,
} from './fixture-lib.mts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const dir = 'tests/unit/fixtures/model-positioning-tf0507';
const protocolPath = path.join(root, dir, 'protocol-final.json');
const runPath = path.join(root, dir, 'run-final.json');
const apiKey = process.env.LOCAL3065_API_KEY?.trim() || process.env.TF0507_API_KEY?.trim();
if (!apiKey) throw new Error('LOCAL3065_API_KEY or TF0507_API_KEY is required (env only)');
if (!fs.existsSync(protocolPath)) throw new Error('protocol-final.json must be frozen before running');
if (fs.existsSync(runPath)) throw new Error('run-final.json already exists; the frozen protocol forbids rerun');
const protocolRaw = fs.readFileSync(protocolPath);
const protocol = JSON.parse(protocolRaw.toString('utf8')) as PositioningProtocol;
if (protocol.status !== 'frozen-before-live-run') throw new Error('protocol is not frozen');
if (protocol.cases.length !== 24) throw new Error(`expected 24 cases, got ${protocol.cases.length}`);

type Answer = {
  repeat: number;
  ok: boolean;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  text: string;
  error: string | null;
  pass: boolean;
  exact: boolean;
  forbidden: string[];
  parseError: string | null;
};
type Row = {
  scenarioId: string;
  profileId: string;
  scenarioClass: string;
  promptSha256: string;
  profileDigest: string;
  toolDecision: ReturnType<typeof probeToolDecision> | null;
  answers: Answer[];
  pass: boolean;
};

async function ask(prompt: string): Promise<{ ok: boolean; latencyMs: number; inputTokens: number; outputTokens: number; text: string; error: string | null }> {
  const startedAt = Date.now();
  try {
    const response = await fetch(protocol.endpoint, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: protocol.model,
        input: prompt,
        temperature: protocol.temperature,
        max_output_tokens: protocol.maxOutputTokens,
      }),
      signal: AbortSignal.timeout(180_000),
    });
    const latencyMs = Date.now() - startedAt;
    const raw = await response.text();
    if (!response.ok) {
      return { ok: false, latencyMs, inputTokens: 0, outputTokens: 0, text: '', error: `HTTP ${response.status}: ${raw.slice(0, 240)}` };
    }
    let payload: any;
    try { payload = JSON.parse(raw); } catch { return { ok: false, latencyMs, inputTokens: 0, outputTokens: 0, text: '', error: 'non-JSON provider body' }; }
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
      text: text.slice(0, 2_400),
      error: null,
    };
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - startedAt, inputTokens: 0, outputTokens: 0, text: '', error: error instanceof Error ? error.message : String(error) };
  }
}

function stableValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(stableValue).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  if (typeof value === 'string') return value.trim();
  return value;
}

function restrictionMatch(testCase: (typeof protocol.cases)[number], parsed: Record<string, JsonValue> | null): { pass: boolean; expected: string[]; actual: string[]; missing: string[]; extra: string[] } {
  if (testCase.scenarioClass !== 'A') return { pass: true, expected: [], actual: [], missing: [], extra: [] };
  const profile = buildFixtureProfile(protocol, testCase.profileId).profile;
  const expected = restrictionNames(profile);
  const raw = parsed?.restricted;
  const actual = Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string').sort() : [];
  const missing = expected.filter((item) => !actual.includes(item));
  const extra = actual.filter((item) => !expected.includes(item));
  return { pass: missing.length === 0 && extra.length === 0, expected, actual, missing, extra };
}

console.log(JSON.stringify({ status: 'starting', endpoint: protocol.endpoint, model: protocol.model, rows: protocol.cases.length, repeats: protocol.repeats }, null, 2));
const rows: Row[] = [];
for (const testCase of protocol.cases) {
  const built = buildFixtureProfile(protocol, testCase.profileId);
  const toolDecision = testCase.expectedToolDecision ? probeToolDecision(built.profile, testCase.expectedToolDecision) : null;
  const answers: Answer[] = [];
  for (let repeat = 1; repeat <= protocol.repeats; repeat += 1) {
    const response = await ask(testCase.prompt);
    const scored = scoreAnswer(testCase, response.text);
    const restrictions = restrictionMatch(testCase, scored.parsed);
    const seen = JSON.stringify(stableValue(scored.parsed ?? ({} as JsonValue)));
    const forbidden = testCase.forbiddenClaims.filter((pattern) => new RegExp(pattern, 'iu').test(seen));
    const toolConsistent = !toolDecision || (toolDecision.outcome === testCase.expectedToolDecision?.expectedOutcome && toolDecision.profileConsistent);
    const pass = response.ok && scored.exact && scored.pass && restrictions.pass && toolConsistent && forbidden.length === 0;
    answers.push({
      repeat,
      ok: response.ok,
      latencyMs: response.latencyMs,
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      text: response.text,
      error: response.error,
      pass,
      exact: scored.exact,
      forbidden,
      parseError: scored.error,
    });
    console.log([testCase.scenarioId, 'repeat=' + repeat, response.ok ? 'ok' : 'ERR', scored.exact ? 'exact' : 'mismatch', restrictions.pass ? 'inventory-ok' : 'inventory-mismatch', 'score=' + (pass ? 1 : 0)].join(' '));
  }
  rows.push({
    scenarioId: testCase.scenarioId,
    profileId: testCase.profileId,
    scenarioClass: testCase.scenarioClass,
    promptSha256: sha256(testCase.prompt),
    profileDigest: built.profile.effectiveDigest,
    toolDecision: toolDecision,
    answers,
    pass: answers.every((answer) => answer.pass),
  });
}

const totalCalls = rows.reduce((sum, row) => sum + row.answers.length, 0);
const passedRows = rows.filter((row) => row.pass).length;
const passedCalls = rows.reduce((sum, row) => sum + row.answers.filter((answer) => answer.pass).length, 0);
const falseClaims = rows.reduce((sum, row) => sum + row.answers.filter((answer) => !answer.pass).length, 0);
const internalLeaks = rows.reduce((sum, row) => sum + row.answers.filter((answer) => answer.forbidden.length > 0).length, 0);
const providerErrors = rows.reduce((sum, row) => sum + row.answers.filter((answer) => !answer.ok).length, 0);
const decision = passedRows === rows.length && providerErrors === 0 ? 'pass' : 'fail';
const run = {
  schemaVersion: 'ModelPositioningRun/v1',
  taskForestNodeId: 'TF-0507',
  driven_by: 'agent',
  actor: 'codex',
  startedAt: protocol.declaredAt,
  endedAt: new Date().toISOString(),
  protocolSha256: sha256(protocolRaw),
  endpoint: protocol.endpoint,
  provider: protocol.provider,
  model: protocol.model,
  dataset: protocol.dataset,
  repeats: protocol.repeats,
  scorer: protocol.scorer,
  scope: '24 frozen rows x 3 repeats against space-bunny; no cross-provider or universal-generalization claim',
  summary: {
    rows: rows.length,
    totalCalls,
    passedRows,
    passedCalls,
    rowPassRate: passedRows / rows.length,
    callPassRate: passedCalls / totalCalls,
    observedFalseCapabilityClaims: falseClaims,
    internalNameLeaks: internalLeaks,
    providerErrors,
  },
  checks: {
    allRowsPass: passedRows === rows.length,
    noProviderErrors: providerErrors === 0,
    noFalseCapabilityClaims: falseClaims === 0,
    noInternalNameLeaks: internalLeaks === 0,
  },
  decision,
  failureRule: protocol.rowPassRule,
  rows,
};
fs.writeFileSync(runPath, JSON.stringify(run, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ decision, summary: run.summary, checks: run.checks }, null, 2));
if (decision !== 'pass') process.exitCode = 2;
