import { DCS_PROD_FLAGS } from './dcs/prod-flags-catalog.js';

export const COMPONENT_AUTHORITY_MANIFEST_VERSION = 'ComponentAuthorityManifest/v1' as const;

export const COMPONENT_AUTHORITY_DOMAINS = [
  'context', 'memory', 'knowledge', 'capability', 'execution', 'permission', 'task', 'browser', 'observability', 'ui-transport',
] as const;

export const COMPONENT_AUTHORITY_SCOPES = [
  'global', 'workspace', 'session', 'task', 'run', 'turn', 'action',
] as const;

export const COMPONENT_AUTHORITY_OPERATIONS = [
  'read', 'retrieve', 'propose', 'accept', 'update', 'write', 'delete', 'publish', 'project', 'execute', 'authorize', 'approve', 'record', 'route',
] as const;

export const COMPONENT_AUTHORITY_DEFAULT_MODES = [
  'baseline', 'opt-in', 'shadow', 'read-only', 'internal', 'retired', 'disabled',
] as const;

export type ComponentAuthorityDomain = (typeof COMPONENT_AUTHORITY_DOMAINS)[number];
export type ComponentAuthorityScope = (typeof COMPONENT_AUTHORITY_SCOPES)[number];
export type ComponentAuthorityOperation = (typeof COMPONENT_AUTHORITY_OPERATIONS)[number];
export type ComponentAuthorityDefaultMode = (typeof COMPONENT_AUTHORITY_DEFAULT_MODES)[number];
export type ComponentAuthorizationRole = 'owner' | 'consumer' | 'none';

export type ComponentAuthoritySourceAnchor = { path: string; contains?: string };
export type ComponentAuthorityDefinition = {
  id: string;
  label: string;
  domains: readonly ComponentAuthorityDomain[];
  purpose: string;
  ownedDataTypes: readonly string[];
  scopes: readonly ComponentAuthorityScope[];
  allowedReads: readonly string[];
  allowedWrites: readonly string[];
  effects: readonly ComponentAuthorityOperation[];
  forbiddenActions: readonly string[];
  runtimeAvailabilitySource: string;
  defaultMode: ComponentAuthorityDefaultMode;
  authorizationRole: ComponentAuthorizationRole;
  catalogFlagIds?: readonly string[];
  sourceAnchors: readonly ComponentAuthoritySourceAnchor[];
};
export type ComponentAuthorityAssignment = {
  dataType: string;
  scope: ComponentAuthorityScope;
  operation: ComponentAuthorityOperation;
  authorityComponentId: string;
  candidateProviderIds?: readonly string[];
  readerComponentIds?: readonly string[];
  notes: string;
};
export type ComponentAuthorityManifest = {
  schemaVersion: typeof COMPONENT_AUTHORITY_MANIFEST_VERSION;
  components: readonly ComponentAuthorityDefinition[];
  authorities: readonly ComponentAuthorityAssignment[];
  productSurfaceLinks: Readonly<Record<string, readonly string[]>>;
  defaultMatrixLinks: Readonly<Record<string, readonly string[]>>;
};
export type ComponentAuthorityValidationIssue = { code: string; message: string; path?: string };
export type ComponentAuthorityValidationResult = { ok: boolean; issues: ComponentAuthorityValidationIssue[] };
export type EffectiveComponentStateInput = {
  componentId: string;
  availability: ComponentAuthorityDefaultMode;
  source: string;
  reason?: string;
};
export type ComponentAuthorityProfileEntry = {
  componentId: string;
  label: string;
  domains: readonly ComponentAuthorityDomain[];
  authorizationRole: ComponentAuthorizationRole;
  defaultMode: ComponentAuthorityDefaultMode;
  effectiveAvailability: ComponentAuthorityDefaultMode;
  effectiveSource: string;
  effectiveReason?: string;
  ownedDataTypes: readonly string[];
  forbiddenActions: readonly string[];
};
export type ComponentAuthorityProfile = {
  schemaVersion: 'ComponentAuthorityProfile/v1';
  staticManifestVersion: typeof COMPONENT_AUTHORITY_MANIFEST_VERSION;
  entries: readonly ComponentAuthorityProfileEntry[];
  modelSafeSummary: readonly string[];
};

const component = (input: ComponentAuthorityDefinition): ComponentAuthorityDefinition => input;
const authority = (input: ComponentAuthorityAssignment): ComponentAuthorityAssignment => input;
const anchor = (path: string, contains?: string): ComponentAuthoritySourceAnchor => ({ path, ...(contains ? { contains } : {}) });
const catalog = (...ids: string[]): readonly string[] => ids;

