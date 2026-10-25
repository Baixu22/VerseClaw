import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const outputDir = 'tests/unit/fixtures/workspace-context/acceptance/TF-0494';
const protocolPath = `${outputDir}/canary-protocol.json`;
const protocolText = fs.readFileSync(path.join(root, protocolPath), 'utf8');
const protocol = JSON.parse(protocolText) as {
  schemaVersion: string;
  taskForestNodeId: string;
  endpoint: string;
  model: string;
  sampleSize: number;
  strata: Record<Stratum, number>;
  decisionRules: Record<string, string>;
};
const apiKey = process.env.TF0494_API_KEY?.trim();
if (!apiKey) throw new Error('TF0494_API_KEY is required');

type Stratum = 'recent-action-reuse' | 'duplicate-read-avoidance' | 'constraint-retention' | 'tool-selection';
type Arm = 'A' | 'B';
type ExpectedDecision = 'reuse_result' | 'call_tool' | 'answer';
type Fixture = {
  id: string;
  stratum: Stratum;
  task: string;
  baselineContext: string;
  treatmentContext: string;
  expectedDecision: ExpectedDecision;
  expectedFacts: string[];
  expectedTool: string | null;
  repeatTools: string[];
};
type ParsedOutput = { decision: ExpectedDecision; tool: string | null; answer: string };
type CallResult = {
  fixtureId: string;
  arm: Arm;
  latencyMs: number;
  responseText: string;
  parsed: ParsedOutput | null;
  parseError: string | null;
  providerError: string | null;
};
type PairResult = {
  fixtureId: string;
  stratum: Stratum;
  order: 'AB' | 'BA';
  A: CallResult;
  B: CallResult;
  A_taskPass: boolean;
  B_taskPass: boolean;
  A_repeatTool: boolean;
  B_repeatTool: boolean;
};

const strata = Object.keys(protocol.strata) as Stratum[];
const fixtures: Fixture[] = [];
for (const stratum of strata) {
  for (let index = 0; index < protocol.strata[stratum]; index += 1) {
    const id = `${stratum}-${String(index + 1).padStart(2, '0')}`;
    if (stratum === 'recent-action-reuse') {
      const token = `DEPLOY-${4940 + index}`;
      fixtures.push({
        id,
        stratum,
        task: 'A file was successfully read immediately before this request. Report the deploy token from that file. Do not call read_file again.',
        baselineContext: 'Workspace context unavailable.',
        treatmentContext: `Recent successful action: read_file("ops/runbook-${index + 1}.md") succeeded and returned: "deploy token = ${token}".\nAvailable tools: read_file, safe_lookup.`,
        expectedDecision: 'answer',
        expectedFacts: [token],
        expectedTool: null,
        repeatTools: ['read_file'],
      });
    } else if (stratum === 'duplicate-read-avoidance') {
      const filename = `src/config/service-${index + 1}.ts`;
      fixtures.push({
        id,
        stratum,
        task: `A search immediately before this request already found the file for marker MARK-${4940 + index}. Name that file. Do not repeat the search.`,
        baselineContext: 'Workspace context unavailable.',
        treatmentContext: `Recent successful action: search_files("MARK-${4940 + index}") returned exactly one path: ${filename}.\nAvailable tools: search_files, read_file.`,
        expectedDecision: 'answer',
        expectedFacts: [filename],
        expectedTool: null,
        repeatTools: ['search_files'],
      });
    } else if (stratum === 'constraint-retention') {
      const port = 6200 + index;
      fixtures.push({
        id,
        stratum,
        task: 'The previous file read established the required service port. State that port. Do not perform another read.',
        baselineContext: 'Workspace context unavailable.',
        treatmentContext: `Recent successful action: read_file("config/runtime-${index + 1}.json") succeeded and contained: "servicePort": ${port}.\nConstraint: use only this port for the next step.`,
        expectedDecision: 'answer',
        expectedFacts: [String(port)],
        expectedTool: null,
        repeatTools: ['read_file'],
      });
    } else {
      const key = `LOOKUP-${4940 + index}`;
      fixtures.push({
        id,
        stratum,
        task: `Choose the enabled tool that should retrieve key ${key}. Return the tool name and do not choose or call a disabled network tool.`,
        baselineContext: 'Workspace context unavailable; infer the enabled tool if possible.',
        treatmentContext: `Available tools: safe_lookup (enabled), network_fetch (disabled).\nUse safe_lookup to retrieve ${key}.`,
        expectedDecision: 'call_tool',
        expectedFacts: [key],
        expectedTool: 'safe_lookup',
        repeatTools: [],
      });
    }
  }
}
if (fixtures.length !== protocol.sampleSize) throw new Error(`fixture count ${fixtures.length} != protocol ${protocol.sampleSize}`);

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function responseText(payload: unknown): string {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    if (typeof record.output_text === 'string') return record.output_text;
    const output = Array.isArray(record.output) ? record.output : [];
    const parts: string[] = [];
    for (const item of output) {
      if (!item || typeof item !== 'object') continue;
      const content = (item as Record<string, unknown>).content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (!block || typeof block !== 'object') continue;
        const text = (block as Record<string, unknown>).text;
        if (typeof text === 'string') parts.push(text);
      }
    }
    return parts.join('\n');
  }
  return String(payload ?? '');
}

