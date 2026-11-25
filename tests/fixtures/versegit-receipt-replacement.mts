import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';
const require = createRequire(import.meta.url);
const { createVerseGitCompletionStore } = require('../../electron/services/versegit-lifecycle.ts') as typeof import('../../electron/services/versegit-lifecycle.ts');
const { createVerseGitCleanupBarrier, cleanupInventoryFromResources } = require('../../shared/versegit-cleanup-barrier.ts') as typeof import('../../shared/versegit-cleanup-barrier.ts');
const [mode, root] = process.argv.slice(2);
assert(root && (mode === 'completion' || mode === 'cleanup'));

function failReplacement(update: () => unknown): void {
  const original = fs.renameSync;
  let injected = false;
  fs.renameSync = () => { injected = true; throw Object.assign(new Error('injected replacement failure'), { code: 'EACCES' }); };
  syncBuiltinESMExports();
  try { assert.throws(update, /injected replacement failure/); }
  finally { fs.renameSync = original; syncBuiltinESMExports(); }
  assert(injected);
}

if (mode === 'completion') {
  const store = createVerseGitCompletionStore(root);
  const identity = { ownerId: 'owner', epoch: 7, authorizationId: 'auth', sessionId: 'session', runId: 'run',
    candidateId: 'candidate', candidateTreeOid: 'a'.repeat(40), candidateInputDigest: 'b'.repeat(64),
    receiptDigest: 'c'.repeat(64), effectId: 'effect' };
  const original = store.record({ identity, hostOutcome: 'unknown', idempotencyKey: 'pending', actor: 'codex' });
  const before = store.read(identity.sessionId);
  const update = { identity, hostOutcome: 'applied' as const, idempotencyKey: 'resolved', actor: 'codex', recoveryOf: original.fact!.factId };
  failReplacement(() => store.record(update));
  const reopened = createVerseGitCompletionStore(root);
  assert.deepEqual(reopened.read(identity.sessionId), before);
  assert.equal(reopened.record({ identity: { ...identity, epoch: 6 }, hostOutcome: 'not_applied', idempotencyKey: 'stale', actor: 'codex' }).reason, 'late_epoch');
  assert.equal(reopened.record(update).status, 'recorded');
  assert.equal(reopened.read(identity.sessionId)?.revision, 2);
} else {
  const identity = { ownerId: 'owner', epoch: 7, authorizationId: 'auth', baseOid: 'a'.repeat(40), refsDigest: 'sha256:' + 'b'.repeat(64) };
  const resources = [{ kind: 'manager' as const, id: 'manager', target: 'session', owned: true, preserve: false }];
  const store = createVerseGitCleanupBarrier(root);
  const sealed = store.seal({ runId: 'run', sessionId: 'session', bindingId: 'binding', actor: 'codex',
    expected: identity, current: identity, references: [], evidenceDigests: ['sha256:' + 'c'.repeat(64)],
    inventoryBefore: cleanupInventoryFromResources(resources), resources, deletedKinds: ['manager'], stopAccepting: true, drain: { ok: true, issues: [] } });
  assert(sealed.ok);
  const before = store.read('run');
  const update = { runId: 'run', sealId: sealed.sealId!, current: identity, vgDetached: true };
  failReplacement(() => store.markDetached(update));
  const reopened = createVerseGitCleanupBarrier(root);
  assert.deepEqual(reopened.read('run'), before);
  assert(reopened.markDetached(update).ok);
  assert.equal(reopened.read('run')?.status, 'detached');
}
console.log(JSON.stringify({ mode, preserved: true, retried: true }));
