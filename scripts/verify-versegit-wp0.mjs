#!/usr/bin/env node
// WP0 verifier: rebuild the module contract from the live frozen binary and prove the
// stored contract still matches, that M0 starts nothing, that the read-only catalog digest
// recomputes, and that identity drift is rejected by policy instead of silently passing.
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { isMainEntrypoint } from './lib/entrypoint.mjs';
import {
  buildWp0Contract, evaluateGate, readOnlyToolCatalog, sha256, validateWp0Contract,
  SUPPORTED_CONTRACT_VERSIONS, SUPPORTED_CAPABILITIES_SCHEMAS, WP0_SCHEMA, WP0_ARTIFACTS,
} from './versegit-wp0-contract.mjs';

const root = process.env.VERSEGIT_WP0_ROOT ? resolve(process.env.VERSEGIT_WP0_ROOT) : resolve(process.cwd());
function at(flag) { const i = process.argv.indexOf(flag); return i >= 0 ? resolve(process.argv[i + 1]) : undefined; }

function probeCapabilities(binary, cwd) {
  const result = spawnSync(binary, ['capabilities', '--json'], { cwd, encoding: 'utf8', timeout: 60_000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) return null;
  try { return JSON.parse(String(result.stdout).trim()); } catch { return null; }
}

function main() {
  const artifact = at('--artifact') ?? resolve(root, 'harness/specs/fixtures/versegit-planning-correction/wp0-evidence/contract.json');
  if (!existsSync(artifact)) { console.error(`[versegit-wp0] FAIL: artifact missing: ${artifact}`); process.exitCode = 1; return; }
  const stored = JSON.parse(readFileSync(artifact, 'utf8'));
  const issues = [];
  issues.push(...validateWp0Contract(stored).issues);

  const live = buildWp0Contract({ root });
  issues.push(...validateWp0Contract(live).issues.map((issue) => `live: ${issue}`));
  if (live.contractSchema !== WP0_SCHEMA) issues.push('live contract schema drifted');
  for (const field of ['sha256', 'bytes', 'profile', 'platform', 'capabilities_schema', 'capabilities_digest', 'source_head', 'source_tree', 'consumer_contract_digest', 'golden_bundle_digest', 'sidecar_package_digest']) {
    if (stored.binary_identity?.[field] !== live.binary_identity?.[field]) issues.push(`binary identity drifted: ${field}`);
  }
  if (JSON.stringify(stored.version_matrix) !== JSON.stringify(live.version_matrix)) issues.push('the version matrix drifted from the live binary');
  if (stored.read_only_tool_catalog?.catalog_digest !== live.read_only_tool_catalog.catalog_digest) issues.push('the read-only catalog digest drifted');
  if (stored.status !== 'verified' || stored.gate?.passed !== true) issues.push(`the stored contract must be verified, got ${stored.status}`);
  if (live.status !== 'verified') issues.push(`the live contract must be verified, got ${live.status}`);
  if (stored.mode_resolution?.M0?.processes_started !== 0 || stored.mode_resolution?.M0?.attach !== false) issues.push('M0 must resolve to zero started processes');
  if (live.non_interference?.created_or_attached_session !== false || live.non_interference?.wrote_provider_state !== false) issues.push('the identity probe must not create sessions or write provider state');

  const mc0 = JSON.parse(readFileSync(resolve(root, WP0_ARTIFACTS.mc0), 'utf8'));
  const mc3 = JSON.parse(readFileSync(resolve(root, WP0_ARTIFACTS.mc3), 'utf8'));
  const capabilitiesDoc = probeCapabilities(resolve(String(mc0.binary.path)), mc0.source.repo);
  const capabilitiesDigest = capabilitiesDoc ? sha256(JSON.stringify(capabilitiesDoc)) : null;
  if (capabilitiesDigest !== live.binary_identity.capabilities_digest) issues.push('the recomputed capabilities digest differs from the live contract');

  const baseGate = { matrix: live.version_matrix, mc0, mc3, capabilities: capabilitiesDoc ?? { schema: null }, capabilitiesDigest, binaryExists: true };
  const okGate = evaluateGate(baseGate);
  if (!okGate.passed) issues.push(`a matching identity must pass the gate: ${okGate.failures.map((failure) => failure.case).join(',')}`);
  const drifted = evaluateGate({ ...baseGate, mc3: { ...mc3, identity: { ...mc3.identity, binary_sha256: 'f'.repeat(64) } } });
  if (drifted.passed || !drifted.failures.some((failure) => failure.case === 'binary_digest_mismatch' && failure.status === 'rejected_by_policy')) issues.push('a binary digest mismatch must be rejected by policy');
  const tooNew = evaluateGate({ ...baseGate, matrix: { ...live.version_matrix, ledger_schema_version: 99 } });
  if (!tooNew.failures.some((failure) => failure.case === 'ledger_schema_too_new')) issues.push('a too-new ledger schema must be refused');
  const badContract = evaluateGate({ ...baseGate, matrix: { ...live.version_matrix, consumer_contract_version: 'clawx.versegit.consumer-contract/v999' } });
  if (!badContract.failures.some((failure) => failure.case === 'contract_version_unsupported')) issues.push('an unsupported contract version must be refused');
  const badCapabilities = evaluateGate({ ...baseGate, capabilities: { schema: 'versegit.capabilities/v999' } });
  if (!badCapabilities.failures.some((failure) => failure.case === 'capabilities_schema_unsupported')) issues.push('an unsupported capabilities schema must be refused');
  const missing = evaluateGate({ ...baseGate, capabilities: null, capabilitiesDigest: null, binaryExists: false });
  if (!missing.failures.some((failure) => failure.case === 'missing_binary' && failure.status === 'unavailable')) issues.push('a missing binary must be reported unavailable');
  for (const failure of missing.failures) {
    if (failure.host_verdict !== 'unchanged') issues.push(`gate failure ${failure.case} must leave the harness verdict unchanged`);
  }

  const catalog = readOnlyToolCatalog({ mcp_tools: [...(capabilitiesDoc?.mcp_tools ?? [])] });
  if (!catalog.excluded_tools.includes('declare_intent')) issues.push('declare_intent must stay excluded from the read-only catalog');
  if (catalog.write_tools_exposed !== false) issues.push('the read-only catalog must expose no write tool');
  if (!SUPPORTED_CONTRACT_VERSIONS.includes(live.version_matrix.consumer_contract_version)) issues.push('the supported contract list drifted');
  if (!SUPPORTED_CAPABILITIES_SCHEMAS.includes(live.version_matrix.capabilities_schema)) issues.push('the supported capabilities schema list drifted');

  if (issues.length > 0) { for (const issue of issues) console.error(`[versegit-wp0] FAIL: ${issue}`); process.exitCode = 1; return; }
  console.log(`[versegit-wp0] OK status=${stored.status} binary=${stored.binary_identity.sha256.slice(0, 12)} catalog=${stored.read_only_tool_catalog.catalog_digest.slice(0, 12)} excluded=${stored.read_only_tool_catalog.excluded_tools.join(',')}`);
}

if (isMainEntrypoint(import.meta.url)) main();
