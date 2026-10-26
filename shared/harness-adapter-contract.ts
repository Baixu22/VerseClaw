export const HARNESS_ADAPTER_CONTRACT_SCHEMA = 'HarnessAdapterContract/v1' as const;

export type HarnessAdapterAvailability = 'available' | 'degraded' | 'unavailable' | 'not-run';
export type HarnessAdapterEvidenceStatus = 'verified' | 'not-run' | 'failed';

export type HarnessAdapterProtocol = {
  protocol: 'acp' | 'native' | 'cli';
  version: string | null;
  initialize: HarnessAdapterEvidenceStatus;
  health: HarnessAdapterEvidenceStatus;
  evidence: string[];
};

export type HarnessAdapterSession = {
  create: HarnessAdapterEvidenceStatus;
  resume: HarnessAdapterEvidenceStatus;
  fork: HarnessAdapterEvidenceStatus;
  identity: string | null;
};

export type HarnessAdapterPermission = {
  approvalRequired: boolean;
  denyByDefault: boolean;
  escapeHatch: boolean;
  evidence: string[];
};

export type HarnessAdapterLifecycle = {
  cancel: HarnessAdapterEvidenceStatus;
  timeout: HarnessAdapterEvidenceStatus;
  cleanup: HarnessAdapterEvidenceStatus;
};

export type HarnessAdapterCost = {
  known: boolean;
  currency: string | null;
  evidence: string[];
};

export type HarnessAdapterEvidence = {
  driven_by: 'agent';
  actor: string;
  artifacts: string[];
};

export type HarnessAdapterFailClosed = {
  explicitOnly: boolean;
  silentFallback: false;
  reason: string;
};

export type HarnessAdapterContract = {
  schemaVersion: typeof HARNESS_ADAPTER_CONTRACT_SCHEMA;
  id: string;
  label: string;
  availability: HarnessAdapterAvailability;
  protocol: HarnessAdapterProtocol;
  session: HarnessAdapterSession;
  permission: HarnessAdapterPermission;
  lifecycle: HarnessAdapterLifecycle;
  cost: HarnessAdapterCost;
  failClosed: HarnessAdapterFailClosed;
  evidence: HarnessAdapterEvidence;
  limitations: string[];
};

export const HARNESS_ADAPTER_CONTRACTS: readonly HarnessAdapterContract[] = [
  {
    schemaVersion: HARNESS_ADAPTER_CONTRACT_SCHEMA,
    id: 'native-openclaw',
    label: 'OpenClaw native loop',
    availability: 'available',
    protocol: { protocol: 'native', version: null, initialize: 'verified', health: 'verified', evidence: ['openclaw_runtime/src/agents/harness/builtin-openclaw.ts'] },
    session: { create: 'verified', resume: 'verified', fork: 'verified', identity: 'sessionKey + sessionId + runId' },
    permission: { approvalRequired: true, denyByDefault: false, escapeHatch: false, evidence: ['openclaw_runtime/src/agents/agent-tools.policy.ts'] },
    lifecycle: { cancel: 'verified', timeout: 'verified', cleanup: 'verified' },
    cost: { known: false, currency: null, evidence: [] },
    failClosed: { explicitOnly: true, silentFallback: false, reason: 'native baseline; not an external adapter' },
    evidence: { driven_by: 'agent', actor: 'codex-harness-codex-adapter-20261026', artifacts: [] },
    limitations: ['Baseline only; no external alternative is promoted by this record.'],
  },
  {
    schemaVersion: HARNESS_ADAPTER_CONTRACT_SCHEMA,
    id: 'acpx-codex',
    label: 'ACPX + Codex ACP adapter',
    availability: 'available',
    protocol: { protocol: 'acp', version: '0.10.0', initialize: 'verified', health: 'verified', evidence: ['openclaw_runtime/extensions/acpx/package.json', 'openclaw_runtime/node_modules/@zed-industries/codex-acp/package.json', 'harness/specs/fixtures/harness-codex-authority-baseline/verseSearch-sources.json'] },
    session: { create: 'verified', resume: 'not-run', fork: 'not-run', identity: 'ACP session id 01a177a5-b39a-70f3-807f-27e7c4cf0fd0; host session binding not proven' },
    permission: { approvalRequired: true, denyByDefault: false, escapeHatch: true, evidence: ['openclaw_runtime/node_modules/acpx/dist/cli.js'] },
    lifecycle: { cancel: 'not-run', timeout: 'verified', cleanup: 'not-run' },
    cost: { known: false, currency: null, evidence: [] },
    failClosed: { explicitOnly: true, silentFallback: false, reason: 'unauthenticated isolated CODEX_HOME failed closed; explicit OPENAI_API_KEY real turn passed' },
    evidence: { driven_by: 'agent', actor: 'codex-harness-codex-adapter-20261026', artifacts: ['harness/specs/fixtures/harness-codex-adapter-pilot/acceptance.json'] },
    limitations: ['Codex ACP adapter 0.15.0 is upstream-deprecated in the installed dependency tree.', 'Single-run latency; no P50/P95 measurement.'],
  },
  {
    schemaVersion: HARNESS_ADAPTER_CONTRACT_SCHEMA,
    id: 'opencode',
    label: 'OpenCode CLI/ACP',
    availability: 'unavailable',
    protocol: { protocol: 'acp', version: '1.16.2', initialize: 'not-run', health: 'failed', evidence: ['C:/Users/27933/AppData/Roaming/npm/node_modules/opencode-ai/bin/opencode.exe', 'harness/specs/fixtures/harness-codex-authority-baseline/verseSearch-sources.json'] },
    session: { create: 'verified', resume: 'not-run', fork: 'not-run', identity: 'sessionID emitted before local DB failure' },
    permission: { approvalRequired: true, denyByDefault: false, escapeHatch: true, evidence: ['opencode run --help'] },
    lifecycle: { cancel: 'not-run', timeout: 'not-run', cleanup: 'not-run' },
    cost: { known: false, currency: null, evidence: [] },
    failClosed: { explicitOnly: true, silentFallback: false, reason: 'local session failed with SQLiteError no such column: replacement_seq' },
    evidence: { driven_by: 'agent', actor: 'codex-harness-codex-adapter-20261026', artifacts: ['harness/specs/fixtures/harness-codex-adapter-pilot/acceptance.json'] },
    limitations: ['Local OpenCode database schema is inconsistent with the installed CLI; no model turn completed.'],
  },
] as const;

export function getHarnessAdapterContract(id: string): HarnessAdapterContract | undefined {
  return HARNESS_ADAPTER_CONTRACTS.find((contract) => contract.id === id);
}