export const AUTHORITY_COMPONENTS: readonly ComponentAuthorityDefinition[] = [
  component({
    id: 'context-runtime-kit',
    label: 'Context Runtime Kit',
    domains: ['context'],
    purpose: 'Owns immutable resource references, selectors, checksums and prompt-bundle lifecycle; it does not admit or order candidates.',
    ownedDataTypes: ['context.resource-revision'],
    scopes: ['workspace', 'session', 'task', 'run'],
    allowedReads: ['context.owner-reference'],
    allowedWrites: ['context.resource-revision'],
    effects: ['project', 'update'],
    forbiddenActions: ['accept-context-candidates', 'compile-prompt-plan', 'serialize-provider-request'],
    runtimeAvailabilitySource: 'static:context-runtime-kit',
    defaultMode: 'internal',
    authorizationRole: 'none',
    sourceAnchors: [anchor('shared/types/context-runtime-kit.ts', 'export type PromptBundle =')],
  }),
  component({
    id: 'dcs-context-authority',
    label: 'DCS context authority',
    domains: ['context'],
    purpose: 'Single candidate adjudication, ordering, deduplication, budgeting and PromptPlan authority for a model turn.',
    ownedDataTypes: ['context.candidate-set', 'context.prompt-plan'],
    scopes: ['turn', 'run'],
    allowedReads: ['context.resource-revision', 'context.candidate-fragment', 'context.enhancement-policy', 'memory.role-card', 'memory.candidate', 'memory.runtime-fact', 'memory.runtime-episode', 'knowledge.applied', 'knowledge.retrieval-view', 'capability.descriptor'],
    allowedWrites: ['context.candidate-set', 'context.prompt-plan'],
    effects: ['accept', 'project'],
    forbiddenActions: ['own-source-payload', 'write-durable-memory', 'serialize-provider-request'],
    runtimeAvailabilitySource: 'static:dcs-context-orchestrator',
    defaultMode: 'baseline',
    authorizationRole: 'none',
    sourceAnchors: [
      anchor('openclaw_runtime/src/context-engine/context-orchestrator.ts', 'single production entry for memory/context enhancement'),
      anchor('openclaw_runtime/src/context-engine/context-candidate.ts', 'CONTEXT_CANDIDATE_SCHEMA'),
    ],
  }),
  component({
    id: 'dcs-assembler-compat-adapter',
    label: 'DCS Assembler compatibility adapter',
    domains: ['context'],
    purpose: 'Adapts legacy blocks and source-specific readers into candidate fragments without owning the final candidate decision.',
    ownedDataTypes: [],
    scopes: ['turn', 'run'],
    allowedReads: ['context.resource-revision', 'context.candidate-fragment', 'context.enhancement-policy'],
    allowedWrites: [],
    effects: ['propose'],
    forbiddenActions: ['accept-context-candidates', 'own-prompt-plan', 'serialize-provider-request'],
    runtimeAvailabilitySource: 'static:dcs-assembler',
    defaultMode: 'internal',
    authorizationRole: 'none',
    sourceAnchors: [anchor('openclaw_runtime/src/context-engine/assembler.ts', 'export class Assembler')],
  }),
  component({
    id: 'provider-request-guard',
    label: 'Provider request guard',
    domains: ['context', 'observability'],
    purpose: 'Owns the final RequestEnvelope digest and declared-transform registry at the provider wire boundary.',
    ownedDataTypes: ['context.request-envelope'],
    scopes: ['turn'],
    allowedReads: ['context.candidate-set', 'context.prompt-plan', 'provider.model-identity', 'provider.media', 'provider.transform-declaration'],
    allowedWrites: ['context.request-envelope'],
    effects: ['accept', 'record'],
    forbiddenActions: ['select-context-candidates', 'own-memory-or-knowledge', 'execute-tool-effect'],
    runtimeAvailabilitySource: 'static:provider-request-guard',
    defaultMode: 'internal',
    authorizationRole: 'none',
    sourceAnchors: [anchor('openclaw_runtime/src/agents/provider-transport-fetch.ts', 'export function buildGuardedModelFetch')],
  }),
  component({
    id: 'context-enhancement-gate',
    label: 'Context enhancement gate',
    domains: ['context'],
    purpose: 'Owns the fail-closed enhancement policy that can stop VToken, memory pilot, DCS blocks and CVK addition.',
    ownedDataTypes: ['context.enhancement-policy'],
    scopes: ['workspace', 'run'],
    allowedReads: ['runtime.config', 'runtime.env'],
    allowedWrites: ['context.enhancement-policy'],
    effects: ['update'],
    forbiddenActions: ['assemble-prompt-plan', 'own-source-content', 'grant-permissions'],
    runtimeAvailabilitySource: 'static:context-enhancement-kill-switch',
    defaultMode: 'baseline',
    authorizationRole: 'none',
    sourceAnchors: [anchor('openclaw_runtime/src/context-engine/enhancement-kill-switch.ts', 'export function isContextEnhancementKillSwitchEngaged')],
  }),
  component({
    id: 'working-memory-context-source',
    label: 'Working-memory context source',
    domains: ['context'],
    purpose: 'Produces task-scoped working-memory candidate fragments from the task context ledger.',
    ownedDataTypes: [],
    scopes: ['turn', 'task'],
    allowedReads: ['task.working-context', 'task.fact'],
    allowedWrites: [],
    effects: ['propose'],
    forbiddenActions: ['accept-context-candidates', 'write-task-ledger-facts'],
    runtimeAvailabilitySource: 'DCS_PROD_FLAGS:working-memory',
    defaultMode: 'opt-in',
    authorizationRole: 'none',
    catalogFlagIds: catalog('working-memory'),
    sourceAnchors: [anchor('openclaw_runtime/src/context-engine/handlers/working-memory-handler.ts', 'export function parseWorkingMemoryActions')],
  }),
  component({
    id: 'tool-registry-context-source',
    label: 'Tool-registry context source',
    domains: ['context', 'capability'],
    purpose: 'Projects tool registry metadata into a compact context candidate; it does not execute tools.',
    ownedDataTypes: [],
    scopes: ['turn'],
    allowedReads: ['capability.descriptor', 'capability.execution-schema'],
    allowedWrites: [],
    effects: ['propose'],
    forbiddenActions: ['accept-context-candidates', 'execute-tool-effect', 'authorize-tool-use'],
    runtimeAvailabilitySource: 'DCS_PROD_FLAGS:tool-registry',
    defaultMode: 'opt-in',
    authorizationRole: 'none',
    catalogFlagIds: catalog('tool-registry'),
    sourceAnchors: [anchor('openclaw_runtime/src/context-engine/handlers/tool-registry-handler.ts', 'export function formatToolRegistryInjection')],
  }),
  component({
    id: 'vtoken-context-source',
    label: 'VToken context source',
    domains: ['context'],
    purpose: 'Produces VToken-derived candidate fragments for DCS; it does not own prompt ordering or provider serialization.',
    ownedDataTypes: [],
    scopes: ['turn'],
    allowedReads: ['context.source-reference', 'provider.model-identity'],
    allowedWrites: [],
    effects: ['propose'],
    forbiddenActions: ['accept-context-candidates', 'own-prompt-plan', 'serialize-provider-request'],
    runtimeAvailabilitySource: 'docs/dev/default-config-matrix.md#VToken-assembly',
    defaultMode: 'opt-in',
    authorizationRole: 'none',
    sourceAnchors: [anchor('openclaw_runtime/src/context-engine/chat-turn-vtoken-injection.ts', 'export function resolveVtokenAssemblyConfig')],
  }),
  component({
    id: 'vtoken-bridge',
    label: 'VToken bridge',
    domains: ['context'],
    purpose: 'Owns VToken host bridge availability and RPC lifecycle while DCS owns any resulting context admission.',
    ownedDataTypes: ['vtoken.bridge-runtime'],
    scopes: ['global', 'run'],
    allowedReads: ['runtime.config', 'runtime.env'],
    allowedWrites: ['vtoken.bridge-runtime'],
    effects: ['execute', 'update'],
    forbiddenActions: ['accept-context-candidates', 'print-secret-memory', 'grant-permissions'],
    runtimeAvailabilitySource: 'docs/dev/default-config-matrix.md#VToken-bridge',
    defaultMode: 'opt-in',
    authorizationRole: 'none',
    sourceAnchors: [anchor('electron/services/vtoken-bridge.ts', 'export function readVtokenBridgeEnabledFromEnv')],
  }),
  component({
    id: 'compass-context-source',
    label: 'COMPASS context source',
    domains: ['context'],
    purpose: 'Produces bounded COMPASS context candidates and records the source projection.',
    ownedDataTypes: [],
    scopes: ['turn', 'task'],
    allowedReads: ['context.source-reference'],
    allowedWrites: [],
    effects: ['propose'],
    forbiddenActions: ['accept-context-candidates', 'write-durable-memory'],
    runtimeAvailabilitySource: 'DCS_PROD_FLAGS:compass-context-block',
    defaultMode: 'opt-in',
    authorizationRole: 'none',
    catalogFlagIds: catalog('compass-context-block'),
    sourceAnchors: [anchor('openclaw_runtime/src/context-engine/compass-context.ts', 'export function collectCompassContext')],
  }),
  component({
    id: 'c6-context-ladder-source',
    label: 'C6 context ladder source',
    domains: ['context'],
    purpose: 'Produces pressure-mode context ladder candidates; DCS remains the only prompt-plan owner.',
    ownedDataTypes: [],
    scopes: ['turn'],
    allowedReads: ['context.source-reference', 'context.token-pressure'],
    allowedWrites: [],
    effects: ['propose'],
    forbiddenActions: ['accept-context-candidates', 'own-prompt-plan'],
    runtimeAvailabilitySource: 'DCS_PROD_FLAGS:context-ladder',
    defaultMode: 'internal',
    authorizationRole: 'none',
    catalogFlagIds: catalog('context-ladder'),
    sourceAnchors: [anchor('openclaw_runtime/src/context-engine/context-ladder.ts', 'export function applyContextLadder')],
  }),
  component({
    id: 'dcs-fact-view-and-tools',
    label: 'DCS fact views and context tools',
    domains: ['context', 'capability'],
    purpose: 'Reads facts and expands context sources on demand; it does not grant mutation or bypass DCS.',
    ownedDataTypes: [],
    scopes: ['turn', 'run'],
    allowedReads: ['context.source-reference', 'context.resource-revision'],
    allowedWrites: [],
    effects: ['read', 'retrieve'],
    forbiddenActions: ['accept-context-candidates', 'write-memory-or-knowledge', 'execute-external-action'],
    runtimeAvailabilitySource: 'DCS_PROD_FLAGS:context-view-tools',
    defaultMode: 'opt-in',
    authorizationRole: 'none',
    catalogFlagIds: catalog('context-view-tools', 'context-tools-alias'),
    sourceAnchors: [anchor('openclaw_runtime/src/agents/tools/context-agent-tools.ts', 'export const DCS_ALL_CONTEXT_TOOL_NAMES')],
  }),  component({
    id: 'role-memory-card-governance',
    label: 'Role-memory card governance',
    domains: ['memory'],
    purpose: 'Owns accepted role-memory card state, review/governance transitions and card persistence.',
    ownedDataTypes: ['memory.role-card'],
    scopes: ['workspace'],
    allowedReads: ['memory.candidate', 'memory.embedding-index'],
    allowedWrites: ['memory.role-card'],
    effects: ['accept', 'update', 'delete'],
    forbiddenActions: ['accept-runtime-episode', 'own-context-prompt-plan', 'write-knowledge-applied'],
    runtimeAvailabilitySource: 'DCS_PROD_FLAGS:role-memory',
    defaultMode: 'opt-in',
    authorizationRole: 'none',
    catalogFlagIds: catalog('role-memory'),
    sourceAnchors: [anchor('openclaw_runtime/src/runtime-core/memory-governance.ts', 'export function applyGovernanceRules')],
  }),
  component({
    id: 'native-file-memory-retrieval',
    label: 'Native file memory retrieval',
    domains: ['memory'],
    purpose: 'Read-only retrieval adapter for native memory files and hybrid lexical/vector results.',
    ownedDataTypes: ['memory.native-file-query'],
    scopes: ['workspace'],
    allowedReads: ['memory.native-file', 'memory.embedding-index'],
    allowedWrites: ['memory.native-file-query'],
    effects: ['retrieve', 'project', 'update'],
    forbiddenActions: ['accept-accepted-memory', 'write-memory-card', 'own-context-prompt-plan'],
    runtimeAvailabilitySource: 'static:native-file-memory-retrieval',
    defaultMode: 'read-only',
    authorizationRole: 'none',
    sourceAnchors: [anchor('openclaw_runtime/src/runtime-core/memory-hybrid-retrieval.ts', 'export function hybridSearchFacts')],
  }),
  component({
    id: 'runtime-memory-store',
    label: 'Runtime memory store',
    domains: ['memory'],
    purpose: 'Owns accepted Runtime Memory facts, timelines and episodes; it may consume queued candidates but does not own knowledge review.',
    ownedDataTypes: ['memory.runtime-fact', 'memory.runtime-timeline', 'memory.runtime-episode'],
    scopes: ['session', 'run'],
    allowedReads: ['memory.candidate', 'memory.embedding-index', 'task.working-context'],
    allowedWrites: ['memory.runtime-fact', 'memory.runtime-timeline', 'memory.runtime-episode'],
    effects: ['accept', 'update', 'delete'],
    forbiddenActions: ['accept-role-memory-card', 'own-knowledge-apply', 'own-context-prompt-plan', 'grant-permissions'],
    runtimeAvailabilitySource: 'DCS_PROD_FLAGS:runtime-memory-persist',
    defaultMode: 'opt-in',
    authorizationRole: 'none',
    catalogFlagIds: catalog('runtime-memory-persist', 'runtime-memory-inject-pilot'),
    sourceAnchors: [anchor('openclaw_runtime/src/runtime-core/memory-store.ts', 'export class RuntimeMemoryStore')],
  }),
  component({
    id: 'memory-candidate-queue',
    label: 'Memory candidate queue',
    domains: ['memory'],
    purpose: 'Owns candidate proposals and their review status; a candidate is not accepted durable memory.',
    ownedDataTypes: ['memory.candidate'],
    scopes: ['workspace', 'session'],
    allowedReads: ['memory.runtime-fact', 'memory.runtime-episode', 'memory.role-card'],
    allowedWrites: ['memory.candidate'],
    effects: ['propose', 'update'],
    forbiddenActions: ['accept-fact-as-durable-memory', 'accept-role-memory-card', 'inject-candidate-into-prompt'],
    runtimeAvailabilitySource: 'DCS_PROD_FLAGS:runtime-memory-candidate-generation',
    defaultMode: 'opt-in',
    authorizationRole: 'none',
    catalogFlagIds: catalog('runtime-memory-candidate-generation'),
    sourceAnchors: [anchor('openclaw_runtime/src/runtime-core/memory-proposal-shadow.ts', 'export function buildRuntimeMemoryFactProposalShadow')],
  }),
  component({
    id: 'memory-embedding-provider',
    label: 'Memory embedding provider',
    domains: ['memory'],
    purpose: 'Owns embedding/index updates used by retrieval; it does not accept or mutate memory facts.',
    ownedDataTypes: ['memory.embedding-index'],
    scopes: ['workspace'],
    allowedReads: ['memory.runtime-fact', 'memory.role-card', 'memory.native-file'],
    allowedWrites: ['memory.embedding-index'],
    effects: ['update', 'delete'],
    forbiddenActions: ['accept-memory-fact', 'own-retrieval-policy', 'inject-context'],
    runtimeAvailabilitySource: 'static:memory-embedding-provider',
    defaultMode: 'opt-in',
    authorizationRole: 'none',
    sourceAnchors: [anchor('openclaw_runtime/src/runtime-core/memory-embedding-provider.ts', 'export function isEmbeddingProviderAvailable')],
  }),
  component({
    id: 'dreaming-derived-cache',
    label: 'Dreaming derived cache',
    domains: ['memory'],
    purpose: 'Owns short-term/promoted Dreaming caches derived from accepted memory; it cannot accept memory, grant retrieval, or inject prompt context.',
    ownedDataTypes: ['memory.dreaming-derived-signal'],
    scopes: ['workspace'],
    allowedReads: ['memory.runtime-fact', 'memory.runtime-episode', 'memory.role-card'],
    allowedWrites: ['memory.dreaming-derived-signal'],
    effects: ['update', 'delete'],
    forbiddenActions: ['accept-accepted-memory', 'inject-context', 'own-context-prompt-plan'],
    runtimeAvailabilitySource: 'static:memory-dreaming-derived-cache',
    defaultMode: 'internal',
    authorizationRole: 'none',
    sourceAnchors: [anchor('openclaw_runtime/src/memory-host-sdk/dreaming.ts', 'export function resolveMemoryDreamingConfig')],
  }),
  component({
    id: 'knowledge-review-authority',
    label: 'Knowledge review authority',
    domains: ['knowledge'],
    purpose: 'Owns source/draft/proposal/applied review transitions and the only accepted knowledge apply boundary.',
    ownedDataTypes: ['knowledge.source', 'knowledge.draft', 'knowledge.proposal', 'knowledge.applied'],
    scopes: ['workspace'],
    allowedReads: ['knowledge.candidate', 'knowledge.sekb-candidate', 'context.resource-revision', 'memory.role-card'],
    allowedWrites: ['knowledge.source', 'knowledge.draft', 'knowledge.proposal', 'knowledge.applied'],
    effects: ['accept', 'update', 'delete', 'publish'],
    forbiddenActions: ['accept-runtime-memory-fact', 'own-context-prompt-plan', 'auto-apply-unreviewed-candidate', 'grant-permissions'],
    runtimeAvailabilitySource: 'static:knowledge-governance-contract',
    defaultMode: 'internal',
    authorizationRole: 'none',
    sourceAnchors: [anchor('shared/knowledge/governance-contract.ts', 'export type GovernanceProposalV1')],
  }),
  component({
    id: 'knowledge-retrieval-source',
    label: 'Knowledge retrieval source',
    domains: ['knowledge', 'context'],
    purpose: 'Provides read-only knowledge references and source metadata to context candidates.',
    ownedDataTypes: ['knowledge.retrieval-view'],
    scopes: ['workspace', 'turn'],
    allowedReads: ['knowledge.source', 'knowledge.applied', 'context.resource-revision'],
    allowedWrites: ['knowledge.retrieval-view'],
    effects: ['retrieve', 'project'],
    forbiddenActions: ['apply-knowledge', 'accept-candidate', 'own-context-prompt-plan'],
    runtimeAvailabilitySource: 'static:knowledge-retrieval-source',
    defaultMode: 'read-only',
    authorizationRole: 'none',
    sourceAnchors: [anchor('shared/knowledge/governance-contract.ts', 'export interface ContextSourceAdapter')],
  }),
  component({
    id: 'sekb-candidate-provider',
    label: 'SEKB candidate provider',
    domains: ['knowledge'],
    purpose: 'Provides reviewable experience candidates and provenance; SEKB cannot append to applied knowledge or auto-write memory.',
    ownedDataTypes: ['knowledge.sekb-candidate'],
    scopes: ['workspace', 'session'],
    allowedReads: ['session.transcript', 'context.resource-revision'],
    allowedWrites: ['knowledge.sekb-candidate'],
    effects: ['propose', 'update'],
    forbiddenActions: ['apply-knowledge', 'accept-knowledge-proposal', 'write-runtime-memory-fact', 'grant-permissions'],
    runtimeAvailabilitySource: 'DCS_PROD_FLAGS:sekb-experience-shadow',
    defaultMode: 'shadow',
    authorizationRole: 'none',
    catalogFlagIds: catalog('sekb-experience-shadow', 'sekb-retrieval-shadow'),
    sourceAnchors: [anchor('openclaw_runtime/src/knowledge/sekb/feature-flags.ts', 'export function isSekbEnabled')],
  }),
  component({
    id: 'v3-capability-catalog',
    label: 'V3 capability catalog',
    domains: ['capability'],
    purpose: 'Owns capability descriptor metadata and discovery identity; descriptors intentionally do not contain executable closures.',
    ownedDataTypes: ['capability.descriptor'],
    scopes: ['global'],
    allowedReads: ['capability.source-manifest', 'capability.discovery-view'],
    allowedWrites: ['capability.descriptor'],
    effects: ['accept', 'publish'],
    forbiddenActions: ['own-executor-closure', 'execute-tool-effect', 'grant-permissions', 'own-context-candidates'],
    runtimeAvailabilitySource: 'static:v3-capability-catalog',
    defaultMode: 'internal',
    authorizationRole: 'none',
    sourceAnchors: [anchor('openclaw_runtime/src/capabilities/v3/capability-descriptor.ts', 'Executor bindings intentionally')],
  }),
  component({
    id: 'skills-mcp-source-registry',
    label: 'Skills and MCP source registry',
    domains: ['capability'],
    purpose: 'Publishes source manifests for Skills and MCP tools/schemas without deciding model-visible discovery order.',
    ownedDataTypes: ['capability.source-manifest'],
    scopes: ['global', 'workspace'],
    allowedReads: ['skill.manifest', 'mcp.tool-schema'],
    allowedWrites: ['capability.source-manifest'],
    effects: ['publish', 'update'],
    forbiddenActions: ['execute-tool-effect', 'own-discovery-view', 'grant-permissions'],
    runtimeAvailabilitySource: 'static:skills-mcp-source-registry',
    defaultMode: 'internal',
    authorizationRole: 'none',
    sourceAnchors: [anchor('shared/mcp/tool-schema.ts', 'export function isValidMcpToolInputSchema')],
  }),
  component({
    id: 'tool-search-schema-expander',
    label: 'Tool Search schema expander',
    domains: ['capability'],
    purpose: 'Owns discovery/query and on-demand schema expansion over source registries; it does not create a second executor.',
    ownedDataTypes: ['capability.discovery-view'],
    scopes: ['global', 'run'],
    allowedReads: ['capability.descriptor', 'capability.source-manifest', 'capability.execution-schema'],
    allowedWrites: ['capability.discovery-view'],
    effects: ['retrieve', 'project', 'publish'],
    forbiddenActions: ['own-executor-closure', 'accept-capability-descriptor', 'authorize-tool-use', 'write-memory-or-knowledge'],
    runtimeAvailabilitySource: 'static:tool-search-schema-expander',
    defaultMode: 'internal',
    authorizationRole: 'none',
    sourceAnchors: [anchor('openclaw_runtime/src/agents/tool-search-capability-v3.ts', 'export function buildToolSearchCapabilityBridge')],
  }),  component({
    id: 'coding-execution-backend',
    label: 'Coding execution backend',
    domains: ['execution'],
    purpose: 'Owns actual tool/shell/file effects and coding recovery mechanics; it consumes but cannot grant authorization.',
    ownedDataTypes: ['execution.tool-effect', 'execution.write-journal', 'execution.worktree'],
    scopes: ['run', 'action'],
    allowedReads: ['permission.authorization-decision', 'permission.approval-decision', 'capability.execution-schema', 'task.working-context'],
    allowedWrites: ['execution.tool-effect', 'execution.write-journal', 'execution.worktree'],
    effects: ['execute', 'write', 'update', 'delete'],
    forbiddenActions: ['authorize-tool-use', 'approve-exec-approval', 'own-task-facts', 'own-context-prompt-plan'],
    runtimeAvailabilitySource: 'DCS_PROD_FLAGS:stale-write-guard',
    defaultMode: 'opt-in',
    authorizationRole: 'consumer',
    catalogFlagIds: catalog(
      'stale-write-guard', 'write-journal', 'worktree-backend', 'isolation-request', 'symbol-lease', 'symbol-lease-mode', 'patch-flow',
    ),
    sourceAnchors: [anchor('openclaw_runtime/src/agents/agent-tools.ts', 'wrapToolWithWriteJournal')],
  }),
  component({
    id: 'verseshell-execution-adapter',
    label: 'VerseShell execution adapter',
    domains: ['execution'],
    purpose: 'Provides a governed read-only preview adapter into the existing execution backend; it does not become a second executor or authority.',
    ownedDataTypes: [],
    scopes: ['run', 'action'],
    allowedReads: ['capability.execution-schema', 'permission.authorization-decision', 'execution.write-journal'],
    allowedWrites: [],
    effects: ['read', 'project'],
    forbiddenActions: ['execute-tool-effect', 'own-write-journal', 'authorize-tool-use', 'own-task-facts'],
    runtimeAvailabilitySource: 'DCS_PROD_FLAGS:verseshell-patch-preview',
    defaultMode: 'opt-in',
    authorizationRole: 'consumer',
    catalogFlagIds: catalog('verseshell-patch-preview'),
    sourceAnchors: [anchor('openclaw_runtime/src/agents/verseshell-runtime.ts')],
  }),
  component({
    id: 'permission-approval-authority',
    label: 'Permission and approval authority',
    domains: ['permission'],
    purpose: 'Owns authorization and approval decisions for tools and host actions; execution backends only consume the decision.',
    ownedDataTypes: ['permission.authorization-decision', 'permission.approval-decision'],
    scopes: ['action', 'workspace', 'session'],
    allowedReads: ['workspace.permission-mode', 'capability.execution-schema', 'execution.tool-effect', 'browser.session', 'browser.action'],
    allowedWrites: ['permission.authorization-decision', 'permission.approval-decision'],
    effects: ['authorize', 'approve', 'record'],
    forbiddenActions: ['execute-tool-effect', 'own-browser-session', 'own-task-facts', 'own-context-prompt-plan'],
    runtimeAvailabilitySource: 'static:workspace-and-runtime-approval-authority',
    defaultMode: 'baseline',
    authorizationRole: 'owner',
    sourceAnchors: [
      anchor('electron/services/runtime-approvals-api.ts', "gatewayManager.rpc('exec.approval.resolve'"),
      anchor('electron/services/workspace-permissions.ts', 'decideGatewayRpc'),
    ],
  }),
  component({
    id: 'task-ledger',
    label: 'Task Ledger',
    domains: ['task'],
    purpose: 'Owns user-visible task facts and task-scoped working-context decisions; other components may reference it one way.',
    ownedDataTypes: ['task.fact', 'task.working-context'],
    scopes: ['workspace', 'task'],
    allowedReads: ['memory.runtime-fact', 'memory.runtime-timeline', 'memory.runtime-episode', 'knowledge.applied', 'execution.tool-effect', 'observation.routing-memo'],
    allowedWrites: ['task.fact', 'task.working-context'],
    effects: ['accept', 'update', 'delete', 'project'],
    forbiddenActions: ['own-runtime-scheduler', 'own-memory-store', 'own-context-prompt-plan', 'grant-permissions'],
    runtimeAvailabilitySource: 'static:shared-task-ledger-contract',
    defaultMode: 'internal',
    authorizationRole: 'none',
    sourceAnchors: [anchor('shared/task-ledger-working-context.ts', 'proposal/accept/reject validation')],
  }),
  component({
    id: 'browser-session-owner',
    label: 'Browser session owner',
    domains: ['browser'],
    purpose: 'Owns browser session attachment, navigation and browser action execution state, consuming permission decisions.',
    ownedDataTypes: ['browser.session', 'browser.action'],
    scopes: ['task', 'session', 'action'],
    allowedReads: ['permission.authorization-decision', 'browser.task-projection'],
    allowedWrites: ['browser.session', 'browser.action'],
    effects: ['execute', 'update', 'delete'],
    forbiddenActions: ['authorize-browser-action', 'own-task-facts', 'own-context-prompt-plan', 'write-memory-or-knowledge'],
    runtimeAvailabilitySource: 'static:browser-session-owner',
    defaultMode: 'opt-in',
    authorizationRole: 'consumer',
    sourceAnchors: [anchor('shared/agent-browser/browser-control.ts', 'export type BrowserControlMessage')],
  }),
  component({
    id: 'browser-task-projection-owner',
    label: 'Browser task projection owner',
    domains: ['browser', 'task'],
    purpose: 'Owns the browser-facing task projection while referencing Task Ledger facts one way.',
    ownedDataTypes: ['browser.task-projection'],
    scopes: ['task', 'session'],
    allowedReads: ['task.fact', 'browser.session'],
    allowedWrites: ['browser.task-projection'],
    effects: ['project', 'update'],
    forbiddenActions: ['own-task-facts', 'authorize-browser-action', 'execute-browser-action', 'write-memory-or-knowledge'],
    runtimeAvailabilitySource: 'static:agent-browser-api',
    defaultMode: 'internal',
    authorizationRole: 'none',
    sourceAnchors: [anchor('electron/services/agent-browser-api.ts', 'export async function assertBrowserAllowedUnderSandbox')],
  }),
  component({
    id: 'observability-recorder',
    label: 'Observability recorder',
    domains: ['observability'],
    purpose: 'Records traces, receipt indexes, logs and derived issues; recording never grants execution or approval authority.',
    ownedDataTypes: ['observation.trace', 'observation.receipt-index', 'observation.log'],
    scopes: ['run'],
    allowedReads: ['execution.tool-effect', 'execution.write-journal', 'permission.authorization-decision', 'permission.approval-decision', 'knowledge.sekb-candidate', 'browser.action', 'context.request-envelope', 'observation.routing-memo'],
    allowedWrites: ['observation.trace', 'observation.receipt-index', 'observation.log'],
    effects: ['record', 'update'],
    forbiddenActions: ['authorize-tool-use', 'execute-tool-effect', 'own-context-prompt-plan', 'own-memory-fact'],
    runtimeAvailabilitySource: 'DCS_PROD_FLAGS:rc03-seal',
    defaultMode: 'internal',
    authorizationRole: 'none',
    catalogFlagIds: catalog('rc03-seal'),
    sourceAnchors: [anchor('electron/services/observability-issues.ts', 'export function computeObservabilitySourceStatus')],
  }),
  component({
    id: 'routing-memo-observation',
    label: 'Routing Memo observation',
    domains: ['observability', 'capability'],
    purpose: 'Owns routing-memo shadow observations and scorecard projection; active routing requires same-session Task Loop authority.',
    ownedDataTypes: ['observation.routing-memo'],
    scopes: ['session', 'run'],
    allowedReads: ['task.fact', 'observation.trace', 'capability.descriptor'],
    allowedWrites: ['observation.routing-memo'],
    effects: ['record', 'project', 'update'],
    forbiddenActions: ['own-task-facts', 'grant-routing-permissions', 'execute-tool-effect', 'accept-context-candidates'],
    runtimeAvailabilitySource: 'DCS_PROD_FLAGS:routing-memo-shadow',
    defaultMode: 'shadow',
    authorizationRole: 'none',
    catalogFlagIds: catalog('routing-memo-shadow'),
    sourceAnchors: [anchor('openclaw_runtime/src/knowledge/routing-memo-shadow.ts', 'export function routingMemoToShadowBlock')],
  }),
  component({
    id: 'host-api-transport-owner',
    label: 'Host API transport owner',
    domains: ['ui-transport', 'permission'],
    purpose: 'Owns the renderer-to-Main typed transport and the fixed WS -> HTTP -> IPC fallback; it does not own domain data.',
    ownedDataTypes: ['ui.host-request'],
    scopes: ['workspace', 'session', 'action'],
    allowedReads: ['permission.authorization-decision', 'task.fact', 'context.request-envelope', 'browser.task-projection', 'retired.surface-class'],
    allowedWrites: ['ui.host-request'],
    effects: ['route', 'project', 'record'],
    forbiddenActions: ['read-memory-store-directly', 'write-knowledge-directly', 'call-gateway-from-renderer', 'grant-permissions'],
    runtimeAvailabilitySource: 'static:host-api-transport-owner',
    defaultMode: 'baseline',
    authorizationRole: 'none',
    sourceAnchors: [anchor('shared/host-api/contract.ts', 'export type HostApiContract'), anchor('src/lib/host-api.ts', 'invokeHost')],
  }),
  component({
    id: 'renderer-ui-surface',
    label: 'Renderer UI surface',
    domains: ['ui-transport'],
    purpose: 'Consumes typed host-api only; it cannot call Gateway directly or read/write Memory and Knowledge stores.',
    ownedDataTypes: [],
    scopes: ['workspace', 'session', 'task'],
    allowedReads: ['ui.host-request', 'task.fact', 'capability.descriptor', 'capability.discovery-view', 'retired.surface-class'],
    allowedWrites: [],
    effects: ['read', 'project'],
    forbiddenActions: ['window-electron-ipcRenderer-invoke', 'direct-gateway-fetch', 'direct-memory-read', 'direct-memory-write', 'direct-knowledge-read', 'direct-knowledge-write'],
    runtimeAvailabilitySource: 'static:renderer-ui-surface',
    defaultMode: 'baseline',
    authorizationRole: 'none',
    sourceAnchors: [anchor('tests/unit/runtime-controlled-runtime-use-readiness-boundary.test.ts', 'keeps renderer pages and components from bypassing host-api and Gateway ownership')],
  }),
  component({
    id: 'retired-surface-registry',
    label: 'Retired surface registry',
    domains: ['ui-transport'],
    purpose: 'Owns retired-surface classification and removal claims; removed surfaces cannot be used as current capability evidence.',
    ownedDataTypes: ['retired.surface-class'],
    scopes: ['global'],
    allowedReads: ['capability.descriptor', 'ui.host-request'],
    allowedWrites: ['retired.surface-class'],
    effects: ['update', 'record'],
    forbiddenActions: ['reactivate-retired-surface', 'grant-permissions', 'own-context-prompt-plan'],
    runtimeAvailabilitySource: 'static:retired-surface-registry',
    defaultMode: 'retired',
    authorizationRole: 'none',
    sourceAnchors: [anchor('docs/dev/dcs-visible-production/RETIRED-SURFACES.md')],
  }),
];

