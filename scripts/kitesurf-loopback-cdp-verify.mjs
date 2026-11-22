#!/usr/bin/env node
/**
 * Read the Kitesurf loopback receipt and check it against the current source.
 * The receipt is agent-written behavior evidence. This script rejects a receipt
 * that claims a live engine, a remote browser, or a source tree it did not hash.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RECEIPT = path.join(ROOT, 'harness/specs/fixtures/kitesurf-loopback-cdp/receipt.json');
const VERIFY = path.join(ROOT, 'harness/specs/fixtures/kitesurf-loopback-cdp/verify.json');
const REQUIRED_METHODS = ['navigate', 'screenshot', 'extractPageText', 'close', 'status'];
const BANNED_METHODS = ['uploadFiles', 'downloadFile', 'semanticRead'];

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

async function main() {
  const checks = [];
  const ok = (name, passed) => checks.push({ name, ok: passed });
  const receipt = JSON.parse(await readFile(RECEIPT, 'utf8'));
  const sourceHashes = receipt.sourceHashes ?? {};

  ok('schema', receipt.schema === 'clawx.kitesurf-loopback-cdp/v2');
  ok('agent attribution', receipt.driven_by === 'agent' && receipt.actor === 'codex');
  ok('protocol receipt does not claim a real engine', receipt.liveEngine === false);
  ok('protocol test hash matches current assertions', receipt.testSourceHash === sha256(await readFile(path.join(ROOT, 'packages/versebrowser/tests/kitesurf-cdp.test.ts'))));
  ok('remote Browser Run not claimed', receipt.remoteBrowserRun === false);
  ok('desktop rejected before a window', receipt.observations?.desktopRejectedBeforeWindow === true);
  ok('remote and non-kitesurf endpoints did not connect', receipt.observations?.connectCallsAfterRejection === 0);
  ok('session recorded the kitesurf engine', receipt.observations?.sessionEngine === 'kitesurf');
  ok('evaluate is served by the native engine', receipt.observations?.evaluateCallsAfterAutoDetect === 1);
  ok('screenshot ran on an explicit kitesurf session', receipt.observations?.screenshotCallsAfterAttach === 1);
  ok('auto-detected kitesurf serves evaluate', receipt.observations?.evaluateCallsAfterAutoDetect === 1);
  for (const observation of ['versionIdentity', 'allLoopbackFamilies', 'nativeProfileMatchesAdapter', 'probedBeforeConnect', 'statusSynchronous', 'restoredUnsupportedActionBlockedBeforeConnect', 'restoredIdentityRevalidated', 'chromiumFallbackOnProbeFailure', 'noChromiumResourcesCreated', 'cliFlagForwarded', 'cliAutoDetectForwarded']) {
    ok(observation, receipt.observations?.[observation] === true);
  }
  ok('file and AI capabilities stay separately gated', JSON.stringify(receipt.observations?.bannedActions) === JSON.stringify(['uploadFiles', 'downloadFile', 'semanticRead']));
  const live = JSON.parse(await readFile(path.join(ROOT, 'harness/specs/fixtures/kitesurf-loopback-cdp/live.json'), 'utf8'));
  const actions = JSON.parse(await readFile(path.join(ROOT, 'harness/specs/fixtures/kitesurf-loopback-cdp/actions.json'), 'utf8'));
  ok('real engine receipt is agent-driven', live.driven_by === 'agent' && live.actor === 'codex');
  ok('real engine identity and pinned upstream', live.engine === 'Kitesurf/0.0.1' && live.upstreamRevision === '4a2903813a22b08d4f3cc64a4b35339d0293a5d1');
  const cliSteps = ['engine-identity', 'missing-endpoint-rejected', 'remote-endpoint-rejected', 'misidentified-endpoint-and-failed-open-cleanup', 'control-auth', 'open', 'cross-process-snapshot', 'cross-process-screenshot', 'pdf', 'pdf-path-escape-rejected', 'cross-process-navigation-console-verify', 'public-page-navigation-and-read', 'close-removes-worker-and-session', 'closed-session-reuse-rejected', 'auto-detected-cross-process-session', 'auto-detected-navigation-and-verify', 'auto-detected-close-and-cleanup'];
  ok('live CLI executes the complete acceptance flow', live.schema === 'clawx.kitesurf-loopback-cdp-live/v2' && live.liveEngine === true && live.steps?.length === cliSteps.length && cliSteps.every(name => live.steps.some(step => step.name === name && step.ok === true)));
  const actionChecks = ['input-and-key-effects', 'checkbox-and-select-effects', 'pointer-and-click-effects', 'drag-gesture-effects', 'form-values-validation-and-redaction', 'label-ref-acts-on-exact-input', 'test-id-ref-duplicate-and-stale-guards', 'fresh-facade-native-routing', 'script-and-console-observation', 'runtime-readonly-unavailable-before-page-read', 'network-details-body-and-redaction', 'multi-page-create-select-close-and-continue', 'same-origin-frame-and-foreign-scope-rejection', 'unnamed-frame-identity', 'snapshot-text-and-real-exports', 'public-egress-and-private-network-policy', 'control-auth-and-session-ownership', 'file-ai-and-unknown-method-rejection', 'dialog-limit-and-identity-guard', 'action-timeout-closes-worker'];
  ok('real action receipt contains asserted behavior rather than labels', actions.schema === 'clawx.kitesurf-loopback-cdp-actions/v5' && actions.driven_by === 'agent' && actions.actor === 'codex' && actions.liveEngine === true && actions.remoteBrowserRun === false && actions.checks?.length === actionChecks.length && actionChecks.every(name => actions.checks.some(check => check.name === name && check.ok === true)));
  ok('live receipt matches the same source', JSON.stringify(live.sourceHashes) === JSON.stringify(receipt.sourceHashes));
  ok('real action receipt matches the same source', JSON.stringify(actions.sourceHashes) === JSON.stringify(receipt.sourceHashes));
  ok('real action test hash matches current assertions', actions.testSourceHash === sha256(await readFile(path.join(ROOT, 'packages/versebrowser/tests/kitesurf-live.test.ts'))));
  ok('CLI verifier hash matches current assertions', live.scriptHash === sha256(await readFile(path.join(ROOT, 'scripts/kitesurf-live-verify.mjs'))));
  ok('CLI executable hash matches the tested build', live.cliHash === sha256(await readFile(path.join(ROOT, 'packages/versebrowser/dist/cli.js'))));

  const service = await readFile(path.join(ROOT, 'packages/versebrowser/src/engine/service.ts'), 'utf8');
  ok('desktop open rejects the kitesurf field', service.includes('if (payload.browser !== undefined)') && service.includes('desktop managed sessions stay on the browser-window engine'));

  const kite = await readFile(path.join(ROOT, 'packages/versebrowser/src/engine/kitesurf-cdp.ts'), 'utf8');
  const setMatch = kite.match(/export const KITESURF_METHODS = new Set\(\[([\s\S]*?)\]\);/);
  const methods = setMatch ? [...setMatch[1].matchAll(/'([^']+)'/g)].map((match) => match[1]) : [];
  ok('native method list is present', REQUIRED_METHODS.every((method) => methods.includes(method)));
  ok('file and AI methods stay out of the native Kitesurf list', BANNED_METHODS.every((method) => !methods.includes(method)));
  ok('unsupported bounded runtime inspection is not advertised', !methods.includes('runtimeInspectGlobals'));
  const executed = new Set(actions.calls?.map(call => call.method) ?? []);
  ok('every declared native method has an actual recorded call', methods.every(method => executed.has(method)));

  const host = await readFile(path.join(ROOT, 'packages/versebrowser/src/engine/playwright-host-api.ts'), 'utf8');
  ok('attach probes loopback and records the engine', host.includes('assertKitesurfLoopback') && host.includes("engine: 'kitesurf'") && host.includes('assertKitesurfMethod'));

  const hashes = receipt.sourceHashes ?? {};
  const hashFiles = [
    'packages/versebrowser/src/engine/kitesurf-cdp.ts',
    'packages/versebrowser/src/engine/service.ts',
    'packages/versebrowser/src/engine/playwright-host-api.ts',
    'packages/versebrowser/src/engine/persistent-sessions.ts',
    'packages/versebrowser/src/cli.ts',
    'packages/versebrowser/src/types/host-api.ts',
    'packages/versebrowser/src/engine/kitesurf-session.ts',
    'packages/versebrowser/src/engine/upstream-control.ts',
    'packages/versebrowser/src/engine/facade.ts',
    'packages/versebrowser/src/engine/driver-profile.ts',
    'packages/versebrowser/src/evidence/output.ts',
    'scripts/kitesurf-local-runtime.mjs',
    'pnpm-workspace.yaml',
    'scripts/contract-check.mjs',
    'vitest.agent-dev.node.config.ts',
    'scripts/typecheck-agent-dev.mjs',
    'tests/unit/typecheck-gate.test.ts',
  ];
  let hashesMatch = hashFiles.every((file) => typeof hashes[file] === 'string');
  for (const file of hashFiles) {
    const current = sha256(await readFile(path.join(ROOT, file), 'utf8'));
    if (hashes[file] !== current) hashesMatch = false;
  }
  ok('receipt hashes match the current source', hashesMatch);

  const failed = checks.filter((check) => !check.ok);
  const report = {
    schema: 'clawx.kitesurf-loopback-cdp-verify/v1',
    ok: failed.length === 0,
    driven_by: 'agent',
    actor: 'codex',
    liveEngine: true,
    remoteBrowserRun: false,
    checks,
  };
  await writeFile(VERIFY, `${JSON.stringify(report, null, 2)}\n`);
  if (failed.length > 0) {
    for (const check of failed) console.error(check.name);
    process.exitCode = 1;
    return;
  }
  console.log(`verified ${checks.length} checks`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
