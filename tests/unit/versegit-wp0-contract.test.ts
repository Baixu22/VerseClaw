import { describe, expect, it } from 'vitest';
import {
  evaluateGate, readOnlyToolCatalog, resolveMode, sha256, validateWp0Contract, versionMatrix,
  MODEL_FORBIDDEN_MCP_TOOLS, SUPPORTED_CAPABILITIES_SCHEMAS, WP0_SCHEMA,
} from '../../scripts/versegit-wp0-contract.mjs';

const hex64 = 'a'.repeat(64);
const hex40 = 'b'.repeat(40);

const capabilities = {
  schema: 'versegit.capabilities/v1',
  verdict: { schema: 'versegit.verdict/v1', dimensions: ['candidate', 'execution', 'evidence', 'freshness', 'risk', 'trial'], single_green_light: false },
  compat: { sts_protocols: ['1.1', '2.0'] },
  mcp_tools: ['vg_capabilities', 'verdict', 'integration_status', 'who_touches', 'explain_conflict', 'declare_intent', 'basis_status', 'basis_watermark'],
};
const mc0 = {
  schema_version: 1, binary: { sha256: hex64, bytes: 10, path: 'D:/x/target/debug/vg.exe', capabilities_schema: 'versegit.capabilities/v1', capabilities_sha256: sha256(JSON.stringify(capabilities)) },
  source: { head: hex40, tree: hex40, status: 'dirty', repo: 'D:/x' },
  version: { version: '0.1.0' }, vgSchema: { schema_version: 1, supported_schema_versions: [1, 2], ledger_schema_version: 2 },
};
const mc1 = { schema: 'clawx.versegit.consumer-contract/v1', surface: { module_report: { schema: 'clawx.versegit.module-report/v1' }, command_plan: { schema: 'clawx.versegit.command-plan/v1' }, execution_receipt: { schema: 'clawx.verseshell.execution-receipt/v2' } } };
const mc2 = { fingerprintSchema: 'clawx.versegit.mc2-fingerprint/v1', digest: hex64 };
const mc3 = { packageSchema: 'clawx.versegit.mc3-package/v1', digest: hex64, identity: { binary_sha256: hex64, binary_profile: 'debug', platform: 'win32-x64' } };

function contractFixture() {
  const matrix = versionMatrix({ mc0, mc1, mc2, mc3, capabilities });
  const catalog = readOnlyToolCatalog(capabilities);
  return {
    contractSchema: WP0_SCHEMA,
    binary_identity: { sha256: hex64, bytes: 10, profile: 'debug', platform: 'win32-x64', capabilities_schema: capabilities.schema, capabilities_digest: sha256(JSON.stringify(capabilities)), source_head: hex40, source_tree: hex40, consumer_contract_digest: sha256(JSON.stringify(mc1)), golden_bundle_digest: mc2.digest, sidecar_package_digest: mc3.digest, exists: true },
    version_matrix: matrix,
    read_only_tool_catalog: catalog,
    mcp_registration: { registered_by_clawx: false, mutable_checkout_path_consumed: false, model_facing_write_tools: [] },
    mode_matrix: {
      M0: { attach: false, processes_started: 0, state_read: false, workspace_write: false, domain_state_write: false, execution: 'none', status: 'not_applicable', host_verdict: 'unchanged' },
      M1: { attach: true, processes_started: 1, state_read: true, workspace_write: false, domain_state_write: false, execution: 'none', status: 'partial', host_verdict: 'unchanged' },
      M2: { attach: true, processes_started: 1, state_read: true, workspace_write: false, domain_state_write: true, execution: 'none', status: 'partial', host_verdict: 'unchanged' },
      M3: { attach: true, processes_started: 1, state_read: true, workspace_write: false, domain_state_write: true, execution: 'via_verseshell_only', status: 'partial', host_verdict: 'unchanged' },
    },
    mode_resolution: { M0: resolveMode({ mode: 'M0', catalog, matrix }), M1: resolveMode({ mode: 'M1', catalog, matrix, startedProcesses: 1 }) },
    gate: { passed: true, failures: [] },
    eligibility: { default_enabled: false, single_worktree_single_session_commands: 0, added_to_fast_profile: false, added_to_comms_profile: false, added_to_implicit_profile: false, triggers: [] },
    non_interference: { created_or_attached_session: false, wrote_provider_state: false, provider_workspace_unchanged: true, land_or_admit_invoked: false, host_verdict_changed: false },
    status: 'verified',
    boundaries: { vg_source_tree_copied: false, vg_history_copied: false, vg_task_forest_copied: false, vg_build_outputs_copied: false, vg_private_evidence_copied: false, provider_source_modified: false, default_on: false },
  };
}

const baseGate = { matrix: versionMatrix({ mc0, mc1, mc2, mc3, capabilities }), mc0, mc3, capabilities, capabilitiesDigest: sha256(JSON.stringify(capabilities)), binaryExists: true };

