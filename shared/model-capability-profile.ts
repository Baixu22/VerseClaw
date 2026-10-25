import { createHash } from 'node:crypto';

import { COMPONENT_AUTHORITY_MANIFEST_VERSION } from './component-authority-manifest.js';
import {
  COMPONENT_DISPOSITION_ENTRIES,
  COMPONENT_DISPOSITION_MANIFEST,
  COMPONENT_DISPOSITION_MANIFEST_VERSION,
  COMPONENT_DISPOSITIONS,
  type ComponentDisposition,
  type ComponentDispositionEntry,
  type ComponentDispositionVisibility,
} from './dcs/component-disposition-catalog.js';

export const MODEL_CAPABILITY_PROFILE_SCHEMA = 'ModelCapabilityProfile/v1' as const;
export const MODEL_CAPABILITY_STATIC_MANIFEST_SCHEMA = 'ModelCapabilityStaticManifest/v1' as const;
export const MODEL_CAPABILITY_PROMPT_MAX_CHARS = 2_000;
export const MODEL_CAPABILITY_PROMPT_MIN_CHARS = 400;

export const MODEL_CAPABILITY_RUNTIME_AVAILABILITY_STATES = [
  'enabled', 'disabled', 'partial', 'degraded', 'quarantined', 'unknown',
] as const;
export const MODEL_CAPABILITY_ACTION_AUTHORIZATION_STATES = [
  'allowed', 'requires-approval', 'denied', 'not-applicable', 'unknown',
] as const;
export const MODEL_CAPABILITY_GRANT_STATES = [
  'active', 'pending', 'expired', 'revoked', 'denied', 'unknown',
] as const;
export const MODEL_CAPABILITY_DRIVER_KINDS = [
  'native', 'mcp', 'plugin', 'browser', 'runtime', 'none', 'unknown',
] as const;
export const MODEL_CAPABILITY_DRIVER_STATES = [
  'ready', 'loading', 'unavailable', 'error', 'disabled', 'unknown',
] as const;
export const MODEL_CAPABILITY_MEMORY_SCOPES = ['workspace', 'role', 'session', 'none', 'unknown'] as const;
export const MODEL_CAPABILITY_MEMORY_ACCESS_STATES = ['allowed', 'denied', 'not-applicable', 'unknown'] as const;
export const MODEL_CAPABILITY_MEMORY_CANDIDATE_STATES = ['available', 'unavailable', 'not-applicable', 'unknown'] as const;
export const MODEL_CAPABILITY_KNOWLEDGE_STATES = ['applied', 'not-applied', 'stale', 'unavailable', 'unknown'] as const;
export const MODEL_CAPABILITY_ACK_STATES = ['acknowledged', 'pending', 'rejected', 'unknown'] as const;
export const MODEL_CAPABILITY_QUARANTINE_STATES = ['clear', 'quarantined', 'unknown'] as const;
export const MODEL_CAPABILITY_TOOL_IDENTITY_KINDS = [
  'model-tool', 'runtime-service', 'feature', 'ui-route', 'setting',
] as const;

export type ModelCapabilityRuntimeAvailability = (typeof MODEL_CAPABILITY_RUNTIME_AVAILABILITY_STATES)[number];
export type ModelCapabilityActionAuthorization = (typeof MODEL_CAPABILITY_ACTION_AUTHORIZATION_STATES)[number];
export type ModelCapabilityGrantState = (typeof MODEL_CAPABILITY_GRANT_STATES)[number];
export type ModelCapabilityDriverKind = (typeof MODEL_CAPABILITY_DRIVER_KINDS)[number];
export type ModelCapabilityDriverState = (typeof MODEL_CAPABILITY_DRIVER_STATES)[number];
export type ModelCapabilityMemoryScope = (typeof MODEL_CAPABILITY_MEMORY_SCOPES)[number];
export type ModelCapabilityMemoryAccess = (typeof MODEL_CAPABILITY_MEMORY_ACCESS_STATES)[number];
export type ModelCapabilityMemoryCandidate = (typeof MODEL_CAPABILITY_MEMORY_CANDIDATE_STATES)[number];
export type ModelCapabilityKnowledgeState = (typeof MODEL_CAPABILITY_KNOWLEDGE_STATES)[number];
export type ModelCapabilityAckState = (typeof MODEL_CAPABILITY_ACK_STATES)[number];
export type ModelCapabilityQuarantineState = (typeof MODEL_CAPABILITY_QUARANTINE_STATES)[number];
export type ModelCapabilityToolIdentityKind = (typeof MODEL_CAPABILITY_TOOL_IDENTITY_KINDS)[number];

export type ModelCapabilityScope = {
  workspaceId: string;
  roleId: string | null;
  sessionKey: string;
};

export type ModelCapabilityToolIdentity = {
  id: string;
  label: string;
  kind: ModelCapabilityToolIdentityKind;
};

export type ModelCapabilityStaticEntry = {
  capabilityId: string;
  displayName: string;
  owner: string;
  disposition: ComponentDisposition;
  visibility: ComponentDispositionVisibility;
  userEntry: string | null;
  toolIdentity: ModelCapabilityToolIdentity;
};

export type ModelCapabilityStaticManifest = {
  schemaVersion: typeof MODEL_CAPABILITY_STATIC_MANIFEST_SCHEMA;
  sourceManifestVersion: typeof COMPONENT_DISPOSITION_MANIFEST_VERSION;
  sourceAuthorityManifestVersion: typeof COMPONENT_AUTHORITY_MANIFEST_VERSION;
  generatedForDate: typeof COMPONENT_DISPOSITION_MANIFEST.generatedForDate;
  entries: readonly ModelCapabilityStaticEntry[];
};

export type ModelCapabilityRuntimeFact = {
  state: ModelCapabilityRuntimeAvailability;
  source: string;
  reason: string | null;
  observedAt: string | null;
};

export type ModelCapabilityToolFact = {
  identity: ModelCapabilityToolIdentity;
  callableName: string | null;
};

export type ModelCapabilityDriverFact = {
  id: string;
  kind: ModelCapabilityDriverKind;
  state: ModelCapabilityDriverState;
  version: string | null;
};

export type ModelCapabilityGrantFact = {
  grantId: string;
  state: ModelCapabilityGrantState;
  expiresAt: string | null;
};

export type ModelCapabilityActionFact = {
  actionId: string;
  authorization: ModelCapabilityActionAuthorization;
  grant: ModelCapabilityGrantFact | null;
};

export type ModelCapabilityMemoryFact = {
  scope: ModelCapabilityMemoryScope;
  read: ModelCapabilityMemoryAccess;
  write: ModelCapabilityMemoryAccess;
  candidate: ModelCapabilityMemoryCandidate;
};

export type ModelCapabilityKnowledgeFact = {
  appliedState: ModelCapabilityKnowledgeState;
  version: string | null;
  digest: string | null;
};

export type ModelCapabilityAckFact = {
  state: ModelCapabilityAckState;
  generation: string | null;
  source: string | null;
  rejectedFields: readonly string[];
  observedAt: string | null;
};

