#!/usr/bin/env node
/**
 * Phase 1 Grounded LLM Extractor (TF-0074 v8 optimization).
 *
 * Hybrid architecture: a small model proposes candidate facts WITH mandatory
 * provenance (entryId + verbatim quote); a deterministic verifier rejects any
 * candidate whose quote is not a verbatim substring of the window text or
 * whose entry cannot be resolved (fail-closed, zero-fabrication invariant).
 * Verified candidates are cross-checked against the existing regex extractor:
 * both-agree = high confidence, LLM-only = recall gain (severity capped),
 * regex-only = conservative backbone kept, polarity conflicts resolve to the
 * conservative (regex) value.
 *
 * The module is imported by both twins (eval-runner / recovery-ledger based
 * tooling); the semantic-audit copy stays independent.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  BudgetLedger,
  DiskCache,
  collapseWhitespace,
  fetchJson,
  negationCueCount,
  providerConfig,
  sha256,
  stableJson,
  tokenOverlap,
} from './context-compression-llm-shared.mjs';
import { extractJsonObject } from './context-compression-json-repair.mjs';
import { buildRecoveryLedger, buildDeterministicRecoverySummary, buildContinuationDirective, isUnresolvedFailureFact } from './context-compression-recovery-ledger.mjs';

export const EXTRACTOR_PROMPT_VERSION = 'grounded-extractor-prompt-v1';
const ENTRY_DISPLAY_CAP = 4000;
const MAX_CHUNK_CAP = 26000;

const EXTRACTOR_SYSTEM = 'You are a fact extractor for software-agent session transcripts. You extract only information that is literally present in the text. You never infer, guess, translate loosely, or complete missing information. You answer with strict JSON only.';

function buildExtractionUserPrompt(chunkText, focusLines = []) {
  return [
    'Extract candidate facts from the transcript chunk below.',
    '',
    'Return strict JSON only with this schema:',
    '{"facts": [{"text": string, "category": "objective|decision|test_result|file_context|file_mutation|blocker|failure|next_action|constraint|other", "severity": "critical|important|minor", "provenance": {"entryId": string, "quote": string}}]}',
    '',
    'Rules:',
    '- text: ONE factual statement copied or tightly paraphrased from the chunk; keep names, numbers, paths, commands, and error strings exact.',
    '- quote: a VERBATIM substring of the chunk text (10-200 chars) that proves the fact. Candidates without a verbatim quote are rejected by the verifier.',
    '- entryId: the entry marker id (the value after [entry) where the quote appears.',
    '- Extract: objectives/tasks, decisions and conclusions, test/build/verify results INCLUDING explicit skips, relevant file paths, failures and whether they were resolved, next actions, constraints and limitations.',
    '- Do NOT extract anything that is not literally present. If nothing qualifies return {"facts": []}.',
    '',
    ...(focusLines.length ? ['', '## Additional focus directives (from optimization guideline)', ...focusLines.map((line) => `- ${line}`)] : []),
    '',
    '## Transcript chunk',
    chunkText,
  ].join('\n');
}

/** Render the ledger window for extraction: entry markers + capped text. */
export function buildExtractionWindow(ledger, { entryDisplayCap = ENTRY_DISPLAY_CAP } = {}) {
  const entries = ledger.entries ?? [];
  const lines = [];
  for (const entry of entries) {
    lines.push(`[entry ${entry.messageId} line=${entry.line} role=${entry.role} kind=${entry.kind}]`);
    lines.push(String(entry.text ?? '').slice(0, entryDisplayCap));
  }
  const text = lines.join('\n');
  return {
    text,
    textVerbatimNormalized: text.replace(/[`*]/gu, ''),
    entries,
    entryById: new Map(entries.map((entry) => [entry.messageId, entry])),
    minLine: entries.length ? Math.min(...entries.map((entry) => entry.line)) : 0,
    maxLine: entries.length ? Math.max(...entries.map((entry) => entry.line)) : 0,
  };
}

/** Adaptive chunking on entry boundaries; never exceeds maxChunks chunks. */
export function chunkWindow(window, { maxChunks = 12 } = {}) {
  const totalChars = window.text.length;
  const budget = Math.min(MAX_CHUNK_CAP, Math.max(6000, Math.ceil(totalChars / maxChunks)));
  const chunks = [];
  let current = [];
  let currentSize = 0;
  for (const entry of window.entries) {
    const rendered = `[entry ${entry.messageId} line=${entry.line} role=${entry.role} kind=${entry.kind}]\n${String(entry.text ?? '').slice(0, ENTRY_DISPLAY_CAP)}`;
    if (currentSize + rendered.length > budget && current.length) {
      chunks.push(current.join('\n'));
      current = [];
      currentSize = 0;
    }
    current.push(rendered);
    currentSize += rendered.length;
  }
  if (current.length) chunks.push(current.join('\n'));
  if (chunks.length > maxChunks) {
    // Fold overflow into the last allowed chunk (bounded by MAX_CHUNK_CAP*2).
    const folded = chunks.slice(0, maxChunks - 1);
    folded.push(chunks.slice(maxChunks - 1).join('\n').slice(0, MAX_CHUNK_CAP * 2));
    return folded;
  }
  return chunks;
}

/**
 * Deterministic provenance verifier (zero-fabrication invariant).
 * Fail-closed: any missing/unresolvable provenance rejects the candidate.
 */
/** Verbatim check tolerant of markdown formatting chars only (backticks/asterisks);
 * every content character must still match exactly. */
function normalizeForVerbatim(value) {
  return collapseWhitespace(value).replace(/[`*]/gu, '');
}
export function verifyCandidateFact(candidate, window) {
  const provenance = candidate?.provenance;
  const quote = provenance?.quote;
  if (typeof quote !== 'string' || collapseWhitespace(quote).length < 8) {
    return { ok: false, reason: 'missing_or_short_quote' };
  }
  const haystack = window.textVerbatimNormalized ?? normalizeForVerbatim(window.text);
  if (!haystack.includes(normalizeForVerbatim(quote))) {
    return { ok: false, reason: 'quote_not_verbatim' };
  }
  const entry = window.entryById.get(provenance.entryId);
  if (!entry) {
    return { ok: false, reason: 'entry_not_in_window' };
  }
  const { lineStart, lineEnd } = provenance;
  if (lineStart !== undefined && (Number(lineStart) < window.minLine || Number(lineStart) > window.maxLine)) {
    return { ok: false, reason: 'line_out_of_range' };
  }
  if (lineEnd !== undefined && (Number(lineEnd) < window.minLine || Number(lineEnd) > window.maxLine)) {
    return { ok: false, reason: 'line_out_of_range' };
  }
  return { ok: true, entry };
}

/** Deterministic story classification from ledger facts (same rules as the GT
 * draft generator): pending = pending-objective present; blocked = unresolved
 * failure chain without a latest-outcome; otherwise completed. */
export function classifyStory(ledger) {
  const facts = ledger.expected ?? [];
  const hasPending = facts.some((item) => String(item.id).includes('pending-objective'));
  if (hasPending) return 'pending';
  const unresolved = facts.filter((item) => isUnresolvedFailureFact(item));
  const latestOutcome = facts.some((item) => String(item.id).includes('latest-outcome'));
  if (unresolved.length && !latestOutcome) return 'blocked';
  return 'completed';
}

const COMPLETION_CUES = /(completed|complete|fixed|verified|passed|success|resolved|已完成|已修复|已确认|通过|成功|修复完成)/u;
const PENDING_CUES = /(not verified|not executed|not complete|unresolved|未执行|未完成|尚未|没有执行|未验证)/u;

function isCompletionClaim(fact) {
  return (fact.category === 'test_result' || fact.category === 'decision' || String(fact.id ?? '').includes('latest-outcome')) && COMPLETION_CUES.test(String(fact.text));
}

function isPendingClaim(fact) {
  return String(fact.id ?? '').includes('pending-objective') || PENDING_CUES.test(String(fact.text));
}

/**
 * Merge verified LLM facts with regex facts. Three-way classification plus
 * conservative polarity-conflict resolution (pending beats completed).
 */
export function mergeFactPools({ regexFacts, verifiedLlmFacts, sampleId = 'R' }) {
  const merged = regexFacts.map((fact) => ({ ...fact, extractorAgreement: 'regex' }));
  const conflicts = [];
  let bothCount = 0;
  let llmOnlyCount = 0;
  const seen = new Set(regexFacts.map((fact) => collapseWhitespace(fact.text).slice(0, 120)));
  verifiedLlmFacts.forEach((llmFact, index) => {
    const text = collapseWhitespace(llmFact.text);
    // Polarity conflict check FIRST: a completion claim that lexically
    // overlaps a pending claim must never be treated as agreement.
    const conflictPartner = regexFacts.find((regexFact) => (
      tokenOverlap(llmFact.text, regexFact.text) >= 0.3
      && negationCueCount(llmFact.text) !== negationCueCount(regexFact.text)
      && ((isCompletionClaim(llmFact) && isPendingClaim(regexFact)) || (isPendingClaim(llmFact) && isCompletionClaim(regexFact)))
    ));
    if (conflictPartner) {
      conflicts.push({ llmFact, regexFact: conflictPartner, resolution: 'kept_regex_conservative' });
      return;
    }
    let best = { overlap: 0, fact: undefined };
    for (const regexFact of regexFacts) {
      const overlap = tokenOverlap(llmFact.text, regexFact.text);
      if (overlap > best.overlap) best = { overlap, fact: regexFact };
    }
    if (best.overlap >= 0.5 && best.fact) {
      // Both extractors agree: reinforce the regex fact with provenance.
      const target = merged.find((item) => item.id === best.fact.id && item.text === best.fact.text);
      if (target) {
        target.extractorAgreement = 'both';
        target.provenance = llmFact.provenance;
      }
      bothCount += 1;
      return;
    }
    if (seen.has(text.slice(0, 120))) return;
    seen.add(text.slice(0, 120));
    // Verified next_action facts join the existing 'next-action' pipeline so
    // buildContinuationDirective can promote concrete discovered entry points
    // to the primary continuation action (the pending-family fix).
    const isNextAction = llmFact.category === 'next_action';
    merged.push({
      id: isNextAction ? `${sampleId}-next-action-llm-${index + 1}` : `${sampleId}-llm-${index + 1}`,
      text: llmFact.text,
      severity: llmFact.severity === 'critical' ? 'important' : (llmFact.severity ?? 'important'),
      category: isNextAction ? 'decision' : (llmFact.category ?? 'other'),
      acceptableParaphrases: [],
      evidence: { messageId: llmFact.provenance.entryId, line: llmFact.provenance.line, file: llmFact.provenance.file },
      provenance: llmFact.provenance,
      extractorAgreement: 'llm-only',
    });
    llmOnlyCount += 1;
  });
  return { mergedFacts: merged, conflicts, bothCount, llmOnlyCount, regexOnlyCount: regexFacts.length };
}
/**
 * k-shot majority merge: cluster candidate facts across extraction ballots by
 * token overlap; keep clusters supported by a strict majority of ballots.
 * Every member already passed the deterministic provenance verifier, so the
 * zero-fabrication invariant holds regardless of k.
 */
export function majorityMergeFactBallots(ballots) {
  if (ballots.length <= 1) return ballots[0] ?? [];
  const clusters = [];
  ballots.forEach((ballot, ballotIndex) => {
    for (const candidate of ballot) {
      const home = clusters.find((cluster) => cluster.ballots.has(ballotIndex) === false
        && cluster.members.some((member) => tokenOverlap(member.text, candidate.text) >= 0.6));
      if (home) {
        home.members.push(candidate);
        home.ballots.add(ballotIndex);
      } else {
        clusters.push({ members: [candidate], ballots: new Set([ballotIndex]) });
      }
    }
  });
  const needed = Math.floor(ballots.length / 2) + 1;
  return clusters.filter((cluster) => cluster.ballots.size >= needed).map((cluster) => cluster.members[0]);
}

/**
 * Run grounded extraction over one ledger window. Returns merged facts plus
 * accounting. `transport` allows offline testing; `cache` deduplicates calls.
 * `votes` > 1 enables k-shot majority extraction (variance stabilization):
 * each chunk is extracted k times (temperature 0.3) and only facts supported
 * by a strict majority of ballots survive.
 */
export async function extractGroundedFacts({ ledger, model, provider, transport, cache, budget, sampleId, maxChunks = 12, focusLines = [], votes = 1 }) {
  const window = buildExtractionWindow(ledger);
  const chunks = chunkWindow(window, { maxChunks });
  const verified = [];
  const rejected = [];
  let rawCandidates = 0;
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const ballots = [];
    for (let vote = 1; vote <= Math.max(1, votes); vote += 1) {
      const cacheKey = sha256(stableJson({ v: EXTRACTOR_PROMPT_VERSION, model, chunkHash: sha256(chunk), focus: focusLines, votes, vote: votes > 1 ? vote : undefined }));
      let parsed;
      if (cache) {
        const cached = cache.read(cacheKey);
        if (cached) parsed = cached.parsed;
      }
      if (!parsed) {
        const data = await fetchJson({
          baseUrl: provider.baseUrl,
          apiKey: provider.apiKey ?? 'test-key',
          model,
          system: EXTRACTOR_SYSTEM,
          user: buildExtractionUserPrompt(chunk, focusLines),
          purpose: 'extract',
          sampleId: votes > 1 ? `${sampleId}/chunk${index + 1}v${vote}` : `${sampleId}/chunk${index + 1}`,
          transport,
          maxTokens: 6000,
          temperature: votes > 1 ? 0.3 : 0,
        });
        budget?.record(model, data.usage);
        const rawText = data?.choices?.[0]?.message?.content ?? '';
        try { parsed = extractJsonObject(rawText); } catch { parsed = { facts: [] }; }
        if (cache) cache.write(cacheKey, { parsed });
      }
      const facts = Array.isArray(parsed.facts) ? parsed.facts : [];
      const ballotVerified = [];
      for (const candidate of facts) {
        rawCandidates += 1;
        if (!candidate || typeof candidate.text !== 'string' || !candidate.text.trim()) {
          rejected.push({ reason: 'missing_text', candidate });
          continue;
        }
        const verdict = verifyCandidateFact(candidate, window);
        if (!verdict.ok) {
          rejected.push({ reason: verdict.reason, candidate });
          continue;
        }
        ballotVerified.push({
          text: candidate.text.trim(),
          category: typeof candidate.category === 'string' ? candidate.category : 'other',
          severity: typeof candidate.severity === 'string' ? candidate.severity : 'important',
          provenance: {
            entryId: candidate.provenance.entryId,
            quote: candidate.provenance.quote,
            line: verdict.entry.line,
            file: verdict.entry.file,
          },
        });
      }
      ballots.push(ballotVerified);
    }
    verified.push(...majorityMergeFactBallots(ballots));
  }
  const merge = mergeFactPools({ regexFacts: ledger.expected ?? [], verifiedLlmFacts: verified, sampleId });
  return {
    sampleId,
    chunks: chunks.length,
    rawCandidates,
    verifiedCount: verified.length,
    provenanceRejectCount: rejected.length,
    rejected,
    ...merge,
  };
}

/** Build the grounded summary variant: deterministic template over merged pool. */
export function buildGroundedRecoverySummary(ledger, extraction) {
  const derivedLedger = { ...ledger, expected: extraction.mergedFacts };
  return buildDeterministicRecoverySummary(derivedLedger);
}

// ---------------------------------------------------------------------------
// CLI: run over manifest samples, emit grounded facts + paired summaries
// ---------------------------------------------------------------------------

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function argFlag(name) {
  return process.argv.includes(name);
}

async function main() {
  const manifestPath = resolve(argValue('--manifest', 'reports/context-compression/production-manifest-30.json'));
  const metaPath = resolve(argValue('--meta', 'reports/context-compression/production-summaries-30-generated.meta.json'));
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  const metaById = new Map((meta.entries ?? []).map((entry) => [entry.sampleId, entry]));
  const onlyIds = argValue('--samples', '') ? argValue('--samples', '').split(',').map((item) => item.trim()).filter(Boolean) : undefined;
  const stamp = new Date().toISOString().replace(/[:.]/gu, '-');
  const outDir = resolve(argValue('--out', `artifacts/grounded-extractor-v1/${stamp}`));
  mkdirSync(outDir, { recursive: true });
  const cache = new DiskCache(resolve(outDir, 'cache'));
  const budget = new BudgetLedger(Number(argValue('--max-cost-cny', '5')));
  const provider = providerConfig();
  const model = argValue('--model', 'qwen-flash');
  const summaryRows = [];
  const accounting = [];
  for (const sample of manifest.samples ?? []) {
    if (onlyIds && !onlyIds.includes(sample.id)) continue;
    const metaEntry = metaById.get(sample.id);
    if (!metaEntry?.file) throw new Error(`${sample.id}: missing transcript meta entry`);
    const ordinalIndex = Number(/^R(\d+)$/u.exec(String(sample.id))?.[1] ?? 1) - 1;
    const ledger = buildRecoveryLedger(metaEntry.file, sample.id, { windowSize: Number(sample.cohort?.turn ?? 200), ordinalIndex });
    const extraction = await extractGroundedFacts({ ledger, model, provider, cache, budget, sampleId: sample.id });
    const directive = buildContinuationDirective({ ...ledger, expected: extraction.mergedFacts });
    const summary = `${buildGroundedRecoverySummary(ledger, extraction)}\n\n${directive.text}`.trim();
    summaryRows.push({ sampleId: sample.id, compressedSummary: summary });
    const stats = {
      sampleId: sample.id,
      chunks: extraction.chunks,
      rawCandidates: extraction.rawCandidates,
      verified: extraction.verifiedCount,
      rejected: extraction.provenanceRejectCount,
      both: extraction.bothCount,
      llmOnly: extraction.llmOnlyCount,
      conflicts: extraction.conflicts.length,
    };
    accounting.push(stats);
    writeFileSync(resolve(outDir, `facts-${sample.id}.json`), `${JSON.stringify(extraction, null, 2)}\n`, 'utf8');
    console.error(`[grounded] ${sample.id}: chunks=${stats.chunks} raw=${stats.rawCandidates} verified=${stats.verified} rejected=${stats.rejected} both=${stats.both} llmOnly=${stats.llmOnly} conflicts=${stats.conflicts}`);
  }
  writeFileSync(resolve(outDir, 'would-retry-summaries.jsonl'), `${summaryRows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
  writeFileSync(resolve(outDir, 'extraction-accounting.json'), `${JSON.stringify({
    schema: 'grounded-extractor-accounting/v1',
    generatedAt: new Date().toISOString(),
    promptVersion: EXTRACTOR_PROMPT_VERSION,
    model,
    budget: { estSpentCny: budget.spentCny, calls: budget.calls, byModel: budget.byModel, maxCostCny: budget.maxCostCny },
    samples: accounting,
  }, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ outDir, samples: summaryRows.length, budget: { estSpentCny: budget.spentCny, calls: budget.calls } }, null, 2));
}

if (process.argv[1] && import.meta.url === `file:///${process.argv[1].replace(/\\/gu, '/')}`) {
  main().catch((error) => {
    console.error(`[grounded-extractor] FATAL: ${error.stack ?? error}`);
    process.exit(1);
  });
}