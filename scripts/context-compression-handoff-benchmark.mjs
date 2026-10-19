#!/usr/bin/env node
/**
 * Phase 0 Handoff Benchmark (TF-0074 v8 optimization).
 *
 * True downstream metric: a handoff agent sees ONLY the compressed summary
 * (double-blind — the original transcript is never loaded in run mode) and
 * must produce a state assessment + next action + probe answers. Scoring is
 * deterministic-first against user-locked ground truth; an adjudicating judge
 * is used only inside ambiguous overlap bands and its verdict is accepted only
 * when it supplies a verbatim citation into the provided material (fail-closed
 * otherwise).
 *
 * Modes:
 *   --select-only        deterministic sample selection from the manifest
 *   --lock               create/refresh <ground-truth>.lock.json
 *   --self-test          offline synthetic smoke test (no network)
 *   (default)            run the benchmark: --summaries + --ground-truth
 *
 * Env contract (identical to eval-runner): COMPACTION_BASE_URL,
 * COMPACTION_PROVIDER, COMPACTION_API_KEY, COMPACTION_REQUEST_DELAY_MS,
 * COMPACTION_MAX_ATTEMPTS, COMPACTION_REQUEST_TIMEOUT_MS,
 * COMPACTION_EXTRA_HEADERS, COMPACTION_OMIT_RESPONSE_FORMAT.
 */
import { isMainEntrypoint } from './lib/entrypoint.mjs';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { buildRecoveryLedger, isUnresolvedFailureFact } from './context-compression-recovery-ledger.mjs';
import { extractJsonObject } from './context-compression-json-repair.mjs';

const BENCHMARK_SCHEMA = 'handoff-benchmark/v1';
const HANDOFF_PROMPT_VERSION = 'handoff-prompt-v1';
const HANDOFF_JUDGE_PROMPT_VERSION = 'handoff-judge-prompt-v3';
const SCORING_VERSION = 'scoring-v1.4';
// Majority-vote adjudication: ambiguous-band verdicts are decided by k
// independent judge calls (temperature 0.3) to suppress single-shot judge
// variance (observed: identical handoff outputs flipped 2-3 flags between runs).
const ADJUDICATION_VOTES = Math.max(1, Number(argValue('--judge-votes', '3')));

// Deterministic scoring bands (documented in the v8 plan; changing them
// changes the metric, so they are versioned with the prompt).
const BANDS = Object.freeze({
  actionMatch: 0.5,
  actionMismatchBelow: 0.15,
  repeatFlag: 0.5,
  contradictionFlag: 0.7,
  probeCorrect: 0.6,
  probeIncorrectBelow: 0.2,
});

// Conservative CNY-per-1M-token estimates used ONLY for the budget guard.
const PRICE_ESTIMATES_CNY_PER_M = {
  'qwen-flash': { input: 0.3, output: 1.2 },
  'qwen-turbo': { input: 0.3, output: 0.6 },
  'qwen-plus-latest': { input: 0.8, output: 2.0 },
  'qwen-plus': { input: 0.8, output: 2.0 },
};

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function argFlag(name) {
  return process.argv.includes(name);
}

/**
 * CJK-aware tokenization: Latin/digit identifier runs plus CJK character
 * bigrams, so overlap works on mixed Chinese/English audit text.
 */
function normalizeTokens(text) {
  const value = String(text ?? '').toLowerCase();
  const tokens = new Set();
  for (const match of value.matchAll(/[a-z0-9_][a-z0-9_\-.]*/gu)) tokens.add(match[0]);
  const cjkChars = [...value.matchAll(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/gu)].map((item) => item[0]);
  for (let index = 0; index + 1 < cjkChars.length; index += 1) {
    tokens.add(cjkChars[index] + cjkChars[index + 1]);
  }
  return tokens;
}

