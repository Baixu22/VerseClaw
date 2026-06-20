// c:\Users\27933\Desktop\clawx\ClawX\resources\openclaw-plugins\clawx-enhance\smoke-test.js
//
// ClawX Pico 烟测：验证 judgment-only ContextEngine 的判断逻辑 +
// SDK 集成 (registerContextEngine / delegateCompactionToRuntime)
//
// 跑法：在本目录下 `node smoke-test.js`

'use strict';
const path = require('node:path');
const assert = require('node:assert/strict');
const { judgeCompression, DEFAULTS } = require('./compression-judge.js');

let passed = 0, failed = 0;
function section(title) { console.log(`\n──── ${title} ────`); }
function ok(name) { passed++; console.log(`  ✅ ${name}`); }
function fail(name, e) { failed++; console.log(`  ❌ ${name}: ${e?.message || e}`); }
function run(name, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => ok(name))
    .catch((e) => fail(name, e));
}

(async () => {
  section('1. judgeCompression — boundary conditions');
  await run('1a. too few older messages → skip', () => {
    const d = judgeCompression({ messageCount: 5, tokenCount: 90000, tokenBudget: 100000, freshTailSize: 32 });
    assert.equal(d.shouldCompress, false);
    assert.match(d.reason, /too-few-older-messages/);
  });
  await run('1b. token budget unknown → skip', () => {
    const d = judgeCompression({ messageCount: 50, tokenCount: 90000, tokenBudget: 0, freshTailSize: 32 });
    assert.equal(d.shouldCompress, false);
    assert.equal(d.reason, 'token-budget-unavailable');
  });
  await run('1c. below ratio threshold → skip', () => {
    const d = judgeCompression({ messageCount: 50, tokenCount: 50000, tokenBudget: 100000, freshTailSize: 32 });
    assert.equal(d.shouldCompress, false);
    assert.match(d.reason, /below-threshold/);
  });
  await run('1d. high ratio + enough older msgs → trigger', () => {
    const d = judgeCompression({ messageCount: 50, tokenCount: 90000, tokenBudget: 100000, freshTailSize: 32 });
    assert.equal(d.shouldCompress, true);
    assert.match(d.reason, /trigger:/);
  });
  await run('1e. debounce blocks within 60s', () => {
    const now = 1_000_000_000;
    const d = judgeCompression({
      messageCount: 50, tokenCount: 90000, tokenBudget: 100000,
      freshTailSize: 32, lastCompressionAt: now - 10_000, nowMs: now,
    });
    assert.equal(d.shouldCompress, false);
    assert.match(d.reason, /debounce/);
  });
  await run('1f. debounce allows after window', () => {
    const now = 1_000_000_000;
    const d = judgeCompression({
      messageCount: 50, tokenCount: 90000, tokenBudget: 100000,
      freshTailSize: 32, lastCompressionAt: now - 90_000, nowMs: now,
    });
    assert.equal(d.shouldCompress, true);
  });
  await run('1g. older-token floor blocks light context (with ratio above threshold)', () => {
    // 50 msgs, 18 older, tokenCount=80000 (80% ratio) — passes ratio check,
    // but older token estimate = 80000 * 18/50 = 28800, still above floor.
    // Drop tokenCount so older estimate lands below 20000 floor while ratio
    // stays above 75%.
    //   ratio = T/B = 0.8  →  T=80000, B=100000
    //   older  = (T - tail) where tail is freshTail * (T / total) = 32*(80000/50)=51200
    //   older  = 80000 - 51200 = 28800 (above floor)
    // To test the floor we need: ratio >= trigger AND older < minOlderTokens.
    // Lower the message count to 50, freshTail 40, T=80000, B=100000
    //   olderCount = 50 - 40 = 10
    //   olderTokenEstimate = 80000 * 10/50 = 16000  (below floor)
    //   ratio = 0.8 (above 0.75)
    const d = judgeCompression({ messageCount: 50, tokenCount: 80000, tokenBudget: 100000, freshTailSize: 40 });
    assert.equal(d.shouldCompress, false);
    assert.match(d.reason, /older-tokens-too-low/);
  });
  await run('1h. ratio 99% overrides older-token floor', () => {
    const d = judgeCompression({ messageCount: 50, tokenCount: 99000, tokenBudget: 100000, freshTailSize: 40 });
    assert.equal(d.shouldCompress, true);
  });
  await run('1i. config overrides take effect (no floor on low older-tok)', () => {
    // minMessages=1, freshTail=4 → older=1, total=5, ratio=90%
    // olderTokenEstimate = 90000*1/5 = 18000 < 20000  →  floor blocks
    // turn off the floor via config to prove the override path
    const d = judgeCompression({
      messageCount: 50, tokenCount: 80000, tokenBudget: 100000, freshTailSize: 40,
      config: { minOlderTokens: 0, minMessagesToCompress: 1, freshTailSize: 49 },
    });
    assert.equal(d.shouldCompress, true);
  });
  await run('1j. DEFAULTS are sane', () => {
    assert.equal(DEFAULTS.triggerRatio, 0.75);
    assert.equal(DEFAULTS.freshTailSize, 32);
    assert.equal(DEFAULTS.minMessagesToCompress, 8);
    assert.equal(DEFAULTS.debounceMs, 60000);
  });

  section('2. SDK exports — registerContextEngine / delegateCompactionToRuntime');
  let sdk, reg, delegate;
  await run('2a. openclaw/plugin-sdk importable', async () => {
    // Try the published name first, then a few common locations.
    const candidates = [
      'openclaw/plugin-sdk',
      'openclaw-plugin-sdk',
      '../../../../node_modules/openclaw-plugin-sdk',
    ];
    let lastErr;
    for (const name of candidates) {
      try { sdk = await import(name); break; } catch (e) { lastErr = e; }
    }
    if (!sdk) throw lastErr || new Error('openclaw sdk not found');
  });
  await run('2b. registerContextEngine is a function', () => {
    assert.equal(typeof sdk.registerContextEngine, 'function');
    reg = sdk.registerContextEngine;
  });
  await run('2c. delegateCompactionToRuntime is a function', () => {
    assert.equal(typeof sdk.delegateCompactionToRuntime, 'function');
    delegate = sdk.delegateCompactionToRuntime;
  });

  section('3. ContextEngine shape — clawx-pico factory');
  // Build a minimal factory that mirrors index.js (avoids spinning up the whole plugin)
  const { EventEmitter } = require('node:events');
  const messages = Array.from({ length: 50 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'x'.repeat(2000) }));
  const makeClawxPicoEngine = () => ({
    info: { id: 'clawx-pico', name: 'ClawX Pico', version: '1.0.0', ownsCompaction: false, turnMaintenanceMode: 'foreground' },
    async assemble(p) { return { messages: p.messages, estimatedTokens: 0 }; },
    async ingest(_) { return { ingested: true }; },
    async ingestBatch(p) { return { ingestedCount: (p.messages || []).length }; },
    async maintain(_) { return { changed: false, bytesFreed: 0, rewrittenEntries: 0 }; },
    async afterTurn(_) {},
    async compact(p) {
      const decision = judgeCompression({
        messageCount: (p.messages || messages).length,
        tokenCount: p.currentTokenCount || 0,
        tokenBudget: p.tokenBudget || 0,
        freshTailSize: 32,
      });
      if (!decision.shouldCompress) {
        return { ok: true, compacted: false, reason: `pico-skip: ${decision.reason}` };
      }
      return { ok: true, compacted: true, reason: 'pico-judge-ok', result: { tokensBefore: p.currentTokenCount, tokensAfter: 1000, summary: 'mock summary' } };
    },
  });

  await run('3a. registerContextEngine accepts factory', () => {
    const result = reg('clawx-pico', makeClawxPicoEngine);
    assert.deepEqual(result, { ok: true });
  });
  await run('3b. engine shape satisfies ContextEngine contract', () => {
    const engine = makeClawxPicoEngine();
    assert.ok(engine.info);
    assert.equal(typeof engine.assemble, 'function');
    assert.equal(typeof engine.ingest, 'function');
    assert.equal(typeof engine.compact, 'function');
    assert.equal(typeof engine.maintain, 'function');
    assert.equal(typeof engine.afterTurn, 'function');
  });
  await run('3c. compact() with low pressure returns no-op', async () => {
    const engine = makeClawxPicoEngine();
    const r = await engine.compact({ sessionKey: 't', sessionId: 't', sessionFile: '/tmp/x', messages, tokenBudget: 100000, currentTokenCount: 5000 });
    assert.equal(r.ok, true);
    assert.equal(r.compacted, false);
    assert.match(r.reason, /pico-skip/);
  });
  await run('3d. compact() with high pressure returns judge-ok', async () => {
    const engine = makeClawxPicoEngine();
    const r = await engine.compact({ sessionKey: 't', sessionId: 't', sessionFile: '/tmp/x', messages, tokenBudget: 100000, currentTokenCount: 90000 });
    assert.equal(r.ok, true);
    assert.equal(r.compacted, true);
    assert.equal(r.reason, 'pico-judge-ok');
  });
  await run('3e. delegateCompactionToRuntime is exposed as async function', () => {
    // Do NOT invoke it here — the host config may have unrelated validation
    // errors (e.g. a stray mcp.clawx entry in the user's openclaw.json).
    // We only assert the export shape, which is what clawx-enhance relies on.
    assert.equal(typeof sdk.delegateCompactionToRuntime, 'function');
    assert.equal(sdk.delegateCompactionToRuntime.constructor.name, 'AsyncFunction');
  });

  console.log(`\n=== TOTAL: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
})();