export const PRODUCT_SURFACE_AUTHORITY_LINKS = {
  'DCS coding loop': ['dcs-context-authority', 'coding-execution-backend'],
  'DCS Fact view and tool registry': ['dcs-fact-view-and-tools', 'tool-registry-context-source'],
  'VToken turn assembly': ['vtoken-context-source', 'vtoken-bridge'],
  'SEKB automatic writeback': ['sekb-candidate-provider', 'knowledge-review-authority'],
  'C6 automatic context ladder': ['c6-context-ladder-source', 'dcs-context-authority'],
  'C7 knowledge/routing cutover': ['knowledge-review-authority', 'routing-memo-observation'],
  'Coding WAL': ['coding-execution-backend'],
  'Browser supervised workflows': ['browser-session-owner', 'browser-task-projection-owner'],
  'Runtime Memory injection': ['runtime-memory-store', 'dcs-context-authority'],
  'Surfaces listed in RETIRED-SURFACES.md': ['retired-surface-registry'],
} as const satisfies Record<string, readonly string[]>;

export const DEFAULT_MATRIX_AUTHORITY_LINKS = {
  'VToken assembly': ['vtoken-context-source'],
  'VToken bridge': ['vtoken-bridge'],
  'working-memory': ['working-memory-context-source'],
  'Runtime Memory inject pilot': ['runtime-memory-store', 'dcs-context-authority'],
  'Runtime Memory shadow/provider/persist': ['runtime-memory-store', 'memory-candidate-queue', 'memory-embedding-provider'],
  'SEKB master': ['sekb-candidate-provider'],
  'SEKB auto writeback': ['sekb-candidate-provider', 'knowledge-review-authority'],
  'SEKB shadow evaluation': ['sekb-candidate-provider'],
  'Browser private network': ['browser-session-owner'],
  'Context enhancement kill switch': ['context-enhancement-gate'],
  'Coding auto verify': ['coding-execution-backend'],
} as const satisfies Record<string, readonly string[]>;export const COMPONENT_AUTHORITY_MANIFEST: ComponentAuthorityManifest = {
  schemaVersion: COMPONENT_AUTHORITY_MANIFEST_VERSION,
  components: AUTHORITY_COMPONENTS,
  authorities: [
    authority({
      dataType: 'vtoken.bridge-runtime', scope: 'global', operation: 'update', authorityComponentId: 'vtoken-bridge',
      notes: 'The VToken bridge owns only bridge runtime lifecycle; DCS owns resulting context admission.',
    }),
    authority({
      dataType: 'memory.native-file-query', scope: 'workspace', operation: 'retrieve', authorityComponentId: 'native-file-memory-retrieval',
      notes: 'Native file memory retrieval is a read-only query surface.',
    }),
    authority({
      dataType: 'execution.worktree', scope: 'run', operation: 'update', authorityComponentId: 'coding-execution-backend',
      notes: 'Worktree lifecycle remains inside the coding execution backend.',
    }),
    authority({
      dataType: 'task.working-context', scope: 'task', operation: 'update', authorityComponentId: 'task-ledger',
      readerComponentIds: ['working-memory-context-source'],
      notes: 'Task Ledger owns the task-scoped working-context proposal/accept boundary.',
    }),
    authority({
      dataType: 'context.resource-revision', scope: 'workspace', operation: 'update', authorityComponentId: 'context-runtime-kit',
      readerComponentIds: ['dcs-context-authority', 'dcs-assembler-compat-adapter', 'knowledge-retrieval-source'],
      notes: 'Only CRK assigns immutable ContextRef revisions, selectors and checksums.',
    }),
    authority({
      dataType: 'context.candidate-set', scope: 'turn', operation: 'accept', authorityComponentId: 'dcs-context-authority',
      candidateProviderIds: ['dcs-assembler-compat-adapter', 'working-memory-context-source', 'tool-registry-context-source', 'vtoken-context-source', 'compass-context-source', 'c6-context-ladder-source', 'runtime-memory-store'],
      readerComponentIds: ['provider-request-guard'],
      notes: 'DCS admits, resolves, orders and budgets candidate fragments; providers never accept their own candidates.',
    }),
    authority({
      dataType: 'context.prompt-plan', scope: 'turn', operation: 'accept', authorityComponentId: 'dcs-context-authority',
      readerComponentIds: ['provider-request-guard'],
      notes: 'Only DCS compiles the selected/omitted/order/budget/why PromptPlan.',
    }),
    authority({
      dataType: 'context.request-envelope', scope: 'turn', operation: 'accept', authorityComponentId: 'provider-request-guard',
      readerComponentIds: ['observability-recorder'],
      notes: 'Provider Guard owns final system/messages/tools/media/transform digest and wire registration.',
    }),
    authority({
      dataType: 'context.enhancement-policy', scope: 'workspace', operation: 'update', authorityComponentId: 'context-enhancement-gate',
      readerComponentIds: ['dcs-context-authority', 'dcs-assembler-compat-adapter'],
      notes: 'Kill-switch evaluation is the only enhancement policy source.',
    }),
    authority({
      dataType: 'memory.role-card', scope: 'workspace', operation: 'accept', authorityComponentId: 'role-memory-card-governance',
      candidateProviderIds: ['memory-candidate-queue'],
      readerComponentIds: ['knowledge-review-authority', 'dcs-context-authority', 'memory-embedding-provider'],
      notes: 'Role-memory card review/commit belongs only to card governance.',
    }),
    authority({
      dataType: 'memory.candidate', scope: 'session', operation: 'update', authorityComponentId: 'memory-candidate-queue',
      readerComponentIds: ['runtime-memory-store', 'role-memory-card-governance', 'dcs-context-authority'],
      notes: 'Candidate creation and status updates do not make a fact accepted.',
    }),
    authority({
      dataType: 'memory.runtime-fact', scope: 'session', operation: 'update', authorityComponentId: 'runtime-memory-store',
      candidateProviderIds: ['memory-candidate-queue'],
      readerComponentIds: ['dcs-context-authority', 'task-ledger'],
      notes: 'Accepted Runtime Memory facts belong to RuntimeMemoryStore by session.',
    }),
    authority({
      dataType: 'memory.runtime-timeline', scope: 'session', operation: 'update', authorityComponentId: 'runtime-memory-store',
      candidateProviderIds: ['memory-candidate-queue'],
      readerComponentIds: ['task-ledger'],
      notes: 'Timeline state is a Runtime Memory data domain, not a Context Plan.',
    }),
    authority({
      dataType: 'memory.runtime-episode', scope: 'session', operation: 'update', authorityComponentId: 'runtime-memory-store',
      candidateProviderIds: ['memory-candidate-queue'],
      readerComponentIds: ['task-ledger', 'dcs-context-authority'],
      notes: 'Episode capture and invalidation remain in Runtime Memory.',
    }),
    authority({
      dataType: 'memory.runtime-fact', scope: 'run', operation: 'update', authorityComponentId: 'runtime-memory-store',
      candidateProviderIds: ['memory-candidate-queue'],
      readerComponentIds: ['dcs-context-authority', 'task-ledger'],
      notes: 'Run-scoped accepted Runtime Memory facts belong to RuntimeMemoryStore.',
    }),
    authority({
      dataType: 'memory.runtime-timeline', scope: 'run', operation: 'update', authorityComponentId: 'runtime-memory-store',
      candidateProviderIds: ['memory-candidate-queue'],
      readerComponentIds: ['task-ledger'],
      notes: 'Run-scoped timeline state remains Runtime Memory data.',
    }),
    authority({
      dataType: 'memory.runtime-episode', scope: 'run', operation: 'update', authorityComponentId: 'runtime-memory-store',
      candidateProviderIds: ['memory-candidate-queue'],
      readerComponentIds: ['task-ledger', 'dcs-context-authority'],
      notes: 'Run-scoped episodes remain invalidation-owned by Runtime Memory.',
    }),
    authority({
      dataType: 'memory.native-file-query', scope: 'workspace', operation: 'update', authorityComponentId: 'native-file-memory-retrieval',
      notes: 'Transient native-file query receipts are retrieval metadata, not accepted memory.',
    }),
    authority({
      dataType: 'memory.embedding-index', scope: 'workspace', operation: 'update', authorityComponentId: 'memory-embedding-provider',
      readerComponentIds: ['native-file-memory-retrieval', 'runtime-memory-store', 'role-memory-card-governance'],
      notes: 'Embedding indexes are retrieval infrastructure and never accepted memory.',
    }),
    authority({
      dataType: 'memory.dreaming-derived-signal', scope: 'workspace', operation: 'update', authorityComponentId: 'dreaming-derived-cache',
      notes: 'Dreaming caches are derived, rebuildable signals and never accepted memory.',
    }),
    authority({
      dataType: 'memory.candidate', scope: 'workspace', operation: 'update', authorityComponentId: 'memory-candidate-queue',
      readerComponentIds: ['runtime-memory-store', 'role-memory-card-governance'],
      notes: 'Workspace-scoped candidates remain in the review queue until an accepting owner approves them.',
    }),
    authority({
      dataType: 'knowledge.source', scope: 'workspace', operation: 'update', authorityComponentId: 'knowledge-review-authority',
      readerComponentIds: ['knowledge-retrieval-source'],
      notes: 'Source review starts under the Knowledge domain owner.',
    }),
    authority({
      dataType: 'knowledge.draft', scope: 'workspace', operation: 'update', authorityComponentId: 'knowledge-review-authority',
      notes: 'Draft state is not applied knowledge.',
    }),
    authority({
      dataType: 'knowledge.proposal', scope: 'workspace', operation: 'accept', authorityComponentId: 'knowledge-review-authority',
      notes: 'Only the Knowledge reviewer can approve or reject a governance proposal.',
    }),
    authority({
      dataType: 'knowledge.applied', scope: 'workspace', operation: 'accept', authorityComponentId: 'knowledge-review-authority',
      candidateProviderIds: ['sekb-candidate-provider'],
      readerComponentIds: ['knowledge-retrieval-source', 'task-ledger', 'dcs-context-authority'],
      notes: 'SEKB can propose candidates; only the Knowledge domain owner applies them.',
    }),
    authority({
      dataType: 'knowledge.sekb-candidate', scope: 'workspace', operation: 'update', authorityComponentId: 'sekb-candidate-provider',
      readerComponentIds: ['knowledge-review-authority', 'observability-recorder'],
      notes: 'SEKB ownership stops at candidate and provenance.',
    }),
    authority({
      dataType: 'knowledge.retrieval-view', scope: 'workspace', operation: 'retrieve', authorityComponentId: 'knowledge-retrieval-source',
      readerComponentIds: ['dcs-context-authority'],
      notes: 'Retrieval is read-only and does not mutate review state.',
    }),
    authority({
      dataType: 'capability.source-manifest', scope: 'global', operation: 'update', authorityComponentId: 'skills-mcp-source-registry',
      readerComponentIds: ['v3-capability-catalog', 'tool-search-schema-expander'],
      notes: 'Skills and MCP provide source descriptors and schemas.',
    }),
    authority({
      dataType: 'capability.discovery-view', scope: 'global', operation: 'publish', authorityComponentId: 'tool-search-schema-expander',
      readerComponentIds: ['v3-capability-catalog', 'renderer-ui-surface'],
      notes: 'Tool Search owns discovery and schema expansion.',
    }),
    authority({
      dataType: 'capability.descriptor', scope: 'global', operation: 'accept', authorityComponentId: 'v3-capability-catalog',
      candidateProviderIds: ['skills-mcp-source-registry', 'tool-search-schema-expander'],
      readerComponentIds: ['dcs-context-authority', 'renderer-ui-surface'],
      notes: 'V3 accepts descriptor metadata but intentionally no executor closure.',
    }),
    authority({
      dataType: 'execution.tool-effect', scope: 'run', operation: 'execute', authorityComponentId: 'coding-execution-backend',
      readerComponentIds: ['task-ledger', 'observability-recorder', 'permission-approval-authority'],
      notes: 'One execution backend performs the effect after authorization.',
    }),
    authority({
      dataType: 'execution.write-journal', scope: 'run', operation: 'update', authorityComponentId: 'coding-execution-backend',
      readerComponentIds: ['observability-recorder', 'verseshell-execution-adapter'],
      notes: 'Write journal remains the recovery authority for coding writes.',
    }),
    authority({
      dataType: 'permission.authorization-decision', scope: 'action', operation: 'authorize', authorityComponentId: 'permission-approval-authority',
      readerComponentIds: ['coding-execution-backend', 'browser-session-owner', 'host-api-transport-owner'],
      notes: 'Execution consumes authorization; it never creates it.',
    }),
    authority({
      dataType: 'permission.approval-decision', scope: 'action', operation: 'approve', authorityComponentId: 'permission-approval-authority',
      readerComponentIds: ['coding-execution-backend', 'observability-recorder'],
      notes: 'Gateway approval list/resolve is a permission-domain decision surface.',
    }),
    authority({
      dataType: 'task.fact', scope: 'workspace', operation: 'update', authorityComponentId: 'task-ledger',
      readerComponentIds: ['working-memory-context-source', 'browser-task-projection-owner', 'routing-memo-observation', 'host-api-transport-owner'],
      notes: 'Task Ledger remains the only user-visible task-fact authority.',
    }),
    authority({
      dataType: 'browser.session', scope: 'task', operation: 'update', authorityComponentId: 'browser-session-owner',
      readerComponentIds: ['browser-task-projection-owner', 'permission-approval-authority'],
      notes: 'Browser session state belongs to the browser adapter, not Task Ledger.',
    }),
    authority({
      dataType: 'browser.action', scope: 'session', operation: 'execute', authorityComponentId: 'browser-session-owner',
      readerComponentIds: ['observability-recorder', 'permission-approval-authority'],
      notes: 'Browser action execution consumes permission; it does not decide it.',
    }),
    authority({
      dataType: 'browser.task-projection', scope: 'task', operation: 'update', authorityComponentId: 'browser-task-projection-owner',
      readerComponentIds: ['host-api-transport-owner', 'browser-session-owner'],
      notes: 'Browser task projection references Task Ledger facts one way.',
    }),
    authority({ dataType: 'observation.trace', scope: 'run', operation: 'record', authorityComponentId: 'observability-recorder', notes: 'Trace recording is not execution authority.' }),
    authority({ dataType: 'observation.receipt-index', scope: 'run', operation: 'record', authorityComponentId: 'observability-recorder', notes: 'Receipts may be produced by owners; the recorder indexes without granting effects.' }),
    authority({ dataType: 'observation.log', scope: 'run', operation: 'record', authorityComponentId: 'observability-recorder', notes: 'Logs record observed state; they do not become control state.' }),
    authority({
      dataType: 'observation.routing-memo', scope: 'session', operation: 'update', authorityComponentId: 'routing-memo-observation',
      readerComponentIds: ['task-ledger', 'observability-recorder'],
      notes: 'Routing Memo remains shadow until same-session Task Loop scorecard authority supports active use.',
    }),
    authority({
      dataType: 'ui.host-request', scope: 'workspace', operation: 'route', authorityComponentId: 'host-api-transport-owner',
      readerComponentIds: ['renderer-ui-surface'],
      notes: 'Renderer calls typed host-api; Main owns transport fallback.',
    }),
    authority({
      dataType: 'retired.surface-class', scope: 'global', operation: 'update', authorityComponentId: 'retired-surface-registry',
      readerComponentIds: ['host-api-transport-owner', 'renderer-ui-surface'],
      notes: 'A retired surface cannot be reactivated by a capability claim.',
    }),
  ],
  productSurfaceLinks: PRODUCT_SURFACE_AUTHORITY_LINKS,
  defaultMatrixLinks: DEFAULT_MATRIX_AUTHORITY_LINKS,
};const WRITE_OPERATIONS = new Set<ComponentAuthorityOperation>([
  'accept', 'update', 'write', 'delete', 'publish', 'execute', 'authorize', 'approve', 'record', 'route',
]);

