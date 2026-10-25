// TF-0496 A/B runner: real provider usage decides VToken keep-or-retire.
// Protocol is frozen in ab-protocol.json BEFORE this script runs.
// Usage: TF0502_API_KEY=<env-only> openclaw_runtime/node_modules/.bin/tsx run-ab.mts
// Refuses to rerun once ab-run.json exists.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const dir = 'tests/unit/fixtures/vtoken-tf0496';
const protocolPath = path.join(root, dir, 'ab-protocol.json');
const contextsPath = path.join(root, dir, 'contexts.json');
const runPath = path.join(root, dir, 'ab-run.json');
const apiKey = process.env.TF0502_API_KEY?.trim();
if (!apiKey) throw new Error('TF0502_API_KEY is required (env only)');
if (!fs.existsSync(protocolPath)) throw new Error('ab-protocol.json must be frozen before running');
if (fs.existsSync(runPath)) throw new Error('ab-run.json already exists; protocol forbids rerun');
const protocol = JSON.parse(fs.readFileSync(protocolPath, 'utf8'));
const contexts = JSON.parse(fs.readFileSync(contextsPath, 'utf8')).cases as Array<{
  id: string; title: string; raw: string; vt: string;
}>;

type Fact = { id: string; expected: string; kind: 'number' | 'literal' };
/**
 * Pick a fact both arms carry verbatim: prefer a numeric value, else a
 * distinctive literal token. Returns null only when the markdown has no
 * bullet line at all.
 */
function pickFact(raw: string): Fact | null {
  const lines = raw.split('\n').filter((line) => /^- [A-Za-z0-9_.-]+ \([A-Z]+\): /u.test(line));
  for (const line of lines) {
    const m = line.match(/^- ([A-Za-z0-9_.-]+) \([A-Z]+\): (.+)$/u)!;
    const digits = m[2].match(/\d+/u);
    if (digits) return { id: m[1], expected: digits[0], kind: 'number' };
  }
  for (const line of lines) {
    const m = line.match(/^- ([A-Za-z0-9_.-]+) \([A-Z]+\): (.+)$/u)!;
    const literal = m[2].match(/[A-Za-z][A-Za-z0-9_.:-]{3,}/u);
    if (literal) return { id: m[1], expected: literal[0], kind: 'literal' };
  }
  return null;
}

type Arm = { ok: boolean; latencyMs: number; inputTokens: number; outputTokens: number; cachedTokens: number | null; text: string; error?: string };
type PairRecord = {
  pairId: string;
  stratum: 'short-en' | 'short-zh' | 'long-en' | 'long-zh';
  factId: string;
  expected: string;
  question: string;
  control: Arm;
  treatment: Arm;
};

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

async function call(prompt: string): Promise<Arm> {
  const started = Date.now();
  try {
    const response = await fetch(protocol.endpoint, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: protocol.model,
        input: prompt,
        temperature: protocol.design.temperature,
        max_output_tokens: protocol.design.maxOutputTokens,
      }),
      signal: AbortSignal.timeout(120_000),
    });
    const latencyMs = Date.now() - started;
    const raw = await response.text();
    if (!response.ok) return { ok: false, latencyMs, inputTokens: 0, outputTokens: 0, cachedTokens: null, text: '', error: 'HTTP ' + response.status + ': ' + raw.slice(0, 160) };
    let payload: any;
    try { payload = JSON.parse(raw); } catch { return { ok: false, latencyMs, inputTokens: 0, outputTokens: 0, cachedTokens: null, text: '', error: 'non-JSON body' }; }
    let text = '';
    if (typeof payload.output_text === 'string') text = payload.output_text;
    else if (Array.isArray(payload.output)) {
      for (const item of payload.output) {
        if (!item || !Array.isArray(item.content)) continue;
        for (const block of item.content) if (typeof block.text === 'string') text += block.text + '\n';
      }
    }
    const usage = payload.usage ?? {};
    const details = usage.prompt_tokens_details ?? usage.input_tokens_details ?? {};
    const cachedRaw = details.cached_tokens ?? usage.cached_tokens;
    return {
      ok: true,
      latencyMs,
      inputTokens: Number(usage.input_tokens ?? usage.prompt_tokens ?? 0),
      outputTokens: Number(usage.output_tokens ?? usage.completion_tokens ?? 0),
      cachedTokens: Number.isFinite(Number(cachedRaw)) ? Number(cachedRaw) : null,
      text: text.slice(0, 400),
    };
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - started, inputTokens: 0, outputTokens: 0, cachedTokens: null, text: '', error: error instanceof Error ? error.message : String(error) };
  }
}