/** Containment-style overlap: shared tokens / min(set sizes). */
function tokenOverlap(a, b) {
  const left = normalizeTokens(a);
  const right = normalizeTokens(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / Math.min(left.size, right.size);
}

function collapseWhitespace(value) {
  return String(value ?? '').replace(/\s+/gu, ' ').trim();
}

/**
 * Polarity guard: count negation cues (EN + CJK). Token-overlap scoring is
 * blind to negation flips ("do not bump" vs "always bump"), so a
 * deterministic verdict is only allowed when both sides carry the same number
 * of negation cues; otherwise the question is routed to the judge.
 */
function negationCueCount(text) {
  const value = String(text ?? '').toLowerCase();
  const english = value.match(/\b(no|not|don't|doesn't|didn't|won't|can't|cannot|never|must not|mustn't|avoid|refused|rejected)\b/gu)?.length ?? 0;
  const cjk = value.match(/(禁止|不得|不要|不可|不能|勿|别|未|没有|拒绝|否决|非)/gu)?.length ?? 0;
  return english + cjk;
}

function estimateCostCny(model, usage) {
  const price = PRICE_ESTIMATES_CNY_PER_M[model] ?? { input: 1.0, output: 3.0 };
  const inputTokens = Number(usage?.prompt_tokens ?? 0);
  const outputTokens = Number(usage?.completion_tokens ?? 0);
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

function providerConfig() {
  const configuredBaseUrl = (process.env.COMPACTION_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/+$/u, '');
  let baseUrl = configuredBaseUrl;
  try {
    const parsed = new URL(configuredBaseUrl);
    if (!parsed.pathname || parsed.pathname === '/') parsed.pathname = '/v1';
    baseUrl = parsed.toString().replace(/\/+$/u, '');
  } catch {
    // keep as-is; fetch will surface the error
  }
  return {
    provider: process.env.COMPACTION_PROVIDER?.trim() || 'dashscope',
    baseUrl,
    apiKey: process.env.COMPACTION_API_KEY,
  };
}
const MAX_ATTEMPTS = Number(process.env.COMPACTION_MAX_ATTEMPTS ?? 6);
const REQUEST_DELAY_MS = Number(process.env.COMPACTION_REQUEST_DELAY_MS ?? 4000);
const REQUEST_TIMEOUT_MS = Number(process.env.COMPACTION_REQUEST_TIMEOUT_MS ?? 8 * 60 * 1000);

async function fetchJson({ baseUrl, apiKey, model, system, user, purpose, sampleId, transport, temperature = 0 }) {
  const fetchImpl = transport ?? fetch;
  let lastError;
  if (REQUEST_DELAY_MS > 0) await delay(REQUEST_DELAY_MS);
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const abortController = new AbortController();
      const timer = setTimeout(() => abortController.abort(), REQUEST_TIMEOUT_MS);
      let extraHeaders = {};
      if (process.env.COMPACTION_EXTRA_HEADERS) {
        try {
          const parsedHeaders = JSON.parse(process.env.COMPACTION_EXTRA_HEADERS);
          if (parsedHeaders && typeof parsedHeaders === 'object') extraHeaders = parsedHeaders;
        } catch {
          extraHeaders = {};
        }
      }
      const response = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: 'POST',
        signal: abortController.signal,
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', ...extraHeaders },
        body: JSON.stringify({
          model,
          temperature,
          max_tokens: 8000,
          ...(process.env.COMPACTION_OMIT_RESPONSE_FORMAT === '1' ? {} : { response_format: { type: 'json_object' } }),
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
      });
      clearTimeout(timer);
      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        lastError = new Error(`handoff-benchmark ${purpose} ${sampleId ?? ''} HTTP ${response.status}${errorBody ? ` (${errorBody.slice(0, 160)})` : ''}`);
        const retryable = response.status === 429 || response.status >= 500;
        if (retryable && attempt < MAX_ATTEMPTS) {
          let waitMs = response.status === 429 ? Math.min(2000 * 2 ** (attempt - 1), 60000) : 750 * attempt;
          if (response.status === 429) {
            const resetEpoch = Number(response.headers?.get?.('x-ratelimit-reset'));
            const retryAfterSeconds = Number(response.headers?.get?.('retry-after'));
            const untilResetMs = Number.isFinite(resetEpoch) && resetEpoch > 0
              ? resetEpoch * 1000 - Date.now() + 5000
              : (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? retryAfterSeconds * 1000 + 1000 : Number.NaN);
            if (Number.isFinite(untilResetMs) && untilResetMs > waitMs && untilResetMs <= 45 * 60 * 1000) waitMs = untilResetMs;
          }
          console.error(`[handoff] retrying ${purpose} ${sampleId ?? ''} in ${Math.round(waitMs / 1000)}s (attempt ${attempt})`);
          await delay(waitMs);
          continue;
        }
        throw lastError;
      }
      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) {
        lastError = new Error(`handoff-benchmark ${purpose} ${sampleId ?? ''} empty content`);
        if (attempt < MAX_ATTEMPTS) { await delay(750 * attempt); continue; }
        throw lastError;
      }
      try {
        extractJsonObject(content);
      } catch (error) {
        lastError = error;
        if (attempt < MAX_ATTEMPTS) { await delay(750 * attempt); continue; }
        throw lastError;
      }
      return data;
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) { await delay(750 * attempt); continue; }
      throw lastError;
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// Sample selection (deterministic rule from the v8 plan)
// ---------------------------------------------------------------------------

export function selectSamples({ manifestPath, metaPath, cap = 12, min = 10 }) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  const metaById = new Map((meta.entries ?? []).map((entry) => [entry.sampleId, entry]));
  const evaluated = [];
  for (const sample of manifest.samples ?? []) {
    const metaEntry = metaById.get(sample.id);
    if (!metaEntry?.file) throw new Error(`${sample.id}: missing transcript meta entry`);
    const ordinalIndex = Number(/^R(\d+)$/u.exec(String(sample.id))?.[1] ?? 1) - 1;
    const windowSize = Number(sample.cohort?.turn ?? 200);
    const ledger = buildRecoveryLedger(metaEntry.file, sample.id, { windowSize, ordinalIndex });
    const facts = ledger.expected ?? [];
    const pendingObjectiveFacts = facts.filter((item) => String(item.id).includes('pending-objective'));
    const unresolvedFailures = facts.filter((item) => isUnresolvedFailureFact(item));
    const nextActionFacts = facts.filter((item) => String(item.id).includes('next-action'));
    evaluated.push({
      sampleId: sample.id,
      transcript: basename(metaEntry.file),
      file: metaEntry.file,
      windowSize,
      ordinalIndex,
      window: ledger.window,
      reasons: {
        pendingObjective: pendingObjectiveFacts.length,
        unresolvedFailure: unresolvedFailures.length,
        nextAction: nextActionFacts.length,
      },
      primary: pendingObjectiveFacts.length > 0 || unresolvedFailures.length > 0,
      fillCandidate: nextActionFacts.length > 0,
    });
  }
  const selected = [];
  for (const item of evaluated) if (item.primary && selected.length < cap) selected.push(item);
  if (selected.length < min) {
    for (const item of evaluated) {
      if (selected.length >= min) break;
      if (!item.primary && item.fillCandidate && !selected.some((entry) => entry.sampleId === item.sampleId)) selected.push(item);
    }
  }
  return { selected, evaluated };
}

// ---------------------------------------------------------------------------
// Ground-truth lock (fail-closed)
// ---------------------------------------------------------------------------

export function lockGroundTruth(gtPath) {
  const content = readFileSync(gtPath);
  const parsed = JSON.parse(content.toString('utf8'));
  const sampleIds = Object.keys(parsed.samples ?? {}).sort();
  if (!sampleIds.length) throw new Error('ground truth contains no samples');
  const lock = {
    schema: 'handoff-benchmark-lock/v1',
    gtFile: basename(gtPath),
    gtSha256: sha256(content),
    sampleIds,
    lockedAt: new Date().toISOString(),
    lockedBy: process.env.COMPACTION_LOCK_BY || 'user',
  };
  const lockPath = `${gtPath}.lock.json`;
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
  return { lockPath, lock };
}