export function componentAuthorityKey(
  assignment: Pick<ComponentAuthorityAssignment, 'dataType' | 'scope' | 'operation'>,
): string {
  return `${assignment.dataType}::${assignment.scope}::${assignment.operation}`;
}

export function validateComponentAuthorityManifest(
  manifest: ComponentAuthorityManifest = COMPONENT_AUTHORITY_MANIFEST,
): ComponentAuthorityValidationResult {
  const issues: ComponentAuthorityValidationIssue[] = [];
  const componentById = new Map<string, ComponentAuthorityDefinition>();
  const authorityKeys = new Map<string, ComponentAuthorityAssignment>();
  const domainsSeen = new Set<ComponentAuthorityDomain>();
  const allOwnedDataTypes = new Set<string>();

  for (const member of manifest.components) {
    if (componentById.has(member.id)) {
      issues.push({ code: 'duplicate_component', message: `Duplicate component id: ${member.id}`, path: member.id });
      continue;
    }
    componentById.set(member.id, member);
    if (member.domains.length === 0) {
      issues.push({ code: 'unowned_authority_domain', message: `${member.id} has no authority domain`, path: member.id });
    }
    for (const domain of member.domains) domainsSeen.add(domain);
    if (!member.purpose.trim()) issues.push({ code: 'missing_field', message: `${member.id} is missing purpose`, path: member.id });
    if (!member.runtimeAvailabilitySource.trim()) issues.push({ code: 'missing_field', message: `${member.id} is missing runtimeAvailabilitySource`, path: member.id });
    if (member.sourceAnchors.length === 0) issues.push({ code: 'missing_field', message: `${member.id} is missing source anchors`, path: member.id });
    if (member.authorizationRole === 'owner' && !member.domains.includes('permission')) {
      issues.push({ code: 'permission_escalation', message: `${member.id} claims authorization outside permission domain`, path: member.id });
    }
    if (member.authorizationRole !== 'owner' && member.effects.some((effect) => effect === 'authorize' || effect === 'approve')) {
      issues.push({ code: 'permission_escalation', message: `${member.id} claims authorization/approval without the permission owner role`, path: member.id });
    }
    for (const dataType of member.ownedDataTypes) {
      allOwnedDataTypes.add(dataType);
      if (!manifest.authorities.some((assignment) => assignment.authorityComponentId === member.id && assignment.dataType === dataType)) {
        issues.push({ code: 'unmapped_owned_data_type', message: `${member.id} owns ${dataType} without an authority row`, path: member.id });
      }
    }
    for (const writeType of member.allowedWrites) {
      allOwnedDataTypes.add(writeType);
      if (!member.ownedDataTypes.includes(writeType)) {
        issues.push({ code: 'unauthorized_cross_domain_write', message: `${member.id} claims a write outside ownedDataTypes: ${writeType}`, path: member.id });
      }
    }
  }

  for (const domain of COMPONENT_AUTHORITY_DOMAINS) {
    if (!domainsSeen.has(domain)) issues.push({ code: 'unowned_authority_domain', message: `No component owns domain ${domain}`, path: domain });
  }

  for (const assignment of manifest.authorities) {
    const key = componentAuthorityKey(assignment);
    if (authorityKeys.has(key)) {
      issues.push({ code: 'duplicate_authority', message: `Duplicate authority for ${key}: ${authorityKeys.get(key)?.authorityComponentId} / ${assignment.authorityComponentId}`, path: key });
    } else {
      authorityKeys.set(key, assignment);
    }
    const owner = componentById.get(assignment.authorityComponentId);
    if (!owner) {
      issues.push({ code: 'unknown_component', message: `Authority owner does not exist: ${assignment.authorityComponentId}`, path: key });
      continue;
    }
    if (!owner.scopes.includes(assignment.scope)) issues.push({ code: 'scope_escape', message: `${owner.id} does not own scope ${assignment.scope}`, path: key });
    if (!owner.ownedDataTypes.includes(assignment.dataType)) issues.push({ code: 'unowned_data_type', message: `${owner.id} does not own ${assignment.dataType}`, path: key });
    if (!owner.effects.includes(assignment.operation)) issues.push({ code: 'effect_mismatch', message: `${owner.id} does not declare effect ${assignment.operation}`, path: key });
    if (WRITE_OPERATIONS.has(assignment.operation) && !owner.allowedWrites.includes(assignment.dataType)) {
      issues.push({ code: 'write_authority_missing', message: `${owner.id} authority row writes ${assignment.dataType} without allowedWrites`, path: key });
    }
    for (const candidateId of assignment.candidateProviderIds ?? []) {
      const candidate = componentById.get(candidateId);
      if (!candidate) {
        issues.push({ code: 'unknown_component', message: `Candidate provider does not exist: ${candidateId}`, path: key });
        continue;
      }
      if (candidate.id === owner.id) issues.push({ code: 'candidate_is_authority', message: `${owner.id} is both candidate provider and authority for ${key}`, path: key });
      if (candidate.allowedWrites.includes(assignment.dataType)) {
        issues.push({ code: 'candidate_write_conflict', message: `${candidate.id} can write ${assignment.dataType} while only ${owner.id} may accept it`, path: candidate.id });
      }
    }
    for (const readerId of assignment.readerComponentIds ?? []) {
      const reader = componentById.get(readerId);
      if (!reader) issues.push({ code: 'unknown_component', message: `Reader does not exist: ${readerId}`, path: key });
      else if (!reader.allowedReads.includes(assignment.dataType)) {
        issues.push({ code: 'reader_not_declared', message: `${readerId} is a reader of ${assignment.dataType} but does not list it in allowedReads`, path: readerId });
      }
    }
  }

  for (const dataType of allOwnedDataTypes) {
    if (!manifest.authorities.some((assignment) => assignment.dataType === dataType)) {
      issues.push({ code: 'unowned_data_type', message: `No authority assignment exists for ${dataType}`, path: dataType });
    }
  }

  const mappedCatalogIds = manifest.components.flatMap((member) => member.catalogFlagIds ?? []);
  for (const [index, id] of mappedCatalogIds.entries()) {
    if (mappedCatalogIds.indexOf(id) !== index) issues.push({ code: 'duplicate_catalog_binding', message: `Catalog flag ${id} is mapped more than once`, path: id });
  }
  const expectedCatalogIds = new Set(DCS_PROD_FLAGS.map((entry) => entry.id));
  const actualCatalogIds = new Set(mappedCatalogIds);
  for (const id of expectedCatalogIds) if (!actualCatalogIds.has(id)) issues.push({ code: 'missing_catalog_binding', message: `Catalog flag ${id} has no component mapping`, path: id });
  for (const id of actualCatalogIds) if (!expectedCatalogIds.has(id)) issues.push({ code: 'unknown_catalog_binding', message: `Manifest maps unknown catalog flag ${id}`, path: id });

  for (const [surface, componentIds] of Object.entries(manifest.productSurfaceLinks)) {
    for (const componentId of componentIds) {
      if (!componentById.has(componentId)) issues.push({ code: 'unknown_component', message: `Product surface ${surface} links to unknown component ${componentId}`, path: surface });
    }
  }
  for (const [label, componentIds] of Object.entries(manifest.defaultMatrixLinks)) {
    for (const componentId of componentIds) {
      if (!componentById.has(componentId)) issues.push({ code: 'unknown_component', message: `Default matrix ${label} links to unknown component ${componentId}`, path: label });
    }
  }

  if (manifest.components.filter((member) => member.authorizationRole === 'owner').length !== 1) {
    issues.push({ code: 'permission_owner_count', message: 'Expected exactly one authorization owner' });
  }
  for (const member of manifest.components) {
    if (member.domains.includes('ui-transport') && member.authorizationRole === 'owner') {
      issues.push({ code: 'permission_escalation', message: `${member.id} cannot own authorization from the UI transport domain`, path: member.id });
    }
  }

  return { ok: issues.length === 0, issues };
}