function norm(value: string): string {
  return value.replace(/[\s,]/gu, '').toLowerCase();
}
function quality(arm: Arm, expected: string): number {
  return arm.ok && norm(arm.text).includes(norm(expected)) ? 1 : 0;
}
function questionFor(language: 'en' | 'zh', fact: Fact): string {
  if (language === 'en') {
    return fact.kind === 'number'
      ? 'According to the context above, what numeric value is specified for ' + fact.id + '? Reply with the number only.'
      : 'According to the context above, what value is specified for ' + fact.id + '? Reply with that value only.';
  }
  return fact.kind === 'number'
    ? '根据上面的上下文，' + fact.id + ' 指定的数值是多少？只回答数字。'
    : '根据上面的上下文，' + fact.id + ' 指定的值是什么？只回答该值。';
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
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const random = mulberry32(seed);
  const means: number[] = [];
  for (let r = 0; r < resamples; r += 1) {
    let total = 0;
    for (let i = 0; i < values.length; i += 1) total += values[Math.floor(random() * values.length)];
    means.push(total / values.length);
  }
  means.sort((a, b) => a - b);
  const at = (q: number) => means[Math.min(means.length - 1, Math.max(0, Math.floor(q * (means.length - 1))))];
  return { lower: at(0.025), upper: at(0.975), mean };
}
function p95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)];
}

// Build the 30 predeclared pairs.
const pairs: Array<{ pairId: string; stratum: PairRecord['stratum']; fact: Fact; rawContext: string; vtContext: string }> = [];
// Every scenario must yield a fact, otherwise the predeclared n cannot be met.
const facts = contexts.map((c) => pickFact(c.raw));
facts.forEach((fact, index) => {
  if (!fact) throw new Error('no fact could be derived from ' + contexts[index].id);
});
contexts.forEach((c, index) => {
  const fact = facts[index]!;
  pairs.push({ pairId: 'short-en-' + c.id, stratum: 'short-en', fact, rawContext: c.raw, vtContext: c.vt });
  pairs.push({ pairId: 'short-zh-' + c.id, stratum: 'short-zh', fact, rawContext: c.raw, vtContext: c.vt });
});
// Five long-context groups of four scenarios each, wrapping deterministically.
for (let g = 0; g < 5; g += 1) {
  const members = [0, 1, 2, 3].map((offset) => contexts[(g * 2 + offset) % contexts.length]!);
  const longFact = facts[(g * 2 + 3) % contexts.length]!;
  const rawContext = members.map((m) => m.raw).join('\n\n');
  const vtContext = members.map((m) => m.vt).join('\n\n');
  pairs.push({ pairId: 'long-en-g' + g, stratum: 'long-en', fact: longFact, rawContext, vtContext });
  pairs.push({ pairId: 'long-zh-g' + g, stratum: 'long-zh', fact: longFact, rawContext, vtContext });
}
if (pairs.length !== protocol.design.totalPairs) {
  throw new Error('expected ' + protocol.design.totalPairs + ' pairs, built ' + pairs.length);
}