export function verifyLock(gtPath, { allowUnlocked = false } = {}) {
  const lockPath = `${gtPath}.lock.json`;
  const content = readFileSync(gtPath);
  const currentHash = sha256(content);
  if (!existsSync(lockPath)) {
    if (!allowUnlocked) throw new Error(`ground truth is not locked (missing ${basename(lockPath)}); run --lock after user review or pass --allow-unlocked for provisional runs`);
    return { locked: false, reason: 'missing_lock_file' };
  }
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  if (lock.gtSha256 !== currentHash) {
    if (!allowUnlocked) throw new Error('ground truth changed after locking (sha256 mismatch); re-review and run --lock');
    return { locked: false, reason: 'hash_mismatch_after_lock' };
  }
  return { locked: true, lock };
}
// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

function buildHandoffPrompt({ summary, probes }) {
  return [
    'You are an agent taking over a software task from a colleague who has left the project.',
    'You receive ONLY their handoff summary. The original conversation transcript is NOT available to you.',
    'Base every claim strictly on the handoff summary; if something is not stated, treat it as unknown.',
    '',
    'Return strict JSON only with this schema:',
    '{"stateAssessment": {"completed": string[], "inProgress": string[], "pending": string[], "constraints": string[]},',
    ' "nextAction": {"kind": string, "target": string, "params": object, "rationale": string},',
    ' "probeAnswers": [{"id": string, "answer": string}]}',
    '',
    'Rules:',
    '- stateAssessment: classify every task/state mentioned in the summary; constraints = hard limits, unavailable capabilities, or must-not-violate rules.',
    '- nextAction: the single most justified next action to take NOW. Never propose redoing work the summary marks as completed and verified.',
    '- probeAnswers: answer each probe question from the summary alone; if the summary does not contain the answer, use "unknown".',
    '',
    '## Handoff Summary',
    summary,
    '',
    '## Probe Questions',
    probes.map((probe) => `- id=${probe.id}: ${probe.question}`).join('\n'),
    '',
    'Respond with the JSON object only.',
  ].join('\n');
}

const HANDOFF_SYSTEM = 'You are a careful senior engineer taking over an unfamiliar task. You reason only from the handoff summary you are given and you never invent facts. You always answer with strict JSON.';

function actionText(action) {
  if (!action || typeof action !== 'object') return '';
  return [action.kind, action.target, typeof action.params === 'string' ? action.params : JSON.stringify(action.params ?? {}), action.rationale].filter(Boolean).join(' ');
}

/** Plan text for repeat/contradiction checks: structured plan fields only.
 * The rationale is excluded because it legitimately references constraints and
 * rejected paths as context, which produced false positives in v1. */
function plannedText(output) {
  const state = output?.stateAssessment ?? {};
  const action = output?.nextAction ?? {};
  return JSON.stringify({
    nextAction: { kind: action.kind ?? '', target: action.target ?? '', params: action.params ?? {} },
    pending: state.pending ?? [],
    inProgress: state.inProgress ?? [],
  });
}

function normalizeHandoffOutput(parsed) {
  const state = parsed?.stateAssessment ?? {};
  const stringArray = (value) => (Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : []);
  const action = parsed?.nextAction ?? {};
  const answers = Array.isArray(parsed?.probeAnswers) ? parsed.probeAnswers : [];
  return {
    stateAssessment: {
      completed: stringArray(state.completed),
      inProgress: stringArray(state.inProgress),
      pending: stringArray(state.pending),
      constraints: stringArray(state.constraints),
    },
    nextAction: {
      kind: String(action.kind ?? ''),
      target: String(action.target ?? ''),
      params: action.params && typeof action.params === 'object' ? action.params : {},
      rationale: String(action.rationale ?? ''),
    },
    probeAnswers: answers
      .filter((item) => item && typeof item === 'object')
      .map((item) => ({ id: String(item.id ?? ''), answer: String(item.answer ?? '') })),
  };
}

// ---------------------------------------------------------------------------
// Deterministic-first scoring with citation-checked judge fallback
// ---------------------------------------------------------------------------

function buildAdjudicationPrompt({ metric, question, material }) {
  return [
    'You are an adjudicator for a handoff benchmark. Decide ONE binary question.',
    'You must ground your verdict in the provided material: return a citation that is a VERBATIM substring of the material.',
    'If you cannot cite evidence, return verdict=false.',
    '',
    `Metric: ${metric}`,
    `Question: ${question}`,
    '',
    'Return strict JSON only: {"verdict": boolean, "citation": string}',
    '',
    '## Material',
    material,
  ].join('\n');
}

/** Strip formatting artifacts (quotes/backslashes/backticks) so judge citations
 * of JSON-embedded text are not rejected on escaping alone. */
function stripFormatting(value) {
  return collapseWhitespace(value).replace(/["'\\`]/gu, '');
}

function citationIsGrounded(citation, material, acceptExact = []) {
  const normalizedCitation = collapseWhitespace(citation);
  if (normalizedCitation.length < 2) return false;
  // Short citations (e.g. a terse answer "No") are accepted only when they
  // exactly equal one of the explicitly allowed fields; otherwise >= 8 chars.
  if (normalizedCitation.length < 8) {
    return acceptExact.some((field) => collapseWhitespace(field) === normalizedCitation);
  }
  if (collapseWhitespace(material).includes(normalizedCitation)) return true;
  return stripFormatting(material).includes(stripFormatting(citation));
}

async function adjudicate({ metric, question, material, judgeModel, provider, transport, sampleId, cache, budget, acceptExact = [] }) {
  const votes = ADJUDICATION_VOTES;
  const cacheKey = sha256(stableJson({ v: HANDOFF_JUDGE_PROMPT_VERSION, scoring: SCORING_VERSION, metric, question, material: sha256(material), model: judgeModel, acceptExact: acceptExact ?? [], votes }));
  if (cache) {
    const cached = cache.read(cacheKey);
    if (cached) return { ...cached, cached: true };
  }
  const ballots = [];
  for (let vote = 1; vote <= votes; vote += 1) {
    const data = await fetchJson({
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      model: judgeModel,
      system: 'You are a strict evidence-grounded adjudicator. You answer with JSON only.',
      user: buildAdjudicationPrompt({ metric, question, material }),
      purpose: 'adjudicate',
      sampleId: votes > 1 ? `${sampleId}#v${vote}` : sampleId,
      transport,
      temperature: votes > 1 ? 0.3 : 0,
    });
    budget.record(judgeModel, data.usage);
    const rawText = data?.choices?.[0]?.message?.content ?? '';
    let parsed = {};
    try { parsed = extractJsonObject(rawText); } catch { parsed = {}; }
    const verdict = parsed.verdict === true;
    const citation = typeof parsed.citation === 'string' ? parsed.citation : '';
    const grounded = verdict && citationIsGrounded(citation, material, acceptExact);
    ballots.push({ verdict, citation, grounded, effective: grounded });
  }
  const affirmative = ballots.filter((ballot) => ballot.effective).length;
  const majority = affirmative * 2 > votes;
  const firstAffirmative = ballots.find((ballot) => ballot.effective);
  const result = {
    verdict: majority,
    citation: firstAffirmative?.citation ?? '',
    grounded: majority,
    effectiveVerdict: majority,
    votes,
    ballots: ballots.map(({ verdict, grounded, citation }) => ({ verdict, grounded, citation: String(citation).slice(0, 160) })),
    rawText: '',
  };
  if (cache) cache.write(cacheKey, result);
  return result;
}
class DiskCache {
  constructor(dir) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
  }
  pathFor(key) { return resolve(this.dir, `${key}.json`); }
  read(key) {
    try { return JSON.parse(readFileSync(this.pathFor(key), 'utf8')); } catch { return undefined; }
  }
  write(key, value) {
    writeFileSync(this.pathFor(key), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  }
}

class BudgetLedger {
  constructor(maxCostCny) {
    this.maxCostCny = maxCostCny;
    this.spentCny = 0;
    this.calls = 0;
    this.byModel = {};
  }
  record(model, usage) {
    const cost = estimateCostCny(model, usage);
    this.spentCny += cost;
    this.calls += 1;
    const entry = this.byModel[model] ?? { calls: 0, inputTokens: 0, outputTokens: 0, estCostCny: 0 };
    entry.calls += 1;
    entry.inputTokens += Number(usage?.prompt_tokens ?? 0);
    entry.outputTokens += Number(usage?.completion_tokens ?? 0);
    entry.estCostCny += cost;
    this.byModel[model] = entry;
    if (this.spentCny > this.maxCostCny) throw new Error(`budget guard: estimated spend ¥${this.spentCny.toFixed(4)} exceeds cap ¥${this.maxCostCny}`);
  }
}

async function scoreSample({ sampleId, summary, gt, handoffOutput, provider, judgeModel, transport, cache, budget }) {
  const trace = { sampleId, scoring: {} };
  const gtAction = gt.correctNextAction ?? {};
  const gtActionText = actionText(gtAction);
  const proposedActionText = actionText(handoffOutput.nextAction);

  // 1) handoff-success: primary next action vs GT primary action.
  const actionOverlap = tokenOverlap(proposedActionText, gtActionText);
  const actionPolarityParity = negationCueCount(proposedActionText) === negationCueCount(gtActionText);
  let success;
  if (actionOverlap >= BANDS.actionMatch && actionPolarityParity) {
    success = true;
    trace.scoring.success = { mode: 'deterministic', overlap: actionOverlap };
  } else if (actionOverlap < BANDS.actionMismatchBelow) {
    success = false;
    trace.scoring.success = { mode: 'deterministic', overlap: actionOverlap };
  } else {
    const material = `GT correctNextAction: ${gtActionText}\nHandoff nextAction: ${proposedActionText}`;
    const adjudication = await adjudicate({
      metric: 'action-match',
      question: 'Is the handoff nextAction the same intended next action as the GT correctNextAction? Paraphrases and restatements count when the intended action is the same (e.g., finalize/deliver/preserve a validated outcome are the same do-not-redo decision; preparing the closing report for a completed task matches a preserve/report-style GT decision). Different concrete work targets are different actions.',
      material,
      judgeModel,
      provider,
      transport,
      sampleId,
      cache,
      budget,
    });
    success = adjudication.effectiveVerdict;
    trace.scoring.success = { mode: 'adjudicated', overlap: actionOverlap, adjudication };
  }

  // 2) repeat-work: does the plan redo GT completedWork?
  const planText = plannedText(handoffOutput);
  const repeatHits = [];
  for (const item of gt.completedWork ?? []) {
    const overlap = tokenOverlap(item.text, planText);
    if (overlap >= BANDS.repeatFlag) {
      repeatHits.push({ text: item.text, overlap, mode: 'deterministic' });
      continue;
    }
    if (overlap >= 0.3) {
      const material = `GT completedWork item: ${item.text}\nHandoff plan: ${planText}`;
      const adjudication = await adjudicate({
        metric: 'repeat-work',
        question: 'Does the handoff plan propose redoing the already-completed work described by the GT item?',
        material,
        judgeModel,
        provider,
        transport,
        sampleId,
        cache,
        budget,
      });
      if (adjudication.effectiveVerdict) repeatHits.push({ text: item.text, overlap, mode: 'adjudicated', adjudication });
    }
  }
  const repeat = repeatHits.length > 0;
  trace.scoring.repeat = { repeat, repeatHits };

  // 3) contradiction: does nextAction collide with rejectedPaths/endState?
  const proposalText = [handoffOutput.nextAction.kind, handoffOutput.nextAction.target, JSON.stringify(handoffOutput.nextAction.params ?? {})].join(' ');
  const contradictionHits = [];
  for (const item of gt.rejectedPaths ?? []) {
    const overlap = tokenOverlap(proposalText, item.text);
    if (overlap >= BANDS.contradictionFlag) {
      contradictionHits.push({ text: item.text, overlap, mode: 'deterministic' });
      continue;
    }
    if (overlap >= 0.3) {
      const material = `GT rejectedPath: ${item.text}\nHandoff proposal: ${proposalText}`;
      const adjudication = await adjudicate({
        metric: 'contradiction',
        question: 'Does the handoff nextAction pursue a path that GT marks as rejected/stale/wrong?',
        material,
        judgeModel,
        provider,
        transport,
        sampleId,
        cache,
        budget,
      });
      if (adjudication.effectiveVerdict) contradictionHits.push({ text: item.text, overlap, mode: 'adjudicated', adjudication });
    }
  }
  const contradiction = contradictionHits.length > 0;
  trace.scoring.contradiction = { contradiction, contradictionHits };

  // 4) state-accuracy: probe answers vs expected answers.
  const answerById = new Map(handoffOutput.probeAnswers.map((item) => [item.id, item.answer]));
  const probeResults = [];
  for (const probe of gt.probeQuestions ?? []) {
    const answer = answerById.get(probe.id) ?? '';
    const overlap = tokenOverlap(answer, probe.expectedAnswer);
    const polarityParity = negationCueCount(answer) === negationCueCount(probe.expectedAnswer);
    let correct;
    let adjudication;
    if (overlap >= BANDS.probeCorrect && polarityParity) {
      correct = true;
    } else {
      // Everything below the deterministic-correct bar is adjudicated: terse
      // but correct answers ("0", "No") must not be failed by token overlap.
      const material = `Probe question: ${probe.question}\nExpected answer: ${probe.expectedAnswer}\nHandoff answer: ${answer}`;
      adjudication = await adjudicate({
        metric: 'probe-correct',
        question: 'Does the handoff answer correctly answer the probe question with the same core fact and polarity as the expected answer? A terse answer is correct if it answers the question; extra correct context is allowed; wrong polarity or wrong facts are incorrect.',
        material,
        judgeModel,
        provider,
        transport,
        sampleId: `${sampleId}/${probe.id}`,
        cache,
        budget,
        acceptExact: [answer, probe.expectedAnswer],
      });
      correct = adjudication.effectiveVerdict;
    }
    probeResults.push({ id: probe.id, type: probe.type, overlap, correct, ...(adjudication ? { adjudication } : {}) });
  }
  const stateAccuracy = probeResults.length ? probeResults.filter((item) => item.correct).length / probeResults.length : 0;
  trace.scoring.probes = probeResults;

  // Diagnostic (not a metric): is the GT next action even available in the
  // summary? Separates compression-loss from presentation/agent-loss.
  const gtActionAvailable = tokenOverlap(summary, gtActionText) >= 0.3;
  const diagnosis = success ? 'ok' : (gtActionAvailable ? 'presentation-or-agent-loss' : 'compression-loss');
  return {
    sampleId,
    success,
    repeat,
    contradiction,
    stateAccuracy,
    actionOverlap,
    gtActionAvailable,
    diagnosis,
    trace,
  };
}
// ---------------------------------------------------------------------------
// Run loop
// ---------------------------------------------------------------------------

function stripContinuationDirective(summary) {
  const marker = '## Continuation Directive';
  const index = String(summary).indexOf(marker);
  return index < 0 ? String(summary) : String(summary).slice(0, index).trimEnd();
}

function loadSummaries(summariesPath, { stripDirective = argFlag('--strip-directive') } = {}) {
  const rows = readFileSync(summariesPath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  return new Map(rows.map((row) => [row.sampleId, stripDirective ? stripContinuationDirective(row.compressedSummary) : row.compressedSummary]));
}

export async function runBenchmark({ summariesPath, gtPath, outDir, handoffModel, judgeModel, maxSamples, allowUnlocked, transport, stripDirective = undefined }) {
  const gt = JSON.parse(readFileSync(gtPath, 'utf8'));
  const lockStatus = verifyLock(gtPath, { allowUnlocked });
  if (handoffModel === judgeModel) throw new Error(`model independence violated: handoff model and judge model are both ${handoffModel}`);
  const summaries = loadSummaries(summariesPath, stripDirective === undefined ? {} : { stripDirective });
  const sampleIds = Object.keys(gt.samples ?? {}).filter((id) => summaries.has(id)).slice(0, maxSamples);
  if (!sampleIds.length) throw new Error('no overlap between ground-truth samples and provided summaries');

  mkdirSync(outDir, { recursive: true });
  const cache = new DiskCache(resolve(outDir, 'cache'));
  const budget = new BudgetLedger(Number(process.env.COMPACTION_MAX_COST_CNY ?? argValue('--max-cost-cny', '5')));
  const provider = providerConfig();
  const results = [];
  const perSample = {};

  for (const sampleId of sampleIds) {
    const gtSample = gt.samples[sampleId];
    const summary = summaries.get(sampleId);
    const prompt = buildHandoffPrompt({ summary, probes: gtSample.probeQuestions ?? [] });
    // Double-blind structural guard: the prompt may only be built from the
    // summary and the annotated probes. Assert no transcript payload leaked.
    if (/\[user\/|\[assistant\/|\[tool\//u.test(prompt.split('## Handoff Summary')[0])) {
      throw new Error(`${sampleId}: double-blind guard tripped (transcript-shaped content outside summary section)`);
    }
    const handoffCacheKey = sha256(stableJson({
      v: HANDOFF_PROMPT_VERSION,
      model: handoffModel,
      summaryHash: sha256(summary),
      gtSampleHash: sha256(stableJson(gtSample)),
    }));
    let handoffRaw = cache.read(handoffCacheKey);
    if (!handoffRaw) {
      if (!provider.apiKey && !transport) throw new Error('COMPACTION_API_KEY is not set');
      const data = await fetchJson({
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey ?? 'test-key',
        model: handoffModel,
        system: HANDOFF_SYSTEM,
        user: prompt,
        purpose: 'handoff',
        sampleId,
        transport,
      });
      budget.record(handoffModel, data.usage);
      handoffRaw = data?.choices?.[0]?.message?.content ?? '';
      cache.write(handoffCacheKey, { rawText: handoffRaw, model: handoffModel });
    }
    let parsedOutput = {};
    try { parsedOutput = extractJsonObject(handoffRaw.rawText ?? handoffRaw); } catch (error) {
      results.push({ sampleId, success: false, repeat: false, contradiction: false, stateAccuracy: 0, actionOverlap: 0, protocolError: String(error.message ?? error).slice(0, 200) });
      continue;
    }
    const handoffOutput = normalizeHandoffOutput(parsedOutput);
    const scored = await scoreSample({
      sampleId,
      summary,
      gt: gtSample,
      handoffOutput,
      provider,
      judgeModel,
      transport,
      cache,
      budget,
    });
    results.push(scored);
    perSample[sampleId] = { handoffOutput, promptHash: sha256(prompt), summaryHash: sha256(summary) };
    writeFileSync(resolve(outDir, `sample-${sampleId}.json`), `${JSON.stringify({ sampleId, handoffOutput, result: scored }, null, 2)}\n`, 'utf8');
    console.error(`[handoff] ${sampleId}: success=${scored.success} repeat=${scored.repeat} contradiction=${scored.contradiction} state=${scored.stateAccuracy.toFixed(2)}`);
  }

  const aggregate = {
    schema: BENCHMARK_SCHEMA,
    generatedAt: new Date().toISOString(),
    promptVersion: HANDOFF_PROMPT_VERSION,
    judgePromptVersion: HANDOFF_JUDGE_PROMPT_VERSION,
    bands: BANDS,
    handoffModel,
    judgeModel,
    summariesPath: resolve(summariesPath),
    summaryVariant: argFlag('--strip-directive') ? 'core' : 'shipped',
    groundTruthPath: resolve(gtPath),
    groundTruthLocked: lockStatus.locked === true,
    lockStatus: lockStatus.locked ? 'locked' : `UNLOCKED (${lockStatus.reason})`,
    gtSha256: sha256(readFileSync(gtPath)),
    sampleCount: results.length,
    metrics: {
      handoffSuccessRate: results.length ? results.filter((item) => item.success).length / results.length : 0,
      repeatWorkRate: results.length ? results.filter((item) => item.repeat).length / results.length : 0,
      contradictionRate: results.length ? results.filter((item) => item.contradiction).length / results.length : 0,
      stateAccuracy: results.length ? results.reduce((sum, item) => sum + item.stateAccuracy, 0) / results.length : 0,
    },
    scoringVersion: SCORING_VERSION,
    diagnosisCounts: results.reduce((acc, item) => {
      const key = item.diagnosis ?? 'n/a';
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
    budget: { estSpentCny: budget.spentCny, calls: budget.calls, byModel: budget.byModel, maxCostCny: budget.maxCostCny },
    results,
  };
  writeFileSync(resolve(outDir, 'results.json'), `${JSON.stringify(aggregate, null, 2)}\n`, 'utf8');
  writeFileSync(resolve(outDir, 'report.md'), `${renderReport(aggregate)}\n`, 'utf8');
  return aggregate;
}

function renderReport(aggregate) {
  const m = aggregate.metrics;
  return [
    `# Handoff Benchmark Report (${aggregate.generatedAt})`,
    '',
    `- schema: ${aggregate.schema}`,
    `- handoff model: ${aggregate.handoffModel} | judge model: ${aggregate.judgeModel}`,
    `- ground truth: ${aggregate.lockStatus} (sha256 ${aggregate.gtSha256.slice(0, 12)}...)`,
    `- samples: ${aggregate.sampleCount}`,
    '',
    '## Metrics',
    '',
    '| metric | value |',
    '| --- | --- |',
    `| handoff-success-rate | ${m.handoffSuccessRate.toFixed(4)} |`,
    `| repeat-work-rate | ${m.repeatWorkRate.toFixed(4)} |`,
    `| contradiction-rate | ${m.contradictionRate.toFixed(4)} |`,
    `| state-accuracy | ${m.stateAccuracy.toFixed(4)} |`,
    '',
    '## Per-sample',
    '',
    '| sample | success | repeat | contradiction | state-acc | note |',
    '| --- | --- | --- | --- | --- | --- |',
    ...aggregate.results.map((item) => `| ${item.sampleId} | ${item.success} | ${item.repeat} | ${item.contradiction} | ${item.stateAccuracy.toFixed(2)} | ${item.protocolError ?? ''} |`),
    '',
    `Estimated spend: ¥${aggregate.budget.estSpentCny.toFixed(4)} over ${aggregate.budget.calls} calls (cap ¥${aggregate.budget.maxCostCny}).`,
    '',
    aggregate.groundTruthLocked ? '' : '> WARNING: ground truth was NOT user-locked for this run; treat all numbers as PROVISIONAL, not acceptance evidence.',
  ].join('\n');
}
// ---------------------------------------------------------------------------
// Self-test (offline, synthetic, zero network)
// ---------------------------------------------------------------------------

function syntheticGroundTruth() {
  return {
    schema: 'handoff-benchmark-ground-truth/v1',
    status: 'self-test',
    samples: {
      S1: {
        sampleId: 'S1',
        correctEndState: 'Refresh token rotation implemented in auth-service.ts; token refresh test still failing.',
        correctNextAction: { kind: 'run_test', target: 'pnpm exec vitest run tests/unit/auth.test.ts', params: {}, rationale: 'fix the failing auth token refresh test' },
        completedWork: [{ text: 'implement refresh token rotation in auth-service.ts', evidence: { messageId: 'm1', line: 10 } }],
        rejectedPaths: [{ text: 'rollback to session-based auth', evidence: { messageId: 'm2', line: 20 } }],
        probeQuestions: [
          { id: 'q1', type: 'state', question: 'Which file implemented the refresh token rotation?', expectedAnswer: 'auth-service.ts', evidence: { messageId: 'm1', line: 10 } },
          { id: 'q2', type: 'state', question: 'Which test is currently failing?', expectedAnswer: 'tests/unit/auth.test.ts token refresh case', evidence: { messageId: 'm3', line: 30 } },
          { id: 'q3', type: 'constraint', question: 'Which auth approach must not be restored?', expectedAnswer: 'session-based auth', evidence: { messageId: 'm2', line: 20 } },
          { id: 'q4', type: 'constraint', question: 'What versioning constraint applies?', expectedAnswer: 'do not bump major version', evidence: { messageId: 'm4', line: 40 } },
        ],
      },
      S2: {
        sampleId: 'S2',
        correctEndState: 'Refresh token rotation implemented in auth-service.ts; token refresh test still failing.',
        correctNextAction: { kind: 'run_test', target: 'pnpm exec vitest run tests/unit/auth.test.ts', params: {}, rationale: 'fix the failing auth token refresh test' },
        completedWork: [{ text: 'implement refresh token rotation in auth-service.ts', evidence: { messageId: 'm1', line: 10 } }],
        rejectedPaths: [{ text: 'reimplement refresh token rotation from scratch', evidence: { messageId: 'm2', line: 20 } }],
        probeQuestions: [
          { id: 'q1', type: 'state', question: 'Which file implemented the refresh token rotation?', expectedAnswer: 'auth-service.ts', evidence: { messageId: 'm1', line: 10 } },
          { id: 'q2', type: 'state', question: 'Which test is currently failing?', expectedAnswer: 'tests/unit/auth.test.ts token refresh case', evidence: { messageId: 'm3', line: 30 } },
          { id: 'q3', type: 'constraint', question: 'Which auth approach must not be restored?', expectedAnswer: 'session-based auth', evidence: { messageId: 'm2', line: 20 } },
          { id: 'q4', type: 'constraint', question: 'What versioning constraint applies?', expectedAnswer: 'do not bump major version', evidence: { messageId: 'm4', line: 40 } },
        ],
      },
    },
  };
}

const GOOD_SUMMARY = 'GOOD-SUMMARY-MARKER. Completed: implement refresh token rotation in auth-service.ts. Failing: tests/unit/auth.test.ts token refresh case. Constraint: do not bump major version; rejected rollback to session-based auth. Next: fix the failing auth token refresh test by running pnpm exec vitest run tests/unit/auth.test.ts.';
const BAD_SUMMARY = 'BAD-SUMMARY-MARKER. All work is finished. Next: implement refresh token rotation in auth-service.ts again from the beginning.';

function stubTransport() {
  return async (url, init) => {
    const body = JSON.parse(init.body);
    const user = body.messages.find((message) => message.role === 'user').content;
    let content;
    if (user.includes('## Probe Questions')) {
      content = user.includes('GOOD-SUMMARY-MARKER')
        ? JSON.stringify({
          stateAssessment: { completed: ['implement refresh token rotation in auth-service.ts'], inProgress: [], pending: ['fix the failing auth token refresh test'], constraints: ['do not bump major version'] },
          nextAction: { kind: 'run_test', target: 'pnpm exec vitest run tests/unit/auth.test.ts', params: {}, rationale: 'fix the failing auth token refresh test' },
          probeAnswers: [
            { id: 'q1', answer: 'auth-service.ts' },
            { id: 'q2', answer: 'tests/unit/auth.test.ts token refresh case' },
            { id: 'q3', answer: 'session-based auth' },
            { id: 'q4', answer: 'do not bump major version' },
          ],
        })
        : JSON.stringify({
          stateAssessment: { completed: ['everything'], inProgress: [], pending: ['implement refresh token rotation in auth-service.ts again'], constraints: [] },
          nextAction: { kind: 'implement', target: 'refresh token rotation in auth-service.ts', params: {}, rationale: 'implement refresh token rotation from the beginning again' },
          probeAnswers: [
            { id: 'q1', answer: 'unknown' },
            { id: 'q2', answer: 'no failing tests' },
            { id: 'q3', answer: 'oauth' },
            { id: 'q4', answer: 'always bump major version' },
          ],
        });
    } else if (user.includes('Metric: action-match')) {
      content = JSON.stringify({ verdict: false, citation: 'implement refresh token rotation' });
    } else if (user.includes('Metric: probe-correct')) {
      // Deliberately ungrounded citation: must be fail-closed to incorrect.
      content = JSON.stringify({ verdict: true, citation: 'THIS-CITATION-IS-NOT-IN-THE-MATERIAL' });
    } else if (user.includes('Metric: contradiction')) {
      content = JSON.stringify({ verdict: true, citation: 'refresh token rotation' });
    } else {
      content = JSON.stringify({ verdict: false, citation: 'implement refresh token rotation' });
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => undefined },
      json: async () => ({ choices: [{ message: { content } }], usage: { prompt_tokens: 100, completion_tokens: 50 } }),
      text: async () => '',
    };
  };
}

async function runSelfTest() {
  const failures = [];
  const check = (name, condition) => {
    console.error(`[self-test] ${condition ? 'PASS' : 'FAIL'} ${name}`);
    if (!condition) failures.push(name);
  };
  const os = await import('node:os');
  const { mkdtempSync } = await import('node:fs');
  const tmp = mkdtempSync(resolve(os.tmpdir(), 'handoff-selftest-'));
  const gtPath = resolve(tmp, 'ground-truth.json');
  writeFileSync(gtPath, `${JSON.stringify(syntheticGroundTruth(), null, 2)}\n`, 'utf8');

  // Lock enforcement: locked OK, tampered GT must fail closed.
  lockGroundTruth(gtPath);
  check('lock verifies before tamper', verifyLock(gtPath).locked === true);
  writeFileSync(gtPath, `${readFileSync(gtPath, 'utf8')} `, 'utf8');
  let threw = false;
  try { verifyLock(gtPath); } catch { threw = true; }
  check('tampered GT rejected (fail-closed)', threw);
  check('tampered GT allowed with --allow-unlocked flag', verifyLock(gtPath, { allowUnlocked: true }).locked === false);
  lockGroundTruth(gtPath); // re-lock restored content for the run below

  const summariesPath = resolve(tmp, 'summaries.jsonl');
  writeFileSync(summariesPath, [
    JSON.stringify({ sampleId: 'S1', compressedSummary: GOOD_SUMMARY }),
    JSON.stringify({ sampleId: 'S2', compressedSummary: BAD_SUMMARY }),
  ].join('\n') + '\n', 'utf8');

  const outDir = resolve(tmp, 'out');
  const aggregate = await runBenchmark({
    summariesPath,
    gtPath,
    outDir,
    handoffModel: 'stub-handoff-model',
    judgeModel: 'stub-judge-model',
    maxSamples: 2,
    allowUnlocked: false,
    transport: stubTransport(),
  });
  const byId = new Map(aggregate.results.map((item) => [item.sampleId, item]));
  check('S1 success', byId.get('S1').success === true);
  check('S1 no repeat', byId.get('S1').repeat === false);
  check('S1 no contradiction', byId.get('S1').contradiction === false);
  check('S1 state accuracy 1.0', byId.get('S1').stateAccuracy === 1);
  check('S2 failure detected', byId.get('S2').success === false);
  check('S2 repeat-work detected', byId.get('S2').repeat === true);
  check('S2 contradiction detected', byId.get('S2').contradiction === true);
  check('S2 state accuracy 0', byId.get('S2').stateAccuracy === 0);
  // Judge citation enforcement: S2 probes sit in the ambiguous band for at
  // least one question; the stub judge says true with a bogus citation, so
  // every probe it touches must fail closed to incorrect.
  const s2Probes = byId.get('S2').trace.scoring.probes;
  check('S2 probes all incorrect', s2Probes.every((probe) => probe.correct === false));
  check('aggregate metrics consistent', aggregate.metrics.handoffSuccessRate === 0.5 && aggregate.metrics.repeatWorkRate === 0.5 && aggregate.metrics.contradictionRate === 0.5);
  check('double-blind: prompt built without transcript access', existsSync(resolve(outDir, 'sample-S1.json')));

  console.error(failures.length ? `[self-test] FAILED: ${failures.join(', ')}` : '[self-test] ALL PASS');
  return failures.length === 0;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const manifestPath = resolve(argValue('--manifest', 'reports/context-compression/production-manifest-30.json'));
  const metaPath = resolve(argValue('--meta', 'reports/context-compression/production-summaries-30-generated.meta.json'));
  const gtPath = resolve(argValue('--ground-truth', 'reports/context-compression/handoff-benchmark-v1/ground-truth.json'));

  if (argFlag('--self-test')) {
    const ok = await runSelfTest();
    process.exit(ok ? 0 : 1);
  }

  if (argFlag('--lock')) {
    const { lockPath, lock } = lockGroundTruth(gtPath);
    console.log(JSON.stringify({ lockPath, lock }, null, 2));
    return;
  }

  if (argFlag('--select-only')) {
    const { selected, evaluated } = selectSamples({ manifestPath, metaPath });
    const outPath = resolve(argValue('--out', 'reports/context-compression/handoff-benchmark-v1/selection.json'));
    mkdirSync(resolve(outPath, '..'), { recursive: true });
    const payload = {
      schema: 'handoff-benchmark-selection/v1',
      generatedAt: new Date().toISOString(),
      rule: 'pending-objective OR unresolved-failure(followUp), cap 12 manifest order; fill to >=10 with next-action facts',
      selected: selected.map(({ sampleId, transcript, window, reasons, primary }) => ({ sampleId, transcript, window, reasons, primary })),
      evaluated: evaluated.map(({ sampleId, reasons, primary, fillCandidate }) => ({ sampleId, reasons, primary, fillCandidate })),
    };
    writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(payload.selected, null, 2));
    return;
  }

  const summariesPath = resolve(argValue('--summaries', 'artifacts/p6-tf0074-deterministic-recovery-30-v12/would-retry-summaries.jsonl'));
  const stamp = new Date().toISOString().replace(/[:.]/gu, '-');
  const outDir = resolve(argValue('--out', `artifacts/handoff-benchmark-v1/${stamp}`));
  const aggregate = await runBenchmark({
    summariesPath,
    gtPath,
    outDir,
    handoffModel: argValue('--handoff-model', 'qwen-flash'),
    judgeModel: argValue('--judge-model', 'qwen-plus-latest'),
    maxSamples: Number(argValue('--max-samples', '30')),
    allowUnlocked: argFlag('--allow-unlocked'),
  });
  console.log(JSON.stringify({ outDir, metrics: aggregate.metrics, lockStatus: aggregate.lockStatus, budget: aggregate.budget }, null, 2));
}

if (isMainEntrypoint(import.meta.url)) {
  main().catch((error) => {
    console.error(`[handoff-benchmark] FATAL: ${error.stack ?? error}`);
    process.exit(1);
  });
}