export function assertComponentAuthorityManifest(
  manifest: ComponentAuthorityManifest = COMPONENT_AUTHORITY_MANIFEST,
): ComponentAuthorityManifest {
  const result = validateComponentAuthorityManifest(manifest);
  if (!result.ok) throw new Error(`Component authority manifest is invalid: ${result.issues.map((issue) => issue.message).join('; ')}`);
  return manifest;
}

export function buildComponentAuthorityProfile(
  effectiveStates: readonly EffectiveComponentStateInput[] = [],
): ComponentAuthorityProfile {
  assertComponentAuthorityManifest();
  const componentById = new Map(COMPONENT_AUTHORITY_MANIFEST.components.map((member) => [member.id, member]));
  const effectiveByComponent = new Map<string, EffectiveComponentStateInput>();
  for (const state of effectiveStates) {
    if (!componentById.has(state.componentId)) throw new Error(`Unknown component effective state: ${state.componentId}`);
    if (effectiveByComponent.has(state.componentId)) throw new Error(`Duplicate component effective state: ${state.componentId}`);
    if (!state.source.trim()) throw new Error(`Effective state for ${state.componentId} needs a source`);
    effectiveByComponent.set(state.componentId, state);
  }
  const entries = COMPONENT_AUTHORITY_MANIFEST.components.map((member) => {
    const effective = effectiveByComponent.get(member.id);
    return {
      componentId: member.id,
      label: member.label,
      domains: member.domains,
      authorizationRole: member.authorizationRole,
      defaultMode: member.defaultMode,
      effectiveAvailability: effective?.availability ?? member.defaultMode,
      effectiveSource: effective?.source ?? member.runtimeAvailabilitySource,
      ...(effective?.reason ? { effectiveReason: effective.reason } : {}),
      ownedDataTypes: member.ownedDataTypes,
      forbiddenActions: member.forbiddenActions,
    } satisfies ComponentAuthorityProfileEntry;
  });
  return {
    schemaVersion: 'ComponentAuthorityProfile/v1',
    staticManifestVersion: COMPONENT_AUTHORITY_MANIFEST_VERSION,
    entries,
    modelSafeSummary: entries.map((entry) =>
      `${entry.label} [${entry.componentId}]: ${entry.effectiveAvailability}; source=${entry.effectiveSource}; domains=${entry.domains.join(',') || 'none'}; writes=${entry.ownedDataTypes.join(',') || 'none'}`,
    ),
  };
}

assertComponentAuthorityManifest();