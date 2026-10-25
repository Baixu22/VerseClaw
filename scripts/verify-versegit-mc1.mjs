#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isMainEntrypoint } from './lib/entrypoint.mjs';
import { loadConsumerContract, validateConsumerContract, validateReceiptEnvelope, validateReportEnvelope } from './versegit-mc1-contract.mjs';

function main() {
  const artifactIndex = process.argv.indexOf('--artifact');
  const artifact = artifactIndex >= 0
    ? resolve(process.argv[artifactIndex + 1])
    : resolve(process.cwd(), 'harness/specs/fixtures/versegit-planning-correction/mc1-evidence/contract.json');
  if (!existsSync(artifact)) {
    console.error(`[versegit-mc1] FAIL: artifact missing: ${artifact}`);
    process.exitCode = 1;
    return;
  }
  const frozen = JSON.parse(readFileSync(artifact, 'utf8'));
  const live = loadConsumerContract();
  const issues = [];
  issues.push(...validateConsumerContract(frozen).issues);
  if (JSON.stringify(frozen) !== JSON.stringify(live)) issues.push('frozen contract differs from live contract');
  const sampleReport = {
    schema: 'clawx.versegit.module-report/v1',
    authority: { harnessVerdict: 'host', execution: 'verseshell', land: 'host-git' },
    result: { status: 'observed' },
    verification: { executor: 'verseshell' },
  };
  issues.push(...validateReportEnvelope(sampleReport).issues);
  const sampleReceipt = {
    planId: 'plan', planDigest: 'digest', candidateId: 'candidate', checkId: 'check', ownerId: 'owner', epoch: 1,
    authorizationId: 'auth', argvDigest: 'argv', cwdDigest: 'cwd', envDigest: 'env', executionInputDigest: 'input',
    requiredScope: 'full', artifactDigests: ['sha256:artifact'], cleanupStatus: 'clean',
  };
  issues.push(...validateReceiptEnvelope(sampleReceipt).issues);
  const badStatus = structuredClone(sampleReport);
  badStatus.result.status = 'stale';
  if (validateReportEnvelope(badStatus).ok) issues.push('reason status was accepted as top-level status');
  const badReceipt = { ...sampleReceipt, requiredScope: 'selected' };
  if (validateReceiptEnvelope(badReceipt).ok) issues.push('selected receipt was accepted as full');
  if (issues.length > 0) {
    for (const issue of issues) console.error(`[versegit-mc1] FAIL: ${issue}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[versegit-mc1] OK contract=${artifact}`);
}

if (isMainEntrypoint(import.meta.url)) main();