const records: PairRecord[] = [];
for (const pair of pairs) {
  const language = pair.stratum.endsWith('zh') ? 'zh' : 'en';
  const question = questionFor(language, pair.fact);
  const control = await call(pair.rawContext + '\n\n' + question);
  const treatment = await call(pair.vtContext + '\n\n' + question);
  records.push({ pairId: pair.pairId, stratum: pair.stratum, factId: pair.fact.id, expected: pair.fact.expected, question, control, treatment });
  console.log([pair.pairId, 'ctl=' + control.inputTokens + 'tok/' + (control.ok ? 'ok' : 'ERR'), 'trt=' + treatment.inputTokens + 'tok/' + (treatment.ok ? 'ok' : 'ERR'), 'q=' + quality(control, pair.fact.expected) + '/' + quality(treatment, pair.fact.expected)].join(' '));
}

const tokenDiffs = records.map((r) => r.control.inputTokens - r.treatment.inputTokens);
const qualityDiffs = records.map((r) => quality(r.treatment, r.expected) - quality(r.control, r.expected));
const latencyRatios = records.map((r) => (r.control.latencyMs > 0 ? r.treatment.latencyMs / r.control.latencyMs : 1));
const tokenCi = bootstrapCi(tokenDiffs, 20261023, 10000);
const qualityCi = bootstrapCi(qualityDiffs, 20261023, 10000);
const controlMeanTokens = records.reduce((s, r) => s + r.control.inputTokens, 0) / records.length;
const relativeReduction = controlMeanTokens > 0 ? tokenCi.mean / controlMeanTokens : 0;
const providerErrors = records.reduce((s, r) => s + (r.control.ok ? 0 : 1) + (r.treatment.ok ? 0 : 1), 0);
const controlP95 = p95(records.map((r) => r.control.latencyMs));
const treatmentP95 = p95(records.map((r) => r.treatment.latencyMs));

const checks = {
  pairs: records.length === protocol.design.totalPairs,
  providerErrorsZero: providerErrors === 0,
  materialTokenWin: tokenCi.mean > 0 && tokenCi.lower > 0 && relativeReduction >= 0.1,
  qualityNonInferior: qualityCi.lower >= -0.05,
  latencyNonRegression: controlP95 > 0 ? treatmentP95 <= 1.25 * controlP95 : false,
};
const pass = Object.values(checks).every(Boolean);
const cachedReported = records.some((r) => r.control.cachedTokens !== null || r.treatment.cachedTokens !== null);

const run = {
  schemaVersion: 'VTokenROIABRun/v1',
  taskForestNodeId: 'TF-0496',
  driven_by: 'agent',
  actor: 'codex',
  startedAt: protocol.declaredAt,
  endedAt: new Date().toISOString(),
  protocolSha256: sha256(fs.readFileSync(protocolPath)),
  endpoint: protocol.endpoint,
  model: protocol.model,
  summary: {
    pairs: records.length,
    providerErrors,
    controlMeanInputTokens: controlMeanTokens,
    treatmentMeanInputTokens: records.reduce((s, r) => s + r.treatment.inputTokens, 0) / records.length,
    inputTokenReductionMean: tokenCi.mean,
    inputTokenReductionCi95: { lower: tokenCi.lower, upper: tokenCi.upper },
    relativeInputTokenReduction: relativeReduction,
    qualityControlMean: records.reduce((s, r) => s + quality(r.control, r.expected), 0) / records.length,
    qualityTreatmentMean: records.reduce((s, r) => s + quality(r.treatment, r.expected), 0) / records.length,
    qualityDeltaCi95: { lower: qualityCi.lower, upper: qualityCi.upper },
    controlP95LatencyMs: controlP95,
    treatmentP95LatencyMs: treatmentP95,
    latencyRatioP95: controlP95 > 0 ? treatmentP95 / controlP95 : null,
    cachedTokensReported: cachedReported,
    latencyRatioMean: latencyRatios.reduce((s, v) => s + v, 0) / latencyRatios.length,
  },
  checks,
  decision: {
    status: pass ? 'keep' : 'retire-or-hold',
    reasons: Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name),
    rule: protocol.thresholds.decisionRule,
  },
  pairs: records,
};
fs.writeFileSync(runPath, JSON.stringify(run, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ decision: run.decision, summary: run.summary, checks }, null, 2));