describe('WP0 module contract and identity', () => {
  it('resolves M0 without attaching anything or starting a process', () => {
    const resolved = resolveMode({ mode: 'M0', catalog: readOnlyToolCatalog(capabilities), matrix: baseGate.matrix });
    expect(resolved).toMatchObject({ attach: false, processes_started: 0, state_read: false, status: 'not_applicable', host_verdict: 'unchanged' });
  });

  it('filters declare_intent out of the model-facing catalog and digests the allowlist', () => {
    const catalog = readOnlyToolCatalog(capabilities);
    expect(catalog.excluded_tools).toContain('declare_intent');
    expect(catalog.read_only_tools).not.toContain('declare_intent');
    expect(catalog.read_only_tools).toContain('vg_capabilities');
    expect(catalog.write_tools_exposed).toBe(false);
    expect(catalog.deny_by_default).toBe(true);
    expect(catalog.catalog_digest).toMatch(/^[0-9a-f]{64}$/u);
    expect(MODEL_FORBIDDEN_MCP_TOOLS).toEqual(['declare_intent']);
  });

  it('passes the gate for a matching frozen identity', () => {
    expect(evaluateGate(baseGate)).toEqual({ passed: true, failures: [] });
  });

  it('refuses identity and version drift with an unchanged harness verdict', () => {
    const drift = evaluateGate({ ...baseGate, mc3: { ...mc3, identity: { ...mc3.identity, binary_sha256: 'f'.repeat(64) } } });
    expect(drift.passed).toBe(false);
    expect(drift.failures.some((entry) => entry.case === 'binary_digest_mismatch' && entry.status === 'rejected_by_policy' && entry.host_verdict === 'unchanged')).toBe(true);
    const ledger = evaluateGate({ ...baseGate, matrix: { ...baseGate.matrix, ledger_schema_version: 99 } });
    expect(ledger.failures.some((entry) => entry.case === 'ledger_schema_too_new')).toBe(true);
    const contract = evaluateGate({ ...baseGate, matrix: { ...baseGate.matrix, consumer_contract_version: 'clawx.versegit.consumer-contract/v9' } });
    expect(contract.failures.some((entry) => entry.case === 'contract_version_unsupported')).toBe(true);
    const caps = evaluateGate({ ...baseGate, capabilities: { ...capabilities, schema: 'versegit.capabilities/v9' }, capabilitiesDigest: null });
    expect(caps.failures.map((entry) => entry.case)).toEqual(expect.arrayContaining(['capabilities_schema_unsupported', 'capabilities_digest_mismatch']));
    expect(SUPPORTED_CAPABILITIES_SCHEMAS).toEqual(['versegit.capabilities/v1']);
  });

  it('reports a missing binary as unavailable instead of failing the harness', () => {
    const missing = evaluateGate({ ...baseGate, binaryExists: false, capabilities: null, capabilitiesDigest: null });
    expect(missing.failures).toEqual([expect.objectContaining({ case: 'missing_binary', status: 'unavailable', host_verdict: 'unchanged' })]);
  });

  it('accepts a complete contract and rejects widened authority', () => {
    expect(validateWp0Contract(contractFixture()).issues).toEqual([]);
    const widened = contractFixture();
    widened.mode_matrix.M1.domain_state_write = true;
    widened.mode_matrix.M3.execution = 'native';
    widened.read_only_tool_catalog.write_tools_exposed = true;
    widened.eligibility.default_enabled = true;
    widened.eligibility.added_to_fast_profile = true;
    widened.non_interference.created_or_attached_session = true;
    widened.mcp_registration.registered_by_clawx = true;
    const result = validateWp0Contract(widened);
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      'M1 must not write provider domain state',
      'M3 execution must be VerseShell-only',
      'no write tool may be exposed',
      'the module must stay default-off',
      'the module must not join fast, comms or an implicit profile',
      'WP0 must not create or attach a session',
      'ClawX must not register the provider .mcp.json entry',
    ]));
  });

  it('binds the contract to the frozen MC0/MC1/MC2/MC3 digests', () => {
    const contract = contractFixture();
    expect(contract.version_matrix.consumer_contract_version).toBe('clawx.versegit.consumer-contract/v1');
    expect(contract.version_matrix.execution_receipt_schema).toBe('clawx.verseshell.execution-receipt/v2');
    expect(contract.version_matrix.sidecar_package_schema).toBe('clawx.versegit.mc3-package/v1');
    expect(contract.version_matrix.fingerprint_schema).toBe('clawx.versegit.mc2-fingerprint/v1');
    const stale = contractFixture();
    stale.binary_identity.capabilities_digest = null;
    expect(validateWp0Contract(stale).issues).toContain('capabilities digest missing');
  });
});
