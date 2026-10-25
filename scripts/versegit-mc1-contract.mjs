#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainEntrypoint } from './lib/entrypoint.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const MC1_CONTRACT_SCHEMA = 'clawx.versegit.consumer-contract/v1';

export function validateConsumerContract(contract) {
  const issues = [];
  if (contract?.schema !== MC1_CONTRACT_SCHEMA) issues.push(`contract schema must be ${MC1_CONTRACT_SCHEMA}`);
  if (contract?.owner !== 'TF-0474') issues.push('contract owner must be TF-0474');
  const modes = contract?.modes ?? [];
  for (const mode of ['M0', 'M1', 'M2', 'M3']) if (!modes.includes(mode)) issues.push(`missing mode ${mode}`);
  for (const [mode, permission] of Object.entries(contract?.permissions ?? {})) {
    if (mode === 'M0' && (permission.start_process || permission.write_workspace || permission.write_domain_state || permission.execute)) issues.push('M0 must have no effects');
    if (mode === 'M1' && (permission.write_workspace || permission.write_domain_state || permission.execute)) issues.push('M1 must not write or execute');
    if (mode === 'M2' && (permission.write_workspace || permission.execute)) issues.push('M2 must not write workspace or execute');
    if (mode === 'M3' && permission.execute !== 'via_verseshell_only') issues.push('M3 execution must be via VerseShell only');
  }
  const report = contract?.surface?.module_report;
  const plan = contract?.surface?.command_plan;
  const receipt = contract?.surface?.execution_receipt;
  for (const [name, surface] of Object.entries({ module_report: report, command_plan: plan, execution_receipt: receipt })) {
    if (!surface) issues.push(`missing surface ${name}`);
    if (surface && !surface.schema) issues.push(`surface ${name} schema missing`);
  }
  if (!receipt?.required?.includes('planDigest')) issues.push('receipt must bind planDigest');
  if (!receipt?.required?.includes('authorizationId')) issues.push('receipt must bind authorizationId');
  if (!receipt?.required?.includes('artifactDigests')) issues.push('receipt must bind artifactDigests');
  if (!receipt?.forbidden_claims?.includes('selected_as_full')) issues.push('receipt must reject selected_as_full');
  if (contract?.import_policy?.deep_import_allowed !== false) issues.push('deep imports must be forbidden');
  if (!contract?.import_policy?.forbidden_internal_imports?.includes('vg_kernel')) issues.push('vg_kernel import must be forbidden');
  const expectedFailures = {
    missing_binary: 'unavailable',
    schema_mismatch: 'rejected_by_policy',
    missing_receipt: 'unmeasured',
    partial_coverage: 'partial',
    unknown_owner: 'rejected_by_policy',
    timeout: 'degraded',
  };
  for (const [key, status] of Object.entries(expectedFailures)) {
    if (contract?.failure_contract?.[key] !== status) issues.push(`failure_contract.${key} must be ${status}`);
  }
  return { ok: issues.length === 0, issues };
}

export function validateReportEnvelope(report) {
  const issues = [];
  const allowedStatuses = new Set(['not_applicable', 'unavailable', 'partial', 'observed', 'degraded', 'rejected_by_policy']);
  if (report?.schema !== 'clawx.versegit.module-report/v1') issues.push('report schema mismatch');
  if (!allowedStatuses.has(report?.result?.status)) issues.push('report result.status is not an allowed top-level status');
  if (report?.authority?.harnessVerdict !== 'host') issues.push('report must keep harness verdict with host');
  if (report?.authority?.execution !== 'verseshell') issues.push('report must keep execution with VerseShell');
  if (report?.authority?.land !== 'host-git') issues.push('report must keep land with host Git');
  if (report?.verification?.executor !== 'verseshell') issues.push('verification executor must be VerseShell');
  return { ok: issues.length === 0, issues };
}

export function validateReceiptEnvelope(receipt) {
  const required = ['planId', 'planDigest', 'candidateId', 'checkId', 'ownerId', 'epoch', 'authorizationId', 'argvDigest', 'cwdDigest', 'envDigest', 'executionInputDigest', 'requiredScope', 'artifactDigests', 'cleanupStatus'];
  const issues = required.filter((field) => receipt?.[field] === undefined).map((field) => `receipt missing ${field}`);
  if (receipt?.requiredScope === 'selected') issues.push('selected receipt cannot claim full admission');
  if (receipt?.callerSelfReport === true) issues.push('caller self-report is not a receipt');
  return { ok: issues.length === 0, issues };
}

export function loadConsumerContract(path = resolve(repositoryRoot, 'harness/specs/fixtures/versegit-planning-correction/mc1-consumer-contract.json')) {
  if (!existsSync(path)) throw new Error(`missing contract: ${path}`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function writeContractSnapshot({ output } = {}) {
  const contract = loadConsumerContract();
  const result = validateConsumerContract(contract);
  const path = output ?? resolve(repositoryRoot, 'harness/specs/fixtures/versegit-planning-correction/mc1-evidence/contract.json');
  if (!result.ok) return { ok: false, issues: result.issues, path: null };
  return { ok: true, issues: [], path, contract };
}

async function main() {
  const outputIndex = process.argv.indexOf('--out');
  const output = outputIndex >= 0 ? resolve(process.argv[outputIndex + 1]) : undefined;
  const contract = loadConsumerContract();
  const validation = validateConsumerContract(contract);
  if (!validation.ok) {
    for (const issue of validation.issues) console.error(`[versegit-mc1] FAIL: ${issue}`);
    process.exitCode = 1;
    return;
  }
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const path = output ?? resolve(repositoryRoot, 'harness/specs/fixtures/versegit-planning-correction/mc1-evidence/contract.json');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(contract, null, 2)}\n`, 'utf8');
  console.log(`[versegit-mc1] OK contract=${path}`);
}

if (isMainEntrypoint(import.meta.url)) {
  main().catch((error) => {
    console.error(`[versegit-mc1] FAIL: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}