export type ModelCapabilityQuarantineFact = {
  state: ModelCapabilityQuarantineState;
  reason: string | null;
  since: string | null;
};

export type ModelCapabilityProfileCatalogIdentity = {
  schemaVersion: string;
  digest: string;
};

export type ModelCapabilityEffectiveFactInput = {
  capabilityId: string;
  tool: ModelCapabilityToolFact;
  driver: ModelCapabilityDriverFact;
  runtimeAvailability: ModelCapabilityRuntimeFact;
  actionAuthorization: readonly ModelCapabilityActionFact[];
  memory: ModelCapabilityMemoryFact;
  knowledge: ModelCapabilityKnowledgeFact;
  ack: ModelCapabilityAckFact;
  quarantine: ModelCapabilityQuarantineFact;
};

export type ModelCapabilityEffectiveFactsInput = {
  scope: ModelCapabilityScope;
  runtimeGeneration: string;
  observedAt: string;
  catalogIdentity?: ModelCapabilityProfileCatalogIdentity;
  facts: readonly ModelCapabilityEffectiveFactInput[];
};

export type ModelCapabilityProfileEntry = {
  capabilityId: string;
  static: ModelCapabilityStaticEntry;
  tool: ModelCapabilityToolFact;
  driver: ModelCapabilityDriverFact;
  runtimeAvailability: ModelCapabilityRuntimeFact;
  actionAuthorization: readonly ModelCapabilityActionFact[];
  memory: ModelCapabilityMemoryFact;
  knowledge: ModelCapabilityKnowledgeFact;
  ack: ModelCapabilityAckFact;
  quarantine: ModelCapabilityQuarantineFact;
};

export type ModelCapabilityPromptBudget = {
  maxChars: number;
  usedChars: number;
  remainingChars: number;
  chargedTo: 'reserved-system-prompt';
  workContextCharsUsed: 0;
};

export type ModelCapabilityPromptAddition = {
  text: string;
  budget: ModelCapabilityPromptBudget;
  omittedCapabilityIds: readonly string[];
};

export type ModelCapabilityProfileDiagnostic = {
  code: 'prompt-capability-omitted' | 'runtime-state-unverified';
  severity: 'info' | 'warning';
  message: string;
  capabilityId?: string;
};

export type ModelCapabilityProfile = {
  schemaVersion: typeof MODEL_CAPABILITY_PROFILE_SCHEMA;
  generatedAt: string;
  scope: ModelCapabilityScope;
  runtimeGeneration: string;
  observedAt: string;
  staticManifest: ModelCapabilityStaticManifest;
  staticDigest: string;
  effectiveDigest: string;
  catalogIdentity?: ModelCapabilityProfileCatalogIdentity;
  entries: readonly ModelCapabilityProfileEntry[];
  promptAddition: ModelCapabilityPromptAddition;
  diagnostics: readonly ModelCapabilityProfileDiagnostic[];
};

export type ModelCapabilityProfileIssue = {
  code: string;
  message: string;
  path?: string;
};

export type ModelCapabilityProfileValidationResult = {
  ok: boolean;
  issues: ModelCapabilityProfileIssue[];
  userVisibleCapabilityCount: number;
  staticDigestMatches: boolean;
  effectiveDigestMatches: boolean;
};

export type BuildModelCapabilityProfileInput = ModelCapabilityEffectiveFactsInput & {
  generatedAt: string;
  promptMaxChars?: number;
};

export const MODEL_CAPABILITY_USER_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  'component.working-memory-context': 'Workspace context',
  'component.tool-registry-context': 'Tool context',
  'component.dcs-context-tools': 'Context reading and search',
  'component.role-memory': 'Agent memory cards',
  'component.knowledge-review-authority': 'Knowledge review',
  'component.knowledge-retrieval-source': 'Knowledge retrieval',
  'component.v3-capability-catalog': 'Capability discovery',
  'component.skills-mcp-source-registry': 'Skills and MCP connections',
  'component.tool-search-schema-expander': 'Tool discovery',
  'component.coding-execution-backend': 'Coding tools and file execution',
  'component.permission-approval-authority': 'Approvals and action permissions',
  'component.task-ledger': 'Task ledger',
  'component.browser-session-owner': 'Browser sessions',
  'component.renderer-ui-surface': 'Application shell and Settings',
  'feature.coding-recovery': 'Coding recovery and verification',
  'feature.worktree-isolation': 'Worktree isolation',
  'surface.inbox': 'Inbox',
  'surface.cron': 'Scheduled tasks and auto-approval',
  'surface.remote-tasks': 'Remote tasks',
  'surface.clawgraph': 'ClawGraph',
  'surface.code-review': 'Code review',
  'surface.image-generation': 'Image generation',
  'surface.observability': 'Observability',
  'settings.developer-advanced': 'Developer settings',
  'settings.billing': 'Billing and usage',
};
/**
 * Internal implementation names that must never reach the model as a user-visible
 * capability. TF-0504 added the execution/evidence substrate names: VerseShell is the
 * internal local executor, the Observability recorder only records, and the event log
 * is not a feature. Bare "Observability" stays allowed because surface.observability is
 * a real user-visible surface.
 */
const FORBIDDEN_USER_CAPABILITY_TERMS = /\b(?:DCS|VToken|C6|RC-03|V3|VerseShell|Observability recorder|event[- ]log)\b/iu;
const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/u;

function normalizeCatalogIdentity(
  identity: ModelCapabilityProfileCatalogIdentity | undefined,
): ModelCapabilityProfileCatalogIdentity | undefined {
  if (identity === undefined) return undefined;
  return {
    schemaVersion: identity.schemaVersion.trim(),
    digest: identity.digest.trim(),
  };
}

function validateCatalogIdentity(
  identity: ModelCapabilityProfileCatalogIdentity | undefined,
  pathValue = 'catalogIdentity',
): ModelCapabilityProfileIssue[] {
  if (identity === undefined) return [];
  const issues: ModelCapabilityProfileIssue[] = [];
  if (!isNonEmptyString(identity.schemaVersion)) {
    issues.push(issue('catalog_identity_schema_missing', 'catalogIdentity.schemaVersion is required', `${pathValue}.schemaVersion`));
  }
  if (!SHA256_DIGEST.test(identity.digest)) {
    issues.push(issue('catalog_identity_digest_invalid', 'catalogIdentity.digest must be sha256:<64hex>', `${pathValue}.digest`));
  }
  return issues;
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Canonical JSON does not accept non-finite numbers');
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => canonicalize(item) ?? null);
  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const item = canonicalize((value as Record<string, unknown>)[key]);
      if (item !== undefined) output[key] = item;
    }
    return output;
  }
  if (value === undefined) return undefined;
  throw new TypeError(`Canonical JSON does not accept ${typeof value}`);
}

export function canonicalModelCapabilityJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalModelCapabilityJson(value), 'utf8').digest('hex')}`;
}

function issue(code: string, message: string, pathValue?: string): ModelCapabilityProfileIssue {
  return { code, message, ...(pathValue ? { path: pathValue } : {}) };
}

function trimmed(value: string): string {
  return value.trim();
}

function nullableTrimmed(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function toolIdentityKind(componentId: string): ModelCapabilityToolIdentityKind {
  if (componentId.startsWith('surface.')) return 'ui-route';
  if (componentId.startsWith('settings.')) return 'setting';
  if (componentId.startsWith('feature.')) return 'feature';
  if (componentId.includes('tools') || componentId.includes('tool-search')) return 'model-tool';
  return 'runtime-service';
}

function displayNameFor(entry: ComponentDispositionEntry): string {
  return MODEL_CAPABILITY_USER_DISPLAY_NAMES[entry.id] ?? entry.label;
}

export function createModelCapabilityStaticManifest(
  entries: readonly ComponentDispositionEntry[] = COMPONENT_DISPOSITION_ENTRIES,
): ModelCapabilityStaticManifest {
  return {
    schemaVersion: MODEL_CAPABILITY_STATIC_MANIFEST_SCHEMA,
    sourceManifestVersion: COMPONENT_DISPOSITION_MANIFEST_VERSION,
    sourceAuthorityManifestVersion: COMPONENT_AUTHORITY_MANIFEST_VERSION,
    generatedForDate: COMPONENT_DISPOSITION_MANIFEST.generatedForDate,
    entries: entries.map((entry) => {
      const displayName = displayNameFor(entry);
      return {
        capabilityId: entry.id,
        displayName,
        owner: entry.owner,
        disposition: entry.disposition,
        visibility: entry.visibility,
        userEntry: entry.userEntry,
        toolIdentity: {
          id: entry.id,
          label: displayName,
          kind: toolIdentityKind(entry.id),
        },
      } satisfies ModelCapabilityStaticEntry;
    }),
  };
}

export function validateModelCapabilityStaticManifest(
  manifest: ModelCapabilityStaticManifest,
  expectedEntries: readonly ComponentDispositionEntry[] = COMPONENT_DISPOSITION_ENTRIES,
): ModelCapabilityProfileIssue[] {
  const issues: ModelCapabilityProfileIssue[] = [];
  const expectedById = new Map(expectedEntries.map((entry) => [entry.id, entry]));
  const seen = new Set<string>();
  if (manifest.schemaVersion !== MODEL_CAPABILITY_STATIC_MANIFEST_SCHEMA) {
    issues.push(issue('static_manifest_schema', `Expected ${MODEL_CAPABILITY_STATIC_MANIFEST_SCHEMA}`, 'staticManifest.schemaVersion'));
  }
  for (const entry of manifest.entries) {
    const pathValue = `staticManifest.entries.${entry.capabilityId}`;
    if (seen.has(entry.capabilityId)) issues.push(issue('duplicate_static_capability', `Duplicate static capability ${entry.capabilityId}`, pathValue));
    seen.add(entry.capabilityId);
    const expected = expectedById.get(entry.capabilityId);
    if (!expected) {
      issues.push(issue('unknown_static_capability', `Unknown static capability ${entry.capabilityId}`, pathValue));
      continue;
    }
    if (entry.disposition !== expected.disposition) issues.push(issue('static_disposition_mismatch', `Disposition mismatch for ${entry.capabilityId}`, pathValue));
    if (entry.visibility !== expected.visibility) issues.push(issue('static_visibility_mismatch', `Visibility mismatch for ${entry.capabilityId}`, pathValue));
    if (entry.owner !== expected.owner) issues.push(issue('static_owner_mismatch', `Owner mismatch for ${entry.capabilityId}`, pathValue));
    if (entry.userEntry !== expected.userEntry) issues.push(issue('static_user_entry_mismatch', `User entry mismatch for ${entry.capabilityId}`, pathValue));
    if (!COMPONENT_DISPOSITIONS.includes(entry.disposition)) issues.push(issue('invalid_static_disposition', `Invalid disposition for ${entry.capabilityId}`, pathValue));
    if (!entry.displayName.trim()) issues.push(issue('missing_display_name', `Missing display name for ${entry.capabilityId}`, pathValue));
    if (entry.visibility === 'user' && FORBIDDEN_USER_CAPABILITY_TERMS.test(entry.displayName)) {
      issues.push(issue('internal_name_in_user_capability', `User-facing capability uses an internal implementation name: ${entry.displayName}`, pathValue));
    }
    if (entry.visibility !== 'user' && entry.userEntry !== null) {
      issues.push(issue('non_user_entry_exposed', `Non-user capability ${entry.capabilityId} has a user entry`, pathValue));
    }
    if (entry.toolIdentity.id !== entry.capabilityId) issues.push(issue('tool_identity_mismatch', `Tool identity id must match ${entry.capabilityId}`, pathValue));
    if (!MODEL_CAPABILITY_TOOL_IDENTITY_KINDS.includes(entry.toolIdentity.kind)) issues.push(issue('invalid_tool_identity_kind', `Invalid tool identity kind for ${entry.capabilityId}`, pathValue));
  }
  for (const expected of expectedEntries) {
    if (!seen.has(expected.id)) issues.push(issue('missing_static_capability', `Static manifest omits ${expected.id}`, expected.id));
    if (expected.visibility === 'user' && !MODEL_CAPABILITY_USER_DISPLAY_NAMES[expected.id]) {
      issues.push(issue('missing_user_display_name', `No stable user-facing display name for ${expected.id}`, expected.id));
    }
  }
  return issues;
}

function validateScope(scope: ModelCapabilityScope): ModelCapabilityProfileIssue[] {
  const issues: ModelCapabilityProfileIssue[] = [];
  if (!isNonEmptyString(scope.workspaceId)) issues.push(issue('workspace_scope_missing', 'workspaceId is required', 'scope.workspaceId'));
  if (scope.roleId !== null && !isNonEmptyString(scope.roleId)) issues.push(issue('role_scope_invalid', 'roleId must be a non-empty string or null', 'scope.roleId'));
  if (!isNonEmptyString(scope.sessionKey)) issues.push(issue('session_scope_missing', 'sessionKey is required', 'scope.sessionKey'));
  return issues;
}
function validateEffectiveFactsInput(
  input: ModelCapabilityEffectiveFactsInput,
  staticManifest: ModelCapabilityStaticManifest,
): ModelCapabilityProfileIssue[] {
  const issues = validateScope(input.scope);
  if (!isNonEmptyString(input.runtimeGeneration)) issues.push(issue('runtime_generation_missing', 'runtimeGeneration is required', 'runtimeGeneration'));
  if (!isIsoTimestamp(input.observedAt)) issues.push(issue('observed_at_invalid', 'observedAt must be an ISO timestamp', 'observedAt'));
  issues.push(...validateCatalogIdentity(input.catalogIdentity));
  const staticById = new Map(staticManifest.entries.map((entry) => [entry.capabilityId, entry]));
  const seen = new Set<string>();
  for (const fact of input.facts) {
    const pathValue = `facts.${fact.capabilityId}`;
    const staticEntry = staticById.get(fact.capabilityId);
    if (!staticEntry) {
      issues.push(issue('unknown_effective_capability', `Unknown effective capability ${fact.capabilityId}`, pathValue));
      continue;
    }
    if (seen.has(fact.capabilityId)) issues.push(issue('duplicate_effective_capability', `Duplicate effective capability ${fact.capabilityId}`, pathValue));
    seen.add(fact.capabilityId);
    if (fact.tool.identity.id !== staticEntry.toolIdentity.id || fact.tool.identity.kind !== staticEntry.toolIdentity.kind) {
      issues.push(issue('effective_tool_identity_mismatch', `Effective tool identity does not match static identity for ${fact.capabilityId}`, `${pathValue}.tool.identity`));
    }
    if (!MODEL_CAPABILITY_RUNTIME_AVAILABILITY_STATES.includes(fact.runtimeAvailability.state)) {
      const code = COMPONENT_DISPOSITIONS.includes(fact.runtimeAvailability.state as ComponentDisposition)
        ? 'static_runtime_axis_conflation'
        : 'invalid_runtime_availability';
      issues.push(issue(code, `Invalid runtime availability for ${fact.capabilityId}: ${String(fact.runtimeAvailability.state)}`, `${pathValue}.runtimeAvailability.state`));
    }
    if (!isNonEmptyString(fact.runtimeAvailability.source)) issues.push(issue('runtime_source_missing', `Runtime source is required for ${fact.capabilityId}`, `${pathValue}.runtimeAvailability.source`));
    if (fact.runtimeAvailability.observedAt !== null && !isIsoTimestamp(fact.runtimeAvailability.observedAt)) {
      issues.push(issue('runtime_observed_at_invalid', `Runtime observedAt is invalid for ${fact.capabilityId}`, `${pathValue}.runtimeAvailability.observedAt`));
    }
    if (!MODEL_CAPABILITY_DRIVER_KINDS.includes(fact.driver.kind)) issues.push(issue('invalid_driver_kind', `Invalid driver kind for ${fact.capabilityId}`, `${pathValue}.driver.kind`));
    if (!MODEL_CAPABILITY_DRIVER_STATES.includes(fact.driver.state)) issues.push(issue('invalid_driver_state', `Invalid driver state for ${fact.capabilityId}`, `${pathValue}.driver.state`));
    if (!isNonEmptyString(fact.driver.id)) issues.push(issue('driver_id_missing', `Driver id is required for ${fact.capabilityId}`, `${pathValue}.driver.id`));
    const actionIds = new Set<string>();
    for (const action of fact.actionAuthorization) {
      const actionPath = `${pathValue}.actionAuthorization.${action.actionId}`;
      if (!isNonEmptyString(action.actionId)) issues.push(issue('action_id_missing', `Action id is required for ${fact.capabilityId}`, `${pathValue}.actionAuthorization`));
      if (actionIds.has(action.actionId)) issues.push(issue('duplicate_action_authorization', `Duplicate action ${action.actionId} for ${fact.capabilityId}`, actionPath));
      actionIds.add(action.actionId);
      if (!MODEL_CAPABILITY_ACTION_AUTHORIZATION_STATES.includes(action.authorization)) {
        issues.push(issue('invalid_action_authorization', `Invalid action authorization for ${fact.capabilityId}:${action.actionId}`, `${actionPath}.authorization`));
      }
      if (action.grant) {
        if (!isNonEmptyString(action.grant.grantId)) issues.push(issue('grant_id_missing', `Grant id is required for ${fact.capabilityId}:${action.actionId}`, `${actionPath}.grant.grantId`));
        if (!MODEL_CAPABILITY_GRANT_STATES.includes(action.grant.state)) issues.push(issue('invalid_grant_state', `Invalid grant state for ${fact.capabilityId}:${action.actionId}`, `${actionPath}.grant.state`));
        if (action.grant.expiresAt !== null && !isIsoTimestamp(action.grant.expiresAt)) issues.push(issue('grant_expiry_invalid', `Grant expiry is invalid for ${fact.capabilityId}:${action.actionId}`, `${actionPath}.grant.expiresAt`));
      }
      if (action.authorization === 'requires-approval' && action.grant?.state === 'active') {
        issues.push(issue('approval_axis_conflation', `requires-approval cannot carry an active grant for ${fact.capabilityId}:${action.actionId}`, actionPath));
      }
    }
    if (!MODEL_CAPABILITY_MEMORY_SCOPES.includes(fact.memory.scope)) issues.push(issue('invalid_memory_scope', `Invalid memory scope for ${fact.capabilityId}`, `${pathValue}.memory.scope`));
    if (!MODEL_CAPABILITY_MEMORY_ACCESS_STATES.includes(fact.memory.read)) issues.push(issue('invalid_memory_read', `Invalid memory read state for ${fact.capabilityId}`, `${pathValue}.memory.read`));
    if (!MODEL_CAPABILITY_MEMORY_ACCESS_STATES.includes(fact.memory.write)) issues.push(issue('invalid_memory_write', `Invalid memory write state for ${fact.capabilityId}`, `${pathValue}.memory.write`));
    if (!MODEL_CAPABILITY_MEMORY_CANDIDATE_STATES.includes(fact.memory.candidate)) issues.push(issue('invalid_memory_candidate', `Invalid memory candidate state for ${fact.capabilityId}`, `${pathValue}.memory.candidate`));
    if (!MODEL_CAPABILITY_KNOWLEDGE_STATES.includes(fact.knowledge.appliedState)) issues.push(issue('invalid_knowledge_state', `Invalid knowledge state for ${fact.capabilityId}`, `${pathValue}.knowledge.appliedState`));
    if (fact.knowledge.appliedState === 'applied' && !isNonEmptyString(fact.knowledge.version)) {
      issues.push(issue('applied_knowledge_version_missing', `Applied knowledge needs a version for ${fact.capabilityId}`, `${pathValue}.knowledge.version`));
    }
    if (!MODEL_CAPABILITY_ACK_STATES.includes(fact.ack.state)) issues.push(issue('invalid_ack_state', `Invalid ack state for ${fact.capabilityId}`, `${pathValue}.ack.state`));
    if (fact.ack.state === 'acknowledged' && (!isNonEmptyString(fact.ack.generation) || !isNonEmptyString(fact.ack.source))) {
      issues.push(issue('ack_provenance_missing', `Acknowledged runtime fact needs generation and source for ${fact.capabilityId}`, `${pathValue}.ack`));
    }
    if (fact.ack.observedAt !== null && !isIsoTimestamp(fact.ack.observedAt)) issues.push(issue('ack_observed_at_invalid', `Ack observedAt is invalid for ${fact.capabilityId}`, `${pathValue}.ack.observedAt`));
    if (!MODEL_CAPABILITY_QUARANTINE_STATES.includes(fact.quarantine.state)) issues.push(issue('invalid_quarantine_state', `Invalid quarantine state for ${fact.capabilityId}`, `${pathValue}.quarantine.state`));
    if (fact.runtimeAvailability.state === 'quarantined' && fact.quarantine.state !== 'quarantined') {
      issues.push(issue('quarantine_state_missing', `Quarantined availability needs quarantine detail for ${fact.capabilityId}`, `${pathValue}.quarantine`));
    }
    if (fact.quarantine.since !== null && !isIsoTimestamp(fact.quarantine.since)) issues.push(issue('quarantine_since_invalid', `Quarantine since is invalid for ${fact.capabilityId}`, `${pathValue}.quarantine.since`));
  }
  return issues;
}
function normalizeScope(scope: ModelCapabilityScope): ModelCapabilityScope {
  return {
    workspaceId: trimmed(scope.workspaceId),
    roleId: nullableTrimmed(scope.roleId),
    sessionKey: trimmed(scope.sessionKey),
  };
}

function normalizeIdentity(identity: ModelCapabilityToolIdentity): ModelCapabilityToolIdentity {
  return {
    id: trimmed(identity.id),
    label: trimmed(identity.label),
    kind: identity.kind,
  };
}

function normalizeEffectiveFact(fact: ModelCapabilityEffectiveFactInput): ModelCapabilityEffectiveFactInput {
  return {
    capabilityId: trimmed(fact.capabilityId),
    tool: {
      identity: normalizeIdentity(fact.tool.identity),
      callableName: nullableTrimmed(fact.tool.callableName),
    },
    driver: {
      id: trimmed(fact.driver.id),
      kind: fact.driver.kind,
      state: fact.driver.state,
      version: nullableTrimmed(fact.driver.version),
    },
    runtimeAvailability: {
      state: fact.runtimeAvailability.state,
      source: trimmed(fact.runtimeAvailability.source),
      reason: nullableTrimmed(fact.runtimeAvailability.reason),
      observedAt: nullableTrimmed(fact.runtimeAvailability.observedAt),
    },
    actionAuthorization: fact.actionAuthorization
      .map((action) => ({
        actionId: trimmed(action.actionId),
        authorization: action.authorization,
        grant: action.grant
          ? {
              grantId: trimmed(action.grant.grantId),
              state: action.grant.state,
              expiresAt: nullableTrimmed(action.grant.expiresAt),
            }
          : null,
      }))
      .sort((left, right) => left.actionId.localeCompare(right.actionId)),
    memory: { ...fact.memory },
    knowledge: {
      appliedState: fact.knowledge.appliedState,
      version: nullableTrimmed(fact.knowledge.version),
      digest: nullableTrimmed(fact.knowledge.digest),
    },
    ack: {
      state: fact.ack.state,
      generation: nullableTrimmed(fact.ack.generation),
      source: nullableTrimmed(fact.ack.source),
      rejectedFields: [...new Set(fact.ack.rejectedFields.map(trimmed).filter(Boolean))].sort(),
      observedAt: nullableTrimmed(fact.ack.observedAt),
    },
    quarantine: {
      state: fact.quarantine.state,
      reason: nullableTrimmed(fact.quarantine.reason),
      since: nullableTrimmed(fact.quarantine.since),
    },
  };
}

function defaultEffectiveFact(entry: ModelCapabilityStaticEntry): ModelCapabilityEffectiveFactInput {
  return normalizeEffectiveFact({
    capabilityId: entry.capabilityId,
    tool: { identity: entry.toolIdentity, callableName: entry.userEntry },
    driver: { id: 'none', kind: 'none', state: 'unknown', version: null },
    runtimeAvailability: { state: 'unknown', source: 'not-reported', reason: null, observedAt: null },
    actionAuthorization: [],
    memory: { scope: 'none', read: 'unknown', write: 'unknown', candidate: 'unknown' },
    knowledge: { appliedState: 'unknown', version: null, digest: null },
    ack: { state: 'unknown', generation: null, source: null, rejectedFields: [], observedAt: null },
    quarantine: { state: 'unknown', reason: null, since: null },
  });
}

function resolvedEffectiveFacts(
  staticManifest: ModelCapabilityStaticManifest,
  input: ModelCapabilityEffectiveFactsInput,
): readonly ModelCapabilityEffectiveFactInput[] {
  const provided = new Map(input.facts.map((fact) => [fact.capabilityId, normalizeEffectiveFact(fact)]));
  return staticManifest.entries
    .slice()
    .sort((left, right) => left.capabilityId.localeCompare(right.capabilityId))
    .map((entry) => provided.get(entry.capabilityId) ?? defaultEffectiveFact(entry));
}

function digestEffectiveFact(fact: ModelCapabilityEffectiveFactInput): unknown {
  return {
    capabilityId: fact.capabilityId,
    tool: fact.tool,
    driver: fact.driver,
    runtimeAvailability: {
      state: fact.runtimeAvailability.state,
      source: fact.runtimeAvailability.source,
      reason: fact.runtimeAvailability.reason,
    },
    actionAuthorization: fact.actionAuthorization,
    memory: fact.memory,
    knowledge: fact.knowledge,
    ack: {
      state: fact.ack.state,
      generation: fact.ack.generation,
      source: fact.ack.source,
      rejectedFields: fact.ack.rejectedFields,
    },
    quarantine: {
      state: fact.quarantine.state,
      reason: fact.quarantine.reason,
    },
  };
}

export function computeModelCapabilityStaticDigest(manifest: ModelCapabilityStaticManifest): string {
  return digest({
    schemaVersion: manifest.schemaVersion,
    sourceManifestVersion: manifest.sourceManifestVersion,
    sourceAuthorityManifestVersion: manifest.sourceAuthorityManifestVersion,
    generatedForDate: manifest.generatedForDate,
    entries: manifest.entries.slice().sort((left, right) => left.capabilityId.localeCompare(right.capabilityId)),
  });
}

export function computeModelCapabilityEffectiveDigest(
  input: ModelCapabilityEffectiveFactsInput,
  staticManifest: ModelCapabilityStaticManifest = createModelCapabilityStaticManifest(),
): string {
  const normalizedCatalogIdentity = normalizeCatalogIdentity(input.catalogIdentity);
  return digest({
    scope: normalizeScope(input.scope),
    runtimeGeneration: trimmed(input.runtimeGeneration),
    ...(normalizedCatalogIdentity ? { catalogIdentity: normalizedCatalogIdentity } : {}),
    facts: resolvedEffectiveFacts(staticManifest, input).map(digestEffectiveFact),
  });
}
function buildPromptAddition(
  staticManifest: ModelCapabilityStaticManifest,
  facts: readonly ModelCapabilityEffectiveFactInput[],
  maxChars: number,
): { promptAddition: ModelCapabilityPromptAddition; diagnostics: ModelCapabilityProfileDiagnostic[] } {
  const factById = new Map(facts.map((fact) => [fact.capabilityId, fact]));
  const visible = staticManifest.entries
    .filter((entry) => entry.visibility === 'user' && (entry.disposition === 'default' || entry.disposition === 'advanced'))
    .slice()
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
  const defaultEntries = visible.filter((entry) => entry.disposition === 'default');
  const advancedEntries = visible.filter((entry) => entry.disposition === 'advanced');
  const omittedCapabilityIds: string[] = [];

  const compose = (defaultNames: readonly string[], advancedNames: readonly string[]): string => {
    const included = visible.filter((entry) => defaultNames.includes(entry.displayName) || advancedNames.includes(entry.displayName));
    const states = (names: readonly string[]) => names.map((name) => {
      const entry = included.find((entry) => entry.displayName === name)!;
      return `${name}=${factById.get(entry.capabilityId)!.runtimeAvailability.state}`;
    }).join(', ');
    const unknownCount = included.filter((entry) => factById.get(entry.capabilityId)?.runtimeAvailability.state === 'unknown').length;
    const lines = ['Capability positioning (authoritative):'];
    if (defaultNames.length > 0) lines.push(`Default: ${states(defaultNames)}.`);
    if (advancedNames.length > 0) lines.push(`Advanced: ${states(advancedNames)}.`);
    if (included.length > 0) {
      const memory = factById.get('component.role-memory')?.memory ?? facts[0]?.memory;
      const knowledge = factById.get('component.knowledge-retrieval-source')?.knowledge ?? facts[0]?.knowledge;
      if (memory) lines.push(`Memory: scope=${memory.scope}; read=${memory.read}; write=${memory.write}; candidate=${memory.candidate}.`);
      if (knowledge) lines.push(`Knowledge: state=${knowledge.appliedState}; version=${knowledge.version?.slice(0, 64) ?? 'unknown'}.`);
      const actions = included.flatMap((entry) => {
        const facts = factById.get(entry.capabilityId)!.actionAuthorization;
        return facts.length > 0 ? [`${entry.displayName}: ${facts.map((fact) => `${fact.actionId}=${fact.authorization}`).join(', ')}`] : [];
      });
      if (actions.length > 0) lines.push(`Action permissions: ${actions.join('; ')}.`);
    }
    if (unknownCount > 0) {
      lines.push(unknownCount === included.length
        ? 'Runtime state is not yet verified for all listed capabilities; do not present them as currently active.'
        : `Runtime state is not yet verified for ${unknownCount} listed capabilities; do not present those as currently active.`);
    }
    lines.push('Internal and retired capabilities are not user-facing promises. Do not claim a capability beyond these listed facts.');
    return lines.join('\n');
  };

  let defaultNames = defaultEntries.map((entry) => entry.displayName);
  let advancedNames = advancedEntries.map((entry) => entry.displayName);
  let text = compose(defaultNames, advancedNames);
  while (text.length > maxChars && advancedNames.length > 0) {
    const removed = advancedEntries.find((entry) => entry.displayName === advancedNames.at(-1));
    if (removed) omittedCapabilityIds.push(removed.capabilityId);
    advancedNames = advancedNames.slice(0, -1);
    text = compose(defaultNames, advancedNames);
  }
  while (text.length > maxChars && defaultNames.length > 0) {
    const removed = defaultEntries.find((entry) => entry.displayName === defaultNames.at(-1));
    if (removed) omittedCapabilityIds.push(removed.capabilityId);
    defaultNames = defaultNames.slice(0, -1);
    text = compose(defaultNames, advancedNames);
  }
  if (text.length > maxChars) {
    throw new Error(`Model capability prompt budget ${maxChars} is below the required safety envelope`);
  }
  const diagnostics: ModelCapabilityProfileDiagnostic[] = omittedCapabilityIds.map((capabilityId) => ({
    code: 'prompt-capability-omitted',
    severity: 'info',
    message: `Prompt budget omitted ${capabilityId}`,
    capabilityId,
  }));
  const unknownCount = visible.filter((entry) => factById.get(entry.capabilityId)?.runtimeAvailability.state === 'unknown').length;
  if (unknownCount > 0) {
    diagnostics.push({
      code: 'runtime-state-unverified',
      severity: 'warning',
      message: `Runtime state is unknown for ${unknownCount} user-visible capabilities`,
    });
  }
  return {
    promptAddition: {
      text,
      budget: {
        maxChars,
        usedChars: text.length,
        remainingChars: maxChars - text.length,
        chargedTo: 'reserved-system-prompt',
        workContextCharsUsed: 0,
      },
      omittedCapabilityIds: [...new Set(omittedCapabilityIds)].sort(),
    },
    diagnostics,
  };
}
function profileFacts(profile: ModelCapabilityProfile): ModelCapabilityEffectiveFactsInput {
  return {
    scope: profile.scope,
    runtimeGeneration: profile.runtimeGeneration,
    observedAt: profile.observedAt,
    ...(profile.catalogIdentity ? { catalogIdentity: profile.catalogIdentity } : {}),
    facts: profile.entries.map((entry) => ({
      capabilityId: entry.capabilityId,
      tool: entry.tool,
      driver: entry.driver,
      runtimeAvailability: entry.runtimeAvailability,
      actionAuthorization: entry.actionAuthorization,
      memory: entry.memory,
      knowledge: entry.knowledge,
      ack: entry.ack,
      quarantine: entry.quarantine,
    })),
  };
}

export function validateModelCapabilityProfile(
  profile: ModelCapabilityProfile,
): ModelCapabilityProfileValidationResult {
  const issues: ModelCapabilityProfileIssue[] = [];
  if (profile.schemaVersion !== MODEL_CAPABILITY_PROFILE_SCHEMA) {
    issues.push(issue('profile_schema', `Expected ${MODEL_CAPABILITY_PROFILE_SCHEMA}`, 'schemaVersion'));
  }
  if (!isIsoTimestamp(profile.generatedAt)) issues.push(issue('generated_at_invalid', 'generatedAt must be an ISO timestamp', 'generatedAt'));
  if (!isIsoTimestamp(profile.observedAt)) issues.push(issue('profile_observed_at_invalid', 'observedAt must be an ISO timestamp', 'observedAt'));
  if (!isNonEmptyString(profile.runtimeGeneration)) issues.push(issue('profile_runtime_generation_missing', 'runtimeGeneration is required', 'runtimeGeneration'));
  issues.push(...validateCatalogIdentity(profile.catalogIdentity));
  issues.push(...validateScope(profile.scope));
  issues.push(...validateModelCapabilityStaticManifest(profile.staticManifest));

  const seen = new Set<string>();
  for (const entry of profile.entries) {
    if (seen.has(entry.capabilityId)) issues.push(issue('duplicate_profile_capability', `Duplicate profile entry ${entry.capabilityId}`, entry.capabilityId));
    seen.add(entry.capabilityId);
    const staticEntry = profile.staticManifest.entries.find((candidate) => candidate.capabilityId === entry.capabilityId);
    if (!staticEntry) {
      issues.push(issue('profile_static_entry_missing', `Profile entry has no static record: ${entry.capabilityId}`, entry.capabilityId));
      continue;
    }
    if (entry.static.disposition !== staticEntry.disposition || entry.static.visibility !== staticEntry.visibility || entry.static.owner !== staticEntry.owner) {
      issues.push(issue('profile_static_axis_mutated', `Static axis changed after manifest creation: ${entry.capabilityId}`, entry.capabilityId));
    }
    if (!MODEL_CAPABILITY_RUNTIME_AVAILABILITY_STATES.includes(entry.runtimeAvailability.state)) {
      const code = COMPONENT_DISPOSITIONS.includes(entry.runtimeAvailability.state as ComponentDisposition)
        ? 'profile_axis_conflation'
        : 'invalid_profile_runtime_availability';
      issues.push(issue(code, `Runtime availability cannot carry static disposition ${String(entry.runtimeAvailability.state)}`, entry.capabilityId));
    }
    if (entry.tool.identity.id !== staticEntry.toolIdentity.id || entry.tool.identity.kind !== staticEntry.toolIdentity.kind || entry.tool.identity.label !== staticEntry.toolIdentity.label) {
      issues.push(issue('profile_tool_identity_mismatch', `Tool identity does not match static record: ${entry.capabilityId}`, entry.capabilityId));
    }
    if (!MODEL_CAPABILITY_DRIVER_KINDS.includes(entry.driver.kind)) issues.push(issue('invalid_profile_driver_kind', `Invalid driver kind: ${entry.capabilityId}`, entry.capabilityId));
    if (!MODEL_CAPABILITY_DRIVER_STATES.includes(entry.driver.state)) issues.push(issue('invalid_profile_driver_state', `Invalid driver state: ${entry.capabilityId}`, entry.capabilityId));
    if (!isNonEmptyString(entry.driver.id)) issues.push(issue('profile_driver_id_missing', `Driver id is required: ${entry.capabilityId}`, entry.capabilityId));
    if (!isNonEmptyString(entry.runtimeAvailability.source)) issues.push(issue('profile_runtime_source_missing', `Runtime source is required: ${entry.capabilityId}`, entry.capabilityId));
    const actionIds = new Set<string>();
    for (const action of entry.actionAuthorization) {
      if (!isNonEmptyString(action.actionId)) issues.push(issue('profile_action_id_missing', `Action id is required: ${entry.capabilityId}`, entry.capabilityId));
      if (actionIds.has(action.actionId)) issues.push(issue('duplicate_profile_action_authorization', `Duplicate action ${action.actionId}: ${entry.capabilityId}`, entry.capabilityId));
      actionIds.add(action.actionId);
      if (!MODEL_CAPABILITY_ACTION_AUTHORIZATION_STATES.includes(action.authorization)) {
        issues.push(issue('invalid_profile_action_authorization', `Invalid action authorization: ${entry.capabilityId}:${action.actionId}`, entry.capabilityId));
      }
      if (action.grant) {
        if (!isNonEmptyString(action.grant.grantId)) issues.push(issue('profile_grant_id_missing', `Grant id is required: ${entry.capabilityId}:${action.actionId}`, entry.capabilityId));
        if (!MODEL_CAPABILITY_GRANT_STATES.includes(action.grant.state)) {
          issues.push(issue('invalid_profile_grant_state', `Invalid grant state: ${entry.capabilityId}:${action.actionId}`, entry.capabilityId));
        }
        if (action.grant.expiresAt !== null && !isIsoTimestamp(action.grant.expiresAt)) {
          issues.push(issue('profile_grant_expiry_invalid', `Grant expiry is invalid: ${entry.capabilityId}:${action.actionId}`, entry.capabilityId));
        }
      }
      if (action.authorization === 'requires-approval' && action.grant?.state === 'active') {
        issues.push(issue('profile_approval_axis_conflation', `requires-approval cannot carry an active grant: ${entry.capabilityId}:${action.actionId}`, entry.capabilityId));
      }
    }
    if (!MODEL_CAPABILITY_MEMORY_SCOPES.includes(entry.memory.scope)) issues.push(issue('invalid_profile_memory_scope', `Invalid memory scope: ${entry.capabilityId}`, entry.capabilityId));
    if (!MODEL_CAPABILITY_MEMORY_ACCESS_STATES.includes(entry.memory.read)) issues.push(issue('invalid_profile_memory_read', `Invalid memory read: ${entry.capabilityId}`, entry.capabilityId));
    if (!MODEL_CAPABILITY_MEMORY_ACCESS_STATES.includes(entry.memory.write)) issues.push(issue('invalid_profile_memory_write', `Invalid memory write: ${entry.capabilityId}`, entry.capabilityId));
    if (!MODEL_CAPABILITY_MEMORY_CANDIDATE_STATES.includes(entry.memory.candidate)) issues.push(issue('invalid_profile_memory_candidate', `Invalid memory candidate: ${entry.capabilityId}`, entry.capabilityId));
    if (!MODEL_CAPABILITY_KNOWLEDGE_STATES.includes(entry.knowledge.appliedState)) issues.push(issue('invalid_profile_knowledge_state', `Invalid knowledge state: ${entry.capabilityId}`, entry.capabilityId));
    if (entry.knowledge.appliedState === 'applied' && !isNonEmptyString(entry.knowledge.version)) {
      issues.push(issue('profile_applied_knowledge_version_missing', `Applied knowledge needs a version: ${entry.capabilityId}`, entry.capabilityId));
    }
    if (!MODEL_CAPABILITY_ACK_STATES.includes(entry.ack.state)) issues.push(issue('invalid_profile_ack_state', `Invalid ack state: ${entry.capabilityId}`, entry.capabilityId));
    if (entry.ack.state === 'acknowledged' && (!isNonEmptyString(entry.ack.generation) || !isNonEmptyString(entry.ack.source))) {
      issues.push(issue('profile_ack_provenance_missing', `Acknowledged fact needs generation and source: ${entry.capabilityId}`, entry.capabilityId));
    }
    if (!MODEL_CAPABILITY_QUARANTINE_STATES.includes(entry.quarantine.state)) issues.push(issue('invalid_profile_quarantine_state', `Invalid quarantine state: ${entry.capabilityId}`, entry.capabilityId));
    if (entry.runtimeAvailability.state === 'quarantined' && entry.quarantine.state !== 'quarantined') {
      issues.push(issue('profile_quarantine_state_missing', `Quarantined availability needs quarantine detail: ${entry.capabilityId}`, entry.capabilityId));
    }
  }

  const expectedVisibleIds = COMPONENT_DISPOSITION_ENTRIES.filter((entry) => entry.visibility === 'user').map((entry) => entry.id).sort();
  const actualVisibleIds = profile.entries.filter((entry) => entry.static.visibility === 'user').map((entry) => entry.capabilityId).sort();
  if (canonicalModelCapabilityJson(actualVisibleIds) !== canonicalModelCapabilityJson(expectedVisibleIds)) {
    issues.push(issue('user_capability_disposition_coverage', 'User-visible capabilities must have exactly one static disposition record', 'entries'));
  }
  const expectedStaticIds = profile.staticManifest.entries.map((entry) => entry.capabilityId).sort();
  const actualStaticIds = profile.entries.map((entry) => entry.capabilityId).sort();
  if (canonicalModelCapabilityJson(actualStaticIds) !== canonicalModelCapabilityJson(expectedStaticIds)) {
    issues.push(issue('static_manifest_profile_coverage', 'Profile entries must exactly match the static manifest', 'entries'));
  }

  const staticDigestMatches = profile.staticDigest === computeModelCapabilityStaticDigest(profile.staticManifest);
  if (!staticDigestMatches) issues.push(issue('static_digest_mismatch', 'staticDigest does not match normalized static configuration', 'staticDigest'));
  const effectiveDigestMatches = profile.effectiveDigest === computeModelCapabilityEffectiveDigest(profileFacts(profile), profile.staticManifest);
  if (!effectiveDigestMatches) issues.push(issue('effective_digest_mismatch', 'effectiveDigest does not match normalized effective facts', 'effectiveDigest'));
  if (!SHA256_DIGEST.test(profile.staticDigest)) issues.push(issue('static_digest_format', 'staticDigest must be sha256:<64 lowercase hex>', 'staticDigest'));
  if (!SHA256_DIGEST.test(profile.effectiveDigest)) issues.push(issue('effective_digest_format', 'effectiveDigest must be sha256:<64 lowercase hex>', 'effectiveDigest'));
  const prompt = profile.promptAddition;
  if (!Number.isSafeInteger(prompt.budget.maxChars) || prompt.budget.maxChars < MODEL_CAPABILITY_PROMPT_MIN_CHARS || prompt.budget.maxChars > MODEL_CAPABILITY_PROMPT_MAX_CHARS) {
    issues.push(issue('prompt_budget_invalid', `Prompt budget must be ${MODEL_CAPABILITY_PROMPT_MIN_CHARS}..${MODEL_CAPABILITY_PROMPT_MAX_CHARS} chars`, 'promptAddition.budget.maxChars'));
  }
  if (prompt.text.length > prompt.budget.maxChars) issues.push(issue('prompt_budget_exceeded', 'Prompt addition exceeds its explicit character budget', 'promptAddition.text'));
  if (prompt.budget.usedChars !== prompt.text.length) issues.push(issue('prompt_used_chars_mismatch', 'prompt usedChars must equal text length', 'promptAddition.budget.usedChars'));
  if (prompt.budget.remainingChars !== prompt.budget.maxChars - prompt.text.length) issues.push(issue('prompt_remaining_chars_mismatch', 'prompt remainingChars is inconsistent', 'promptAddition.budget.remainingChars'));
  if (prompt.budget.chargedTo !== 'reserved-system-prompt') issues.push(issue('prompt_budget_source', 'Prompt addition must be charged to the reserved system prompt', 'promptAddition.budget.chargedTo'));
  if (prompt.budget.workContextCharsUsed !== 0) issues.push(issue('prompt_encroaches_work_context', 'Prompt addition must not consume working-context characters', 'promptAddition.budget.workContextCharsUsed'));
  if (FORBIDDEN_USER_CAPABILITY_TERMS.test(prompt.text)) issues.push(issue('prompt_internal_name', 'Prompt addition contains an internal implementation name', 'promptAddition.text'));
  for (const entry of profile.entries.filter((candidate) => candidate.static.disposition === 'internal' || candidate.static.disposition === 'retired')) {
    if (prompt.text.includes(entry.static.displayName)) {
      issues.push(issue('prompt_non_user_capability', `Prompt addition exposes non-user capability ${entry.capabilityId}`, 'promptAddition.text'));
    }
  }
  for (const capabilityId of prompt.omittedCapabilityIds) {
    if (!seen.has(capabilityId)) issues.push(issue('prompt_omitted_unknown', `Prompt omission references unknown capability ${capabilityId}`, 'promptAddition.omittedCapabilityIds'));
  }

  return {
    ok: issues.length === 0,
    issues,
    userVisibleCapabilityCount: actualVisibleIds.length,
    staticDigestMatches,
    effectiveDigestMatches,
  };
}

export function assertModelCapabilityProfile(profile: ModelCapabilityProfile): ModelCapabilityProfile {
  const result = validateModelCapabilityProfile(profile);
  if (!result.ok) throw new Error(`ModelCapabilityProfile/v1 is invalid: ${result.issues.map((entry) => entry.code).join(',')}`);
  return profile;
}

export function buildModelCapabilityProfile(input: BuildModelCapabilityProfileInput): ModelCapabilityProfile {
  const staticManifest = createModelCapabilityStaticManifest();
  const issues = validateModelCapabilityStaticManifest(staticManifest);
  issues.push(...validateEffectiveFactsInput(input, staticManifest));
  if (!isIsoTimestamp(input.generatedAt)) issues.push(issue('build_generated_at_invalid', 'generatedAt must be an ISO timestamp', 'generatedAt'));
  const promptMaxChars = input.promptMaxChars ?? MODEL_CAPABILITY_PROMPT_MAX_CHARS;
  if (!Number.isSafeInteger(promptMaxChars) || promptMaxChars < MODEL_CAPABILITY_PROMPT_MIN_CHARS || promptMaxChars > MODEL_CAPABILITY_PROMPT_MAX_CHARS) {
    issues.push(issue('build_prompt_budget_invalid', `promptMaxChars must be ${MODEL_CAPABILITY_PROMPT_MIN_CHARS}..${MODEL_CAPABILITY_PROMPT_MAX_CHARS}`, 'promptMaxChars'));
  }
  if (issues.length > 0) throw new Error(`ModelCapabilityProfile/v1 input is invalid: ${issues.map((entry) => entry.code).join(',')}`);

  const facts = resolvedEffectiveFacts(staticManifest, input);
  const normalizedCatalogIdentity = normalizeCatalogIdentity(input.catalogIdentity);
  const staticDigest = computeModelCapabilityStaticDigest(staticManifest);
  const effectiveDigest = computeModelCapabilityEffectiveDigest(input, staticManifest);
  const { promptAddition, diagnostics } = buildPromptAddition(staticManifest, facts, promptMaxChars);
  const staticById = new Map(staticManifest.entries.map((entry) => [entry.capabilityId, entry]));
  const factById = new Map(facts.map((fact) => [fact.capabilityId, fact]));
  const profile: ModelCapabilityProfile = {
    schemaVersion: MODEL_CAPABILITY_PROFILE_SCHEMA,
    generatedAt: input.generatedAt,
    scope: normalizeScope(input.scope),
    runtimeGeneration: trimmed(input.runtimeGeneration),
    observedAt: input.observedAt,
    staticManifest,
    staticDigest,
    effectiveDigest,
    catalogIdentity: normalizedCatalogIdentity,
    entries: [...staticById.values()].map((staticEntry) => {
      const fact = factById.get(staticEntry.capabilityId)!;
      return {
        capabilityId: staticEntry.capabilityId,
        static: staticEntry,
        tool: fact.tool,
        driver: fact.driver,
        runtimeAvailability: fact.runtimeAvailability,
        actionAuthorization: fact.actionAuthorization,
        memory: fact.memory,
        knowledge: fact.knowledge,
        ack: fact.ack,
        quarantine: fact.quarantine,
      } satisfies ModelCapabilityProfileEntry;
    }),
    promptAddition,
    diagnostics,
  };
  return assertModelCapabilityProfile(profile);
}
