#!/usr/bin/env node
/**
 * Context Inline/Spill paired eval.
 *
 * Arms:
 * - baseline: model-visible text only says content was truncated.
 * - reference-visible: model-visible text includes a verified ArchiveHandle and
 *   context_archive_recall instructions.
 *
 * The deterministic arm uses a local oracle. The live-provider arm uses an
 * explicit OpenAI-compatible /v1/responses endpoint from env; no credential is
 * written into the report.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT = argValue('--out') || join(process.env.TEMP || tmpdir(), 'context-inline-spill-eval');
const MODE = argValue('--mode') || 'deterministic';
const BASE_URL = process.env.CONTEXT_INLINE_SPILL_BASE_URL;
const API_KEY = process.env.CONTEXT_INLINE_SPILL_API_KEY;
const MODEL = process.env.CONTEXT_INLINE_SPILL_MODEL;
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
  return path;
}

async function loadTs(path) {
  return import(pathToFileURL(join(ROOT, path)).href);
}

function estimateTokens(text) {
  return Math.max(1, Math.ceil(String(text).length / 4));
}

function makePayload() {
  const needle = 'ARCHIVE_RECOVERY_NEEDLE_7f31';
  const head = 'archive-eval-head';
  const middle = Array.from({ length: 900 }, (_, i) => `noise-${i}:${'x'.repeat(12)}`).join('\n');
  const tail = `tail-marker ${needle}`;
  return { needle, raw: `${head}\n${middle}\n${tail}` };
}

async function createReference(archiveRoot, sessionId) {
  const { createContextArchiveHandleForPayloadSync, verifyContextArchiveHandle } = await loadTs(
    'openclaw_runtime/src/context-engine/registry/context-item-registry.ts',
  );
  const { raw } = makePayload();
  const handle = createContextArchiveHandleForPayloadSync({
    sessionId,
    itemId: 'context-inline-spill-eval-observation',
    payload: raw,
    archiveRoot,
    source: { type: 'tool_call', sessionId, label: 'eval-tool-output' },
  });
  const verified = await verifyContextArchiveHandle(handle);
  if (!verified.ok) throw new Error(`archive verification failed: ${verified.reason}`);
  return { handle, raw, verified };
}

async function buildVisibleText(style, handle) {
  const mod = await loadTs('openclaw_runtime/src/agents/embedded-agent-runner/tool-result-truncation.ts');
  if (style === 'baseline') {
    return `[... ${makePayload().raw.length} more characters truncated; rerun with narrower args if needed]`;
  }
  return mod.buildArchiveRecallTruncationSuffix({
    truncatedChars: makePayload().raw.length,
    archiveHandle: handle,
  });
}

async function recall(handle) {
  const { createContextArchiveRecallTool } = await loadTs(
    'openclaw_runtime/src/agents/tools/context-agent-tools.ts',
  );
  const tool = createContextArchiveRecallTool({ sessionId: 'session-inline-spill-eval' });
  if (!tool) throw new Error('context_archive_recall tool unavailable');
  const result = await tool.execute('eval-recall', {
    archive_uri: handle.uri,
    checksum: handle.checksum,
    byte_length: handle.byteLength,
    offset: 0,
    max_chars: 12000,
  });
  const text = result.content?.find((part) => part.type === 'text')?.text;
  const first = text ? JSON.parse(text) : undefined;
  if (!first?.ok || first.truncated !== true) return first;
  const secondText = (await tool.execute('eval-recall-tail', { archive_uri: handle.uri, checksum: handle.checksum, byte_length: handle.byteLength, offset: Math.max(0, Number(first.char_count) - 2048), max_chars: 2048 })).content?.find((part) => part.type === 'text')?.text;
  return { ...first, tail_content: secondText ? JSON.parse(secondText).content : undefined };
}

function deterministicJudge(style, visibleText, recallResult, needle) {
  const hasReference = visibleText.includes('archive_uri') && visibleText.includes('checksum');
  const hasNeedle = (typeof recallResult?.content === 'string' && recallResult.content.includes(needle)) || (typeof recallResult?.tail_content === 'string' && recallResult.tail_content.includes(needle));
  const passed = style === 'reference-visible' ? hasReference && hasNeedle : !hasReference && recallResult?.status === 'not-invoked';
  return {
    passed,
    hasReference,
    hasNeedle,
    reason: passed ? 'expected-arm-behavior' : 'unexpected-arm-behavior',
  };
}

async function liveJudge(style, visibleText, recallResult, needle) {
  if (!BASE_URL || !API_KEY || !MODEL) {
    return { status: 'not-run', reason: 'missing CONTEXT_INLINE_SPILL_BASE_URL/API_KEY/MODEL' };
  }
  const evidence = recallResult?.ok ? String(recallResult.content ?? '') : '';
  const prompt = [
    'You are evaluating one context-projection arm.',
    'A tool result was truncated; decide whether the original value can be recovered from the supplied context.',
    'Answer with JSON only. Do not spend output on reasoning: {"can_recover":true|false,"needle":string|null,"reason":string}.',
    `Visible context:\n${visibleText}`,
    `Recall evidence available to the arm:\n${evidence || '(none)'}`,
    `Required needle: ${needle}`,
  ].join('\n\n');
  const started = Date.now();
  const response = await fetch(`${BASE_URL.replace(/\/$/, '')}/responses`, {
    method: 'POST',
    headers: { authorization: `Bearer ${API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, input: prompt, max_output_tokens: 400, temperature: 0 }),
  });
  const raw = await response.text();
  const elapsedMs = Date.now() - started;
  if (!response.ok) return { status: 'failed', httpStatus: response.status, elapsedMs, error: raw.slice(0, 400) };
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { status: 'failed', error: 'response_json_invalid', elapsedMs }; }
  const text = parsed.output_text ?? parsed.output?.flatMap((item) => item.content ?? []).map((c) => c.text ?? '').join('') ?? '';
  let answer;
  try {
    const brace = text.indexOf('{');
    const end = text.lastIndexOf('}');
    answer = JSON.parse(brace >= 0 && end > brace ? text.slice(brace, end + 1) : text);
  } catch { answer = { raw: text, parseStatus: 'invalid-json' }; }
  const canRecover = answer?.can_recover === true && answer?.needle === needle;
  const parseFailed = Boolean(answer?.parseStatus);
  return { status: parseFailed ? 'failed' : 'executed', httpStatus: response.status, elapsedMs, answer, usage: parsed.usage ?? null, canRecover };
}

const runDir = ensureDir(join(OUT, RUN_ID));
const archiveRoot = ensureDir(join(runDir, 'archives'));
const { handle, raw, verified } = await createReference(archiveRoot, 'session-inline-spill-eval');
const payloadInfo = makePayload();
const baselineText = await buildVisibleText('baseline', handle);
const referenceText = await buildVisibleText('reference-visible', handle);
const baselineRecall = { status: 'not-invoked', reason: 'baseline has no archive pointer' };
const referenceRecall = await recall(handle);
const results = {
  schema: 'ContextInlineSpillEval/v1',
  runId: RUN_ID,
  mode: MODE,
  driven_by: 'agent',
  actor: 'codex-context-inline-spill',
  provider: {
    kind: BASE_URL ? 'openai-compatible-responses' : 'not-run',
    model: MODEL ?? null,
    baseUrl: BASE_URL ? new URL(BASE_URL).origin : null,
    credentialPersisted: false,
  },
  fixture: {
    payloadSha256: sha256(raw),
    payloadChars: raw.length,
    archiveVerified: verified.ok === true,
    archiveUri: handle.uri,
    archiveChecksum: handle.checksum,
    archiveByteLength: handle.byteLength,
  },
  arms: [
    { name: 'baseline', visibleText: baselineText, visibleChars: baselineText.length, visibleTokens: estimateTokens(baselineText), recall: baselineRecall, deterministic: deterministicJudge('baseline', baselineText, baselineRecall, payloadInfo.needle) },
    { name: 'reference-visible', visibleText: referenceText, visibleChars: referenceText.length, visibleTokens: estimateTokens(referenceText), recall: referenceRecall, deterministic: deterministicJudge('reference-visible', referenceText, referenceRecall, payloadInfo.needle) },
  ],
};
if (MODE === 'live') {
  for (const arm of results.arms) {
    arm.live = await liveJudge(arm.name, arm.visibleText, arm.recall, payloadInfo.needle);
    arm.live.expectedCanRecover = arm.name === 'reference-visible';
  }
}
results.decision = {
  deterministicPass: results.arms.every((arm) => arm.deterministic.passed),
  liveStatus: results.arms.some((arm) => arm.live?.status === 'executed') ? 'executed' : 'not-run',
  releaseApproved: false,
  liveReady: false,
};
writeFileSync(join(runDir, 'result.json'), JSON.stringify(results, null, 2) + '\n');
writeFileSync(join(runDir, 'summary.md'), `# Context Inline/Spill Eval\n\n- run: ${RUN_ID}\n- mode: ${MODE}\n- deterministicPass: ${results.decision.deterministicPass}\n- liveStatus: ${results.decision.liveStatus}\n- model: ${MODEL ?? 'not-run'}\n- archiveVerified: ${verified.ok}\n- baseline visible chars: ${baselineText.length}\n- reference-visible chars: ${referenceText.length}\n- note: live-provider evidence is separate from deterministic evidence; no release approval.\n`);
console.log(JSON.stringify({ runDir, decision: results.decision, fixture: results.fixture, arms: results.arms.map((a) => ({ name: a.name, visibleChars: a.visibleChars, deterministic: a.deterministic, liveStatus: a.live?.status ?? 'not-run' })) }, null, 2));
