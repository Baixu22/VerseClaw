#!/usr/bin/env node
/** Verifies TF-0568 adapter pilot evidence integrity. Does not start adapters. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const FIXTURE = path.join(ROOT, 'harness/specs/fixtures/harness-codex-adapter-pilot');
const read = (name) => readFileSync(path.join(FIXTURE, name), 'utf8');
const receipt = JSON.parse(read('acceptance.json'));
const failures = [];
if (receipt.schemaVersion !== 'HarnessAdapterPilotAcceptance/v1') failures.push('schemaVersion');
if (receipt.driven_by !== 'agent') failures.push('driven_by');
if (receipt.node !== 'TF-0568') failures.push('node');
if (receipt.protocol?.protocolOk !== true) failures.push('protocolOk');
if (receipt.protocol?.protocolVersion !== 1) failures.push('protocolVersion');
if (receipt.protocol?.agentInfo?.name !== 'codex-acp') failures.push('agentInfo');
if (!Array.isArray(receipt.protocol?.authMethods) || receipt.protocol.authMethods.length < 3) failures.push('authMethods');
if (!/no turn|no fallback|AUTH_REQUIRED/i.test(receipt.failClosed?.acpxCodex ?? '')) failures.push('failClosed');
if (receipt.opencodeBaseline?.binaryVersionExitCode !== 0) failures.push('opencodeVersion');
if (receipt.protocolLifecycle?.status !== 'pass') failures.push('protocolLifecycle');
if (receipt.modelTurn?.status !== 'fixture-only') failures.push('modelTurn');
if (receipt.productBoundary?.defaultChanged !== false) failures.push('defaultChanged');
if (receipt.productBoundary?.silentFallback !== false) failures.push('silentFallback');
if (receipt.productBoundary?.realHumanEvidence !== false) failures.push('realHumanEvidence');
const serialized = JSON.stringify(receipt);
if (/sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._-]+/.test(serialized)) failures.push('credential-like content');
const manifest = read('SHA256SUMS');
for (const name of ['acceptance.json','opencode-failure.log','REPORT.md','mock-acp-lifecycle.json']) {
  const hash = createHash('sha256').update(read(name)).digest('hex');
  if (!manifest.includes(hash + '  ' + name)) failures.push('manifest:' + name);
}
if (!existsSync(path.join(ROOT, 'shared/harness-adapter-contract.ts'))) failures.push('missing contract');
if (failures.length) { console.error(JSON.stringify({ ok: false, failures }, null, 2)); process.exit(1); }
console.log(JSON.stringify({ ok: true, node: receipt.node, protocolVersion: receipt.protocol.protocolVersion, authMethods: receipt.protocol.authMethods.length, opencodeVersion: receipt.identity.opencodeVersion, failClosed: receipt.failClosed }, null, 2));