function parseOutput(text: string): ParsedOutput | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const decision = parsed.decision;
    if (decision !== 'reuse_result' && decision !== 'call_tool' && decision !== 'answer') return null;
    return {
      decision,
      tool: typeof parsed.tool === 'string' ? parsed.tool.trim() : null,
      answer: typeof parsed.answer === 'string' ? parsed.answer : '',
    };
  } catch {
    return null;
  }
}

function fixturePass(fixture: Fixture, parsed: ParsedOutput | null): boolean {
  if (!parsed) return false;
  if (fixture.expectedDecision === 'call_tool') {
    return parsed.decision === 'call_tool' && parsed.tool === fixture.expectedTool;
  }
  if (parsed.decision === 'call_tool') return false;
  const haystack = `${parsed.answer}\n${parsed.tool ?? ''}`.toLowerCase();
  return fixture.expectedFacts.every((fact) => haystack.includes(fact.toLowerCase()));
}

function repeatedTool(fixture: Fixture, parsed: ParsedOutput | null): boolean {
  return Boolean(parsed?.decision === 'call_tool' && parsed.tool && fixture.repeatTools.includes(parsed.tool));
}

async function callArm(fixture: Fixture, arm: Arm): Promise<CallResult> {
  const context = arm === 'A' ? fixture.baselineContext : fixture.treatmentContext;
  const prompt = [
    'You are a coding agent in a tool loop.',
    fixture.task,
    '',
    'Authoritative workspace context:',
    context,
    '',
    'Return only JSON with this exact shape:',
    '{"decision":"reuse_result|call_tool|answer","tool":string|null,"answer":string}',
    'Use reuse_result or answer when the provided context is sufficient. Call a tool only when it is necessary.',
  ].join('\n');
  const started = performance.now();
  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(protocol.endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: protocol.model,
          input: prompt,
          temperature: 0,
          max_output_tokens: 220,
        }),
      });
      const raw = await response.text();
      if (!response.ok) {
        lastError = `HTTP ${response.status}: ${raw.slice(0, 300)}`;
        continue;
      }
      const text = responseText(JSON.parse(raw));
      const parsed = parseOutput(text);
      return {
        fixtureId: fixture.id,
        arm,
        latencyMs: performance.now() - started,
        responseText: text,
        parsed,
        parseError: parsed ? null : 'json-output-invalid',
        providerError: null,
      };
    } catch (error) {
      lastError = String(error);
    }
  }
  return {
    fixtureId: fixture.id,
    arm,
    latencyMs: performance.now() - started,
    responseText: '',
    parsed: null,
    parseError: null,
    providerError: lastError || 'provider-call-failed',
  };
}
const pairs = new Array<PairResult | undefined>(fixtures.length);
let cursor = 0;
async function worker(): Promise<void> {
  while (true) {
    const index = cursor;
    cursor += 1;
    if (index >= fixtures.length) return;
    const fixture = fixtures[index]!;
    const order: 'AB' | 'BA' = index % 2 === 0 ? 'AB' : 'BA';
    const A = order === 'AB' ? await callArm(fixture, 'A') : undefined;
    const B = order === 'AB' ? await callArm(fixture, 'B') : await callArm(fixture, 'B');
    const resolvedA = A ?? await callArm(fixture, 'A');
    pairs[index] = {
      fixtureId: fixture.id,
      stratum: fixture.stratum,
      order,
      A: resolvedA,
      B,
      A_taskPass: fixturePass(fixture, resolvedA.parsed),
      B_taskPass: fixturePass(fixture, B.parsed),
      A_repeatTool: repeatedTool(fixture, resolvedA.parsed),
      B_repeatTool: repeatedTool(fixture, B.parsed),
    };
  }
}
await Promise.all(Array.from({ length: 4 }, () => worker()));
if (pairs.some((pair) => !pair)) throw new Error('missing paired result');

function quantile(values: number[], probability: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(probability * sorted.length) - 1));
  return sorted[index]!;
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;
}

let rngState = 4942026 >>> 0;
function random(): number {
  rngState ^= rngState << 13;
  rngState ^= rngState >>> 17;
  rngState ^= rngState << 5;
  rngState >>>= 0;
  return rngState / 0x1_0000_0000;
}

const completePairs = pairs as PairResult[];
const repeatDeltas: number[] = [];
const taskDeltas: number[] = [];
const latencyRatios: number[] = [];
for (let resample = 0; resample < 10_000; resample += 1) {
  const sample = Array.from({ length: completePairs.length }, () => completePairs[Math.floor(random() * completePairs.length)]!);
  const aRepeat = mean(sample.map((pair) => (pair.A_repeatTool ? 1 : 0)));
  const bRepeat = mean(sample.map((pair) => (pair.B_repeatTool ? 1 : 0)));
  const aTask = mean(sample.map((pair) => (pair.A_taskPass ? 1 : 0)));
  const bTask = mean(sample.map((pair) => (pair.B_taskPass ? 1 : 0)));
  const aP95 = quantile(sample.map((pair) => pair.A.latencyMs), 0.95);
  const bP95 = quantile(sample.map((pair) => pair.B.latencyMs), 0.95);
  repeatDeltas.push(aRepeat - bRepeat);
  taskDeltas.push(bTask - aTask);
  latencyRatios.push(aP95 > 0 ? bP95 / aP95 : Number.POSITIVE_INFINITY);
}
repeatDeltas.sort((left, right) => left - right);
taskDeltas.sort((left, right) => left - right);
latencyRatios.sort((left, right) => left - right);
const ci = (values: number[]) => ({
  lower: quantile(values, 0.025),
  upper: quantile(values, 0.975),
});

const aRepeatRate = mean(completePairs.map((pair) => (pair.A_repeatTool ? 1 : 0)));
const bRepeatRate = mean(completePairs.map((pair) => (pair.B_repeatTool ? 1 : 0)));
const aTaskRate = mean(completePairs.map((pair) => (pair.A_taskPass ? 1 : 0)));
const bTaskRate = mean(completePairs.map((pair) => (pair.B_taskPass ? 1 : 0)));
const aP95Latency = quantile(completePairs.map((pair) => pair.A.latencyMs), 0.95);
const bP95Latency = quantile(completePairs.map((pair) => pair.B.latencyMs), 0.95);
const allCalls = completePairs.flatMap((pair) => [pair.A, pair.B]);
const parseFailures = allCalls.filter((call) => call.parseError).length;
const providerErrors = allCalls.filter((call) => call.providerError).length;
const strataComplete = Object.fromEntries(
  strata.map((stratum) => [stratum, completePairs.filter((pair) => pair.stratum === stratum).length]),
);
const nonInferiorMargin = -0.05;
const latencyMargin = 1.1;
const repeatCi = ci(repeatDeltas);
const taskCi = ci(taskDeltas);
const latencyCi = ci(latencyRatios);
const checks = {
  completePairs: completePairs.length === protocol.sampleSize,
  completeStrata: Object.values(strataComplete).every((count) => count >= 8),
  providerErrorRate: providerErrors / allCalls.length < 0.05,
  parseFailureRate: parseFailures / allCalls.length <= 0.10,
  repeatCallReduction: aRepeatRate - bRepeatRate > 0 && repeatCi.lower > 0,
  taskNonInferiority: taskCi.lower >= nonInferiorMargin,
  p95LatencyGuard: latencyCi.upper <= latencyMargin,
};
const pass = Object.values(checks).every(Boolean);
const run = {
  schemaVersion: 'WorkspaceContextCanaryRun/v1',
  taskForestNodeId: protocol.taskForestNodeId,
  startedAt: new Date(Date.now() - allCalls.reduce((total, call) => total + call.latencyMs, 0)).toISOString(),
  endedAt: new Date().toISOString(),
  driven_by: 'agent',
  actor: 'codex',
  endpoint: protocol.endpoint,
  model: protocol.model,
  protocolPath,
  protocolSha256: sha256(protocolText),
  design: {
    sampleSize: protocol.sampleSize,
    completedPairs: completePairs.length,
    strataComplete,
    ciMethod: 'paired bootstrap 10000 resamples percentile 95%; seed 4942026',
    stoppingRule: 'fixed n; no early stopping',
  },
  thresholds: {
    repeatCallReductionCiLower: 0,
    taskPassNonInferiorityCiLower: nonInferiorMargin,
    p95LatencyRatioCiUpper: latencyMargin,
    providerErrorRate: 0.05,
    parseFailureRate: 0.10,
    completePairs: protocol.sampleSize,
    completePairsPerStratum: 8,
  },
  summary: {
    A_repeatToolCallRate: aRepeatRate,
    B_repeatToolCallRate: bRepeatRate,
    repeatToolCallReduction: aRepeatRate - bRepeatRate,
    repeatToolCallReductionCi95: repeatCi,
    A_taskPassRate: aTaskRate,
    B_taskPassRate: bTaskRate,
    taskPassDelta: bTaskRate - aTaskRate,
    taskPassDeltaCi95: taskCi,
    A_p95LatencyMs: aP95Latency,
    B_p95LatencyMs: bP95Latency,
    p95LatencyRatio: aP95Latency > 0 ? bP95Latency / aP95Latency : null,
    p95LatencyRatioCi95: latencyCi,
    parseFailures,
    providerErrors,
    totalCalls: allCalls.length,
  },
  checks,
  decision: {
    status: pass ? 'pass' : 'fail',
    reasons: Object.entries(checks)
      .filter(([, ok]) => !ok)
      .map(([name]) => name),
  },
  pairs: completePairs,
};
fs.writeFileSync(path.join(root, outputDir, 'canary-run.json'), `${JSON.stringify(run, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  ok: pass,
  decision: run.decision,
  summary: run.summary,
  checks,
  output: `${outputDir}/canary-run.json`,
}, null, 2));
if (!pass) process.exitCode = 1;