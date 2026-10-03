#!/usr/bin/env node
/**
 * Shared LLM utilities for the v8 optimization scripts (handoff benchmark,
 * grounded extractor, optimization loop). Env contract identical to
 * eval-runner: COMPACTION_BASE_URL, COMPACTION_PROVIDER, COMPACTION_API_KEY,
 * COMPACTION_REQUEST_DELAY_MS, COMPACTION_MAX_ATTEMPTS,
 * COMPACTION_REQUEST_TIMEOUT_MS, COMPACTION_EXTRA_HEADERS,
 * COMPACTION_OMIT_RESPONSE_FORMAT.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { extractJsonObject } from './context-compression-json-repair.mjs';

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

export function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

export function collapseWhitespace(value) {
  return String(value ?? '').replace(/\s+/gu, ' ').trim();
}

/** CJK-aware tokenization: Latin/digit identifier runs + CJK bigrams. */
export function normalizeTokens(text) {
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
export function tokenOverlap(a, b) {
  const left = normalizeTokens(a);
  const right = normalizeTokens(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / Math.min(left.size, right.size);
}

/**
 * Polarity guard: count negation cues (EN + CJK). Token-overlap scoring is
 * blind to negation flips ("do not bump" vs "always bump"), so deterministic
 * verdicts require equal negation-cue counts on both sides.
 */
export function negationCueCount(text) {
  const value = String(text ?? '').toLowerCase();
  const english = value.match(/\b(no|not|don't|doesn't|didn't|won't|can't|cannot|never|must not|mustn't|avoid|refused|rejected)\b/gu)?.length ?? 0;
  const cjk = value.match(/(禁止|不得|不要|不可|不能|勿|别|未|没有|拒绝|否决|非)/gu)?.length ?? 0;
  return english + cjk;
}

// Conservative CNY-per-1M-token estimates used ONLY for budget guards.
const PRICE_ESTIMATES_CNY_PER_M = {
  'qwen-flash': { input: 0.3, output: 1.2 },
  'qwen-turbo': { input: 0.3, output: 0.6 },
  'qwen-plus-latest': { input: 0.8, output: 2.0 },
  'qwen-plus': { input: 0.8, output: 2.0 },
};

export function estimateCostCny(model, usage) {
  const price = PRICE_ESTIMATES_CNY_PER_M[model] ?? { input: 1.0, output: 3.0 };
  const inputTokens = Number(usage?.prompt_tokens ?? 0);
  const outputTokens = Number(usage?.completion_tokens ?? 0);
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

export function providerConfig() {
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

export class BudgetLedger {
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

export class DiskCache {
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

export function requestTunables() {
  return {
    maxAttempts: Number(process.env.COMPACTION_MAX_ATTEMPTS ?? 6),
    requestDelayMs: Number(process.env.COMPACTION_REQUEST_DELAY_MS ?? 4000),
    requestTimeoutMs: Number(process.env.COMPACTION_REQUEST_TIMEOUT_MS ?? 8 * 60 * 1000),
  };
}

export async function fetchJson({ baseUrl, apiKey, model, system, user, purpose, sampleId, transport, maxTokens = 8000, temperature = 0 }) {
  const { maxAttempts, requestDelayMs, requestTimeoutMs } = requestTunables();
  const fetchImpl = transport ?? fetch;
  let lastError;
  if (requestDelayMs > 0) await delay(requestDelayMs);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const abortController = new AbortController();
      const timer = setTimeout(() => abortController.abort(), requestTimeoutMs);
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
          max_tokens: maxTokens,
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
        lastError = new Error(`llm-shared ${purpose} ${sampleId ?? ''} HTTP ${response.status}${errorBody ? ` (${errorBody.slice(0, 160)})` : ''}`);
        const retryable = response.status === 429 || response.status >= 500;
        if (retryable && attempt < maxAttempts) {
          let waitMs = response.status === 429 ? Math.min(2000 * 2 ** (attempt - 1), 60000) : 750 * attempt;
          if (response.status === 429) {
            const resetEpoch = Number(response.headers?.get?.('x-ratelimit-reset'));
            const retryAfterSeconds = Number(response.headers?.get?.('retry-after'));
            const untilResetMs = Number.isFinite(resetEpoch) && resetEpoch > 0
              ? resetEpoch * 1000 - Date.now() + 5000
              : (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? retryAfterSeconds * 1000 + 1000 : Number.NaN);
            if (Number.isFinite(untilResetMs) && untilResetMs > waitMs && untilResetMs <= 45 * 60 * 1000) waitMs = untilResetMs;
          }
          console.error(`[llm] retrying ${purpose} ${sampleId ?? ''} in ${Math.round(waitMs / 1000)}s (attempt ${attempt})`);
          await delay(waitMs);
          continue;
        }
        throw lastError;
      }
      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) {
        lastError = new Error(`llm-shared ${purpose} ${sampleId ?? ''} empty content`);
        if (attempt < maxAttempts) { await delay(750 * attempt); continue; }
        throw lastError;
      }
      try {
        extractJsonObject(content);
      } catch (error) {
        lastError = error;
        if (attempt < maxAttempts) { await delay(750 * attempt); continue; }
        throw lastError;
      }
      return data;
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) { await delay(750 * attempt); continue; }
      throw lastError;
    }
  }
  throw lastError;
}