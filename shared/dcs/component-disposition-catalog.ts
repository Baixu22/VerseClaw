import { COMPONENT_AUTHORITY_DEFAULT_MODES, type ComponentAuthorityDefaultMode } from '../component-authority-manifest.js';

export const COMPONENT_DISPOSITION_MANIFEST_VERSION = 'ComponentDispositionManifest/v1' as const;
export const COMPONENT_DISPOSITIONS = ['default', 'advanced', 'internal', 'experiment', 'retired'] as const;
export const COMPONENT_DISPOSITION_VISIBILITIES = ['user', 'internal', 'retired'] as const;
export const COMPONENT_DISPOSITION_CURRENT_MODES = ['baseline', 'opt-in', 'shadow', 'mixed', 'retired'] as const;

export type ComponentDisposition = (typeof COMPONENT_DISPOSITIONS)[number];
export type ComponentDispositionVisibility = (typeof COMPONENT_DISPOSITION_VISIBILITIES)[number];
export type ComponentDispositionCurrentMode = (typeof COMPONENT_DISPOSITION_CURRENT_MODES)[number];

export type ComponentDispositionCoverage = {
  authorityComponentIds?: readonly string[];
  dcsFlagIds?: readonly string[];
  runtimeLeafPatterns?: readonly string[];
  settingsSectionIds?: readonly string[];
  settingsPanelIds?: readonly string[];
  routePaths?: readonly string[];
};

export type ComponentDispositionEntry = {
  id: string;
  label: string;
  disposition: ComponentDisposition;
  owner: string;
  implementationNodeId: string | null;
  retirementNodeId: string | null;
  visibility: ComponentDispositionVisibility;
  userEntry: string | null;
  visibilityReason?: string;
  currentMode: ComponentDispositionCurrentMode;
  targetDefaultMode: ComponentAuthorityDefaultMode;
  currentConsumers: readonly string[];
  evidenceRefs: readonly string[];
  coverage: ComponentDispositionCoverage;
  defaultOffAllowed?: boolean;
  defaultOffReason?: string;
  experimentOwner?: string;
  expiry?: string;
  graduateOrRetireCriteria?: string;
};

export type ComponentDispositionManifest = {
  schemaVersion: typeof COMPONENT_DISPOSITION_MANIFEST_VERSION;
  generatedForDate: '2026-10-21';
  entries: readonly ComponentDispositionEntry[];
};

export type ComponentDispositionValidationIssue = {
  code: string;
  message: string;
  path?: string;
};

export type ComponentDispositionCoverageInputs = {
  authorityComponentIds: readonly string[];
  dcsFlagIds: readonly string[];
  runtimeLeafPaths: readonly string[];
  settingsSectionIds: readonly string[];
  settingsPanelIds: readonly string[];
  routePaths: readonly string[];
  knownNodeIds?: ReadonlySet<string>;
  now?: string;
};

type DispositionInput = Omit<ComponentDispositionEntry, 'implementationNodeId' | 'retirementNodeId'> & {
  implementationNodeId: string;
};

const entry = (input: DispositionInput): ComponentDispositionEntry => ({
  ...input,
  implementationNodeId: input.disposition === 'retired' ? null : input.implementationNodeId,
  retirementNodeId: input.disposition === 'retired' ? input.implementationNodeId : null,
});

const AUTHORITY = 'shared/component-authority-manifest.ts';
const DCS = 'shared/dcs/prod-flags-catalog.ts';
const DEFAULTS = 'docs/dev/default-config-matrix.md';
const SEMANTICS = 'docs/clawx-product-semantics.md';
const D9 = 'docs/dev/adr/2026-10-21-d9-component-graduation-scope.md';
const RUNTIME = 'openclaw_runtime/src/config/runtime-feature-leaves.ts';
const APP = 'src/App.tsx';
const SETTINGS = 'src/pages/Settings/index.tsx';
const SETTINGS_ROUTE = 'src/pages/Settings/route-config.ts';
const LANDED = 'harness/specs/fixtures/landed-unwired-closeout/audit.json';
const EXPERIMENT_EXPIRY = '2026-12-31T23:59:59.000Z';

const CONTEXT_EVIDENCE = [AUTHORITY, RUNTIME, DEFAULTS, D9] as const;
const MEMORY_EVIDENCE = [AUTHORITY, RUNTIME, DEFAULTS, SEMANTICS] as const;
const KNOWLEDGE_EVIDENCE = [AUTHORITY, DEFAULTS, SEMANTICS, RUNTIME] as const;
const CAPABILITY_EVIDENCE = [AUTHORITY, RUNTIME, SEMANTICS, APP] as const;
const EXECUTION_EVIDENCE = [AUTHORITY, RUNTIME, LANDED, DEFAULTS] as const;
const UI_EVIDENCE = [APP, SETTINGS, SETTINGS_ROUTE, SEMANTICS] as const;

const user = (entryPoint: string) => ({ userEntry: entryPoint, visibility: 'user' as const });
const internal = (reason: string) => ({ userEntry: null, visibility: 'internal' as const, visibilityReason: reason });
const retired = (reason: string) => ({ userEntry: null, visibility: 'retired' as const, visibilityReason: reason });

export const COMPONENT_DISPOSITION_ENTRIES: readonly ComponentDispositionEntry[] = [
  entry({
    id: 'component.context-runtime-kit', label: 'Context Runtime Kit', disposition: 'internal', owner: 'context-runtime-kit', implementationNodeId: 'TF-0493', currentMode: 'baseline', targetDefaultMode: 'internal',
    ...internal('Immutable reference/selector lifecycle consumed by DCS; no separate user entry.'),
    currentConsumers: ['Context Orchestrator', 'DCS Assembler', 'context candidates'], evidenceRefs: CONTEXT_EVIDENCE,
    coverage: { authorityComponentIds: ['context-runtime-kit'], runtimeLeafPatterns: ['contextRuntimeKit.*'] },
  }),
  entry({
    id: 'component.dcs-context-authority', label: 'DCS context authority', disposition: 'internal', owner: 'dcs-context-authority', implementationNodeId: 'TF-0493', currentMode: 'baseline', targetDefaultMode: 'internal',
    ...internal('Single internal admission/compile authority; users consume its assembled turn, not the engine itself.'),
    currentConsumers: ['ordinary Chat turns', 'Context Orchestrator', 'PromptPlan'], evidenceRefs: CONTEXT_EVIDENCE,
    coverage: { authorityComponentIds: ['dcs-context-authority'], runtimeLeafPatterns: ['contextBlock.injectionBudget.*', 'contextFamily.*'] },
  }),
  entry({
    id: 'component.dcs-assembler-adapter', label: 'DCS Assembler compatibility adapter', disposition: 'internal', owner: 'dcs-assembler-compat-adapter', implementationNodeId: 'TF-0493', currentMode: 'baseline', targetDefaultMode: 'internal',
    ...internal('Compatibility adapter that emits candidates for DCS; it has no independent product surface.'),
    currentConsumers: ['legacy context blocks', 'Context Orchestrator'], evidenceRefs: CONTEXT_EVIDENCE,
    coverage: { authorityComponentIds: ['dcs-assembler-compat-adapter'] },
  }),
  entry({
    id: 'component.provider-request-guard', label: 'Provider request guard', disposition: 'internal', owner: 'provider-request-guard', implementationNodeId: 'TF-0493', currentMode: 'baseline', targetDefaultMode: 'internal',
    ...internal('Final provider-wire boundary and RequestEnvelope lineage; not a separately toggled user capability.'),
    currentConsumers: ['provider transport', 'turn receipts'], evidenceRefs: CONTEXT_EVIDENCE,
    coverage: { authorityComponentIds: ['provider-request-guard'] },
  }),
  entry({
    id: 'component.context-enhancement-gate', label: 'Context enhancement gate', disposition: 'internal', owner: 'context-enhancement-gate', implementationNodeId: 'TF-0493', currentMode: 'baseline', targetDefaultMode: 'internal',
    ...internal('Fail-closed safety gate consumed by all context enhancement paths.'),
    currentConsumers: ['DCS Assembler', 'Context Orchestrator', 'VToken/memory/CVK paths'], evidenceRefs: CONTEXT_EVIDENCE,
    coverage: { authorityComponentIds: ['context-enhancement-gate'], runtimeLeafPatterns: ['contextEnhancement.killSwitch'] },
  }),
  entry({
    id: 'component.working-memory-context', label: 'Working-memory Workspace Context', disposition: 'default', owner: 'working-memory-context-source', implementationNodeId: 'TF-0494', currentMode: 'baseline', targetDefaultMode: 'baseline',
    ...user('model context in ordinary Chat / task workspaces'),
    currentConsumers: ['DCS Assembler', 'Context Orchestrator', 'Task Ledger working context', 'Settings > General Workspace Context'], evidenceRefs: CONTEXT_EVIDENCE,
    coverage: { authorityComponentIds: ['working-memory-context-source'], dcsFlagIds: ['working-memory'], runtimeLeafPatterns: ['contextBlock.working-memory.*'], settingsPanelIds: ['WorkspaceContextPanel'] },
  }),
  entry({
    id: 'component.tool-registry-context', label: 'Tool-registry Workspace Context', disposition: 'default', owner: 'tool-registry-context-source', implementationNodeId: 'TF-0494', currentMode: 'baseline', targetDefaultMode: 'baseline',
    ...user('model tool context in ordinary Chat / task workspaces'),
    currentConsumers: ['DCS Assembler', 'Context Orchestrator', 'tool registry'], evidenceRefs: CAPABILITY_EVIDENCE,
    coverage: { authorityComponentIds: ['tool-registry-context-source'], dcsFlagIds: ['tool-registry'], runtimeLeafPatterns: ['contextBlock.tool-registry.*'] },
  }),
  entry({
    id: 'component.vtoken-context', label: 'VToken context source', disposition: 'experiment', owner: 'TF-0496', implementationNodeId: 'TF-0496', currentMode: 'opt-in', targetDefaultMode: 'internal',
    ...internal('Unexpired VToken experiment; hidden from ordinary product surfaces while value is measured.'),
    currentConsumers: ['Context Orchestrator', 'VToken assembly', 'VToken bridge'], evidenceRefs: CONTEXT_EVIDENCE,
    coverage: { authorityComponentIds: ['vtoken-context-source'], runtimeLeafPatterns: ['vtoken.assembly.*'] },
    experimentOwner: 'TF-0496', expiry: EXPERIMENT_EXPIRY, graduateOrRetireCriteria: 'Graduate only if real provider usage proves token benefit with rollback; otherwise retire by TF-0496.',
  }),
  entry({
    id: 'component.vtoken-bridge', label: 'VToken bridge', disposition: 'experiment', owner: 'TF-0496', implementationNodeId: 'TF-0496', currentMode: 'opt-in', targetDefaultMode: 'internal',
    ...internal('VToken host bridge experiment; no normal-user entry.'),
    currentConsumers: ['VToken assembly', 'Developer VToken controls'], evidenceRefs: [...CONTEXT_EVIDENCE, SETTINGS],
    coverage: { authorityComponentIds: ['vtoken-bridge'] },
    experimentOwner: 'TF-0496', expiry: EXPERIMENT_EXPIRY, graduateOrRetireCriteria: 'Keep only if VToken graduation succeeds; otherwise remove bridge and panel wiring by TF-0496.',
  }),
  entry({
    id: 'component.compass-context', label: 'COMPASS context source', disposition: 'experiment', owner: 'TF-0511', implementationNodeId: 'TF-0511', currentMode: 'opt-in', targetDefaultMode: 'internal',
    ...internal('COMPASS remains an expiring internal candidate source until the shadow-control cleanup decision.'),
    currentConsumers: ['Context Orchestrator', 'COMPASS context block'], evidenceRefs: CONTEXT_EVIDENCE,
    coverage: { authorityComponentIds: ['compass-context-source'], dcsFlagIds: ['compass-context-block'], runtimeLeafPatterns: ['contextBlock.compass.*'] },
    experimentOwner: 'TF-0511', expiry: EXPERIMENT_EXPIRY, graduateOrRetireCriteria: 'Retain only if COMPASS candidates improve measured coding outcomes and remain DCS-only; otherwise retire by TF-0511.',
  }),
  entry({
    id: 'component.c6-context-ladder', label: 'C6 context ladder source', disposition: 'experiment', owner: 'TF-0493', implementationNodeId: 'TF-0493', currentMode: 'opt-in', targetDefaultMode: 'internal',
    ...internal('C6 pressure ladder is an expiring context experiment until the single-assembly convergence decision.'),
    currentConsumers: ['Context Orchestrator', 'turn injection budget'], evidenceRefs: CONTEXT_EVIDENCE,
    coverage: { authorityComponentIds: ['c6-context-ladder-source'], dcsFlagIds: ['context-ladder'] },
    experimentOwner: 'TF-0493', expiry: EXPERIMENT_EXPIRY, graduateOrRetireCriteria: 'Keep only as a DCS-owned policy if measured context quality improves; otherwise merge or retire by TF-0493.',
  }),
  entry({
    id: 'component.dcs-context-tools', label: 'DCS fact views and context tools', disposition: 'default', owner: 'dcs-fact-view-and-tools', implementationNodeId: 'TF-0495', currentMode: 'opt-in', targetDefaultMode: 'baseline',
    ...user('model context_read/search/understand tools in ordinary Chat'),
    currentConsumers: ['context_read', 'context_search', 'context_understand', 'tool catalog'], evidenceRefs: [...CONTEXT_EVIDENCE, LANDED],
    coverage: { authorityComponentIds: ['dcs-fact-view-and-tools'], dcsFlagIds: ['context-view-tools', 'context-tools-alias'], runtimeLeafPatterns: ['contextBlock.context-write.*', 'contextBlock.context-understand.*'] },
  }),  entry({
    id: 'component.role-memory', label: 'Role-memory card governance', disposition: 'default', owner: 'role-memory-card-governance', implementationNodeId: 'TF-0498', currentMode: 'opt-in', targetDefaultMode: 'baseline',
    ...user('/agents memory cards'),
    currentConsumers: ['Agents page', 'role-memory SQLite', 'Memory review'], evidenceRefs: MEMORY_EVIDENCE,
    coverage: { authorityComponentIds: ['role-memory-card-governance'], dcsFlagIds: ['role-memory'], runtimeLeafPatterns: ['contextBlock.role-memory.*'], settingsSectionIds: ['agents'], routePaths: ['/agents'] },
  }),
  entry({
    id: 'component.native-file-memory-retrieval', label: 'Native file memory retrieval', disposition: 'internal', owner: 'native-file-memory-retrieval', implementationNodeId: 'TF-0497', currentMode: 'baseline', targetDefaultMode: 'read-only',
    ...internal('Read-only retrieval adapter consumed by memory providers; no standalone user entry.'),
    currentConsumers: ['Memory retrieval', 'hybrid search', 'role memory'], evidenceRefs: MEMORY_EVIDENCE,
    coverage: { authorityComponentIds: ['native-file-memory-retrieval'] },
  }),
  entry({
    id: 'component.runtime-memory-store', label: 'Runtime Memory store', disposition: 'internal', owner: 'runtime-memory-store', implementationNodeId: 'TF-0497', currentMode: 'opt-in', targetDefaultMode: 'internal',
    ...internal('Durable Runtime Memory domain consumed through the unified Memory control plane, not as a second user surface.'),
    currentConsumers: ['runtime facts/timeline/episodes', 'Memory diagnostics', 'context candidate source'], evidenceRefs: MEMORY_EVIDENCE,
    coverage: { authorityComponentIds: ['runtime-memory-store'], dcsFlagIds: ['runtime-memory-persist', 'runtime-memory-inject-pilot'], runtimeLeafPatterns: ['memory.shadow', 'memory.provider', 'memory.proposeFacts', 'memory.persist', 'memory.injectPilot.*'] },
  }),
  entry({
    id: 'component.memory-candidate-queue', label: 'Memory candidate queue', disposition: 'internal', owner: 'memory-candidate-queue', implementationNodeId: 'TF-0497', currentMode: 'opt-in', targetDefaultMode: 'internal',
    ...internal('Candidate and review queue is internal state; accepted memory has separate owners.'),
    currentConsumers: ['Runtime Memory extraction', 'Memory review queue'], evidenceRefs: MEMORY_EVIDENCE,
    coverage: { authorityComponentIds: ['memory-candidate-queue'], dcsFlagIds: ['runtime-memory-candidate-generation'], runtimeLeafPatterns: ['memory.candidateGeneration'] },
  }),
  entry({
    id: 'component.memory-embedding-provider', label: 'Memory embedding provider', disposition: 'internal', owner: 'memory-embedding-provider', implementationNodeId: 'TF-0497', currentMode: 'opt-in', targetDefaultMode: 'internal',
    ...internal('Embedding/index provider is retrieval infrastructure and cannot accept memory facts directly.'),
    currentConsumers: ['hybrid memory retrieval', 'memory candidate ranking'], evidenceRefs: MEMORY_EVIDENCE,
    coverage: { authorityComponentIds: ['memory-embedding-provider'] },
  }),
  entry({
    id: 'component.knowledge-review-authority', label: 'Knowledge review authority', disposition: 'default', owner: 'knowledge-review-authority', implementationNodeId: 'TF-0499', currentMode: 'mixed', targetDefaultMode: 'baseline',
    ...user('/knowledge review'),
    currentConsumers: ['Knowledge page', 'source/draft/proposal/applied workflow', 'memory-wiki'], evidenceRefs: KNOWLEDGE_EVIDENCE,
    coverage: { authorityComponentIds: ['knowledge-review-authority'], routePaths: ['/knowledge'] },
  }),
  entry({
    id: 'component.knowledge-retrieval-source', label: 'Knowledge retrieval source', disposition: 'default', owner: 'knowledge-retrieval-source', implementationNodeId: 'TF-0499', currentMode: 'mixed', targetDefaultMode: 'baseline',
    ...user('model knowledge context in ordinary Chat and Knowledge review'),
    currentConsumers: ['Knowledge retrieval', 'DCS knowledge candidate source', 'source sets'], evidenceRefs: KNOWLEDGE_EVIDENCE,
    coverage: { authorityComponentIds: ['knowledge-retrieval-source'] },
  }),
  entry({
    id: 'component.sekb-candidate-provider', label: 'SEKB candidate provider', disposition: 'experiment', owner: 'TF-0499', implementationNodeId: 'TF-0499', currentMode: 'shadow', targetDefaultMode: 'shadow',
    ...internal('SEKB is an expiring candidate/provenance provider and cannot apply knowledge or auto-write memory.'),
    currentConsumers: ['Knowledge candidates', 'runtime coding lessons', 'shadow retrieval'], evidenceRefs: KNOWLEDGE_EVIDENCE,
    coverage: { authorityComponentIds: ['sekb-candidate-provider'], dcsFlagIds: ['sekb-experience-shadow', 'sekb-retrieval-shadow'], runtimeLeafPatterns: ['contextBlock.sekb.*', 'coding.sekb.*'] },
    experimentOwner: 'TF-0499', expiry: EXPERIMENT_EXPIRY, graduateOrRetireCriteria: 'Keep only if SEKB candidates improve Knowledge review and preserve one applied-knowledge authority; otherwise retire by TF-0499.',
  }),
  entry({
    id: 'component.v3-capability-catalog', label: 'V3 capability catalog', disposition: 'internal', owner: 'v3-capability-catalog', implementationNodeId: 'TF-0501', currentMode: 'shadow', targetDefaultMode: 'internal',
    ...internal('Internal capability-descriptor adapter consumed by Tool Search; no separate user-visible capability registry or route.'),
    currentConsumers: ['Tool Search', 'Skills/MCP source registry', 'model capability self-description'], evidenceRefs: CAPABILITY_EVIDENCE,
    coverage: { authorityComponentIds: ['v3-capability-catalog'] },
  }),
  entry({
    id: 'component.skills-mcp-source-registry', label: 'Skills and MCP source registry', disposition: 'default', owner: 'skills-mcp-source-registry', implementationNodeId: 'TF-0502', currentMode: 'mixed', targetDefaultMode: 'baseline',
    ...user('Skills and Channels settings, model MCP tools'),
    currentConsumers: ['Skills page', 'Channels/MCP configuration', 'Tool Search'], evidenceRefs: CAPABILITY_EVIDENCE,
    coverage: { authorityComponentIds: ['skills-mcp-source-registry'], settingsSectionIds: ['channels'], routePaths: ['/channels'] },
  }),
  entry({
    id: 'component.tool-search-schema-expander', label: 'Tool Search schema expander', disposition: 'default', owner: 'tool-search-schema-expander', implementationNodeId: 'TF-0502', currentMode: 'mixed', targetDefaultMode: 'baseline',
    ...user('model tool discovery and schema expansion'),
    currentConsumers: ['tool_search', 'tool_describe', 'tool_call', 'Skills page'], evidenceRefs: CAPABILITY_EVIDENCE,
    coverage: { authorityComponentIds: ['tool-search-schema-expander'], runtimeLeafPatterns: ['toolRegistry.shadow'], settingsSectionIds: ['skills'], routePaths: ['/skills'] },
  }),  entry({
    id: 'component.coding-execution-backend', label: 'Coding execution backend', disposition: 'default', owner: 'coding-execution-backend', implementationNodeId: 'TF-0510', currentMode: 'mixed', targetDefaultMode: 'baseline',
    ...user('model tool, shell and file execution'),
    currentConsumers: ['agent tools', 'DCS coding loop', 'write/edit/exec'], evidenceRefs: [...EXECUTION_EVIDENCE, SETTINGS],
    coverage: { authorityComponentIds: ['coding-execution-backend'] },
  }),
  entry({
    id: 'component.verseshell-execution-adapter', label: 'VerseShell execution adapter', disposition: 'internal', owner: 'verseshell-execution-adapter', implementationNodeId: 'TF-0504', currentMode: 'opt-in', targetDefaultMode: 'internal',
    ...internal('Internal execution/evidence substrate; it must not expose a second user-visible executor.'),
    currentConsumers: ['preview_patch', 'VersedShell governed execution', 'write journal'], evidenceRefs: EXECUTION_EVIDENCE,
    coverage: { authorityComponentIds: ['verseshell-execution-adapter'], runtimeLeafPatterns: ['verseShellFoundation.*'], dcsFlagIds: ['verseshell-patch-preview'] },
  }),
  entry({
    id: 'component.permission-approval-authority', label: 'Permission and approval authority', disposition: 'default', owner: 'permission-approval-authority', implementationNodeId: 'TF-0509', currentMode: 'mixed', targetDefaultMode: 'baseline',
    ...user('tool approvals and host action permission decisions'),
    currentConsumers: ['workspace permissions', 'runtime approvals', 'ClawGraph/coding/browser effects'], evidenceRefs: EXECUTION_EVIDENCE,
    coverage: { authorityComponentIds: ['permission-approval-authority'], runtimeLeafPatterns: ['toolGovernance.*'] },
    defaultOffAllowed: true, defaultOffReason: 'Action-level approval and private/irreversible operations remain explicit-by-default regardless of component disposition.',
  }),
  entry({
    id: 'component.task-ledger', label: 'Task Ledger', disposition: 'default', owner: 'task-ledger', implementationNodeId: 'TF-0508', currentMode: 'mixed', targetDefaultMode: 'baseline',
    ...user('/task-ledger'),
    currentConsumers: ['Task Ledger page', 'working-context candidates', 'session handoff', 'mission/goal state'], evidenceRefs: [...EXECUTION_EVIDENCE, APP],
    coverage: { authorityComponentIds: ['task-ledger'], runtimeLeafPatterns: ['handoff.*', 'mission.*', 'orchestration.handoffArtifacts'], settingsSectionIds: ['recovery'], routePaths: ['/task-ledger'] },
  }),
  entry({
    id: 'component.browser-session-owner', label: 'Browser session owner', disposition: 'advanced', owner: 'browser-session-owner', implementationNodeId: 'TF-0503', currentMode: 'mixed', targetDefaultMode: 'opt-in',
    ...user('/browser'),
    currentConsumers: ['Browser page', 'agent_browser', 'supervised browser tasks'], evidenceRefs: [...EXECUTION_EVIDENCE, SETTINGS],
    coverage: { authorityComponentIds: ['browser-session-owner'], settingsSectionIds: ['browser'], settingsPanelIds: ['BrowserSettingsPanel'], routePaths: ['/browser'] },
    defaultOffAllowed: true, defaultOffReason: 'Private-network and irreversible browser actions remain action-level opt-in while supervised browser workflows are user-visible.',
  }),
  entry({
    id: 'component.browser-task-projection', label: 'Browser task projection owner', disposition: 'internal', owner: 'browser-task-projection-owner', implementationNodeId: 'TF-0503', currentMode: 'mixed', targetDefaultMode: 'internal',
    ...internal('Browser task projection is an adapter over Task Ledger; it does not own task facts.'),
    currentConsumers: ['Browser page task status', 'agent_browser'], evidenceRefs: EXECUTION_EVIDENCE,
    coverage: { authorityComponentIds: ['browser-task-projection-owner'] },
  }),
  entry({
    id: 'component.observability-recorder', label: 'Observability recorder', disposition: 'internal', owner: 'observability-recorder', implementationNodeId: 'TF-0504', currentMode: 'mixed', targetDefaultMode: 'internal',
    ...internal('Trace/receipt/log infrastructure; it records but never authorizes or executes effects.'),
    currentConsumers: ['observability traces', 'runtime receipts', 'gateway logs'], evidenceRefs: [...EXECUTION_EVIDENCE, RUNTIME],
    coverage: { authorityComponentIds: ['observability-recorder'], dcsFlagIds: ['rc03-seal'], runtimeLeafPatterns: ['eventLog.*', 'checkpointSerializer.*', 'resume.*', 'traceContext.*', 'rc03.seal'] },
  }),
  entry({
    id: 'component.routing-memo-observation', label: 'Routing Memo observation', disposition: 'experiment', owner: 'TF-0511', implementationNodeId: 'TF-0511', currentMode: 'shadow', targetDefaultMode: 'shadow',
    ...internal('Routing Memo stays shadow and is not a user-visible control surface during its time-boxed evaluation.'),
    currentConsumers: ['routing memo JSONL', 'Task Loop scorecard shadow'], evidenceRefs: [...EXECUTION_EVIDENCE, RUNTIME],
    coverage: { authorityComponentIds: ['routing-memo-observation'], dcsFlagIds: ['routing-memo-shadow'], runtimeLeafPatterns: ['coding.routingMemo.*', 'orchestration.routingMemoPilot'] },
    experimentOwner: 'TF-0511', expiry: EXPERIMENT_EXPIRY, graduateOrRetireCriteria: 'Graduate only with scorecard-backed routing quality and rollback; otherwise retire the shadow and UI references by TF-0511.',
  }),
  entry({
    id: 'component.host-api-transport-owner', label: 'Host API transport owner', disposition: 'internal', owner: 'host-api-transport-owner', implementationNodeId: 'TF-0508', currentMode: 'baseline', targetDefaultMode: 'internal',
    ...internal('Typed renderer-to-Main transport infrastructure; not a user capability.'),
    currentConsumers: ['renderer host calls', 'WS/HTTP/IPC fallback'], evidenceRefs: UI_EVIDENCE,
    coverage: { authorityComponentIds: ['host-api-transport-owner'] },
  }),
  entry({
    id: 'component.renderer-ui-surface', label: 'Renderer UI surface', disposition: 'default', owner: 'renderer-ui-surface', implementationNodeId: 'TF-0505', currentMode: 'mixed', targetDefaultMode: 'baseline',
    ...user('application shell and Settings'),
    currentConsumers: ['Chat shell', 'Settings', 'workspace panels'], evidenceRefs: UI_EVIDENCE,
    coverage: { authorityComponentIds: ['renderer-ui-surface'], settingsSectionIds: ['overview', 'general', 'system', 'archived', 'models'], settingsPanelIds: ['ProvidersSettings'], routePaths: ['/setup/*', '/', '/settings', '/settings/*', '/models'] },
  }),
  entry({
    id: 'component.retired-surface-registry', label: 'Retired surface registry', disposition: 'internal', owner: 'retired-surface-registry', implementationNodeId: 'TF-0505', currentMode: 'baseline', targetDefaultMode: 'retired',
    ...internal('Internal classification source that prevents removed surfaces from returning as claims.'),
    currentConsumers: ['retirement checks', 'product claim scan'], evidenceRefs: [...UI_EVIDENCE, SEMANTICS],
    coverage: { authorityComponentIds: ['retired-surface-registry'] },
  }),
  entry({
    id: 'feature.coding-recovery', label: 'Coding write/recovery controls', disposition: 'default', owner: 'coding-execution-backend', implementationNodeId: 'TF-0510', currentMode: 'mixed', targetDefaultMode: 'baseline',
    ...user('model coding writes and auto verification'),
    currentConsumers: ['stale-write-guard', 'write journal/WAL', 'coding auto verify'], evidenceRefs: [...EXECUTION_EVIDENCE, DCS],
    coverage: { dcsFlagIds: ['stale-write-guard', 'write-journal'], runtimeLeafPatterns: ['coding.parseOnTouch.*', 'coding.staleWriteGuard.*', 'coding.writeJournal.*', 'coding.autoVerify.*', 'coding.verifier.*'] },
  }),
  entry({
    id: 'feature.symbol-lease', label: 'Symbol lease', disposition: 'experiment', owner: 'TF-0510', implementationNodeId: 'TF-0510', currentMode: 'opt-in', targetDefaultMode: 'internal',
    ...internal('Symbol lease is a time-boxed multi-writer experiment and remains hidden from normal users.'),
    currentConsumers: ['symbol_lease tool', 'multi-writer coding guard'], evidenceRefs: [...EXECUTION_EVIDENCE, DCS],
    coverage: { dcsFlagIds: ['symbol-lease', 'symbol-lease-mode'], runtimeLeafPatterns: ['coding.symbolLease.*'] },
    experimentOwner: 'TF-0510', expiry: EXPERIMENT_EXPIRY, graduateOrRetireCriteria: 'Keep only if multi-writer benchmarks show lower conflict/rework with reliable rollback; otherwise retire by TF-0510.',
  }),
  entry({
    id: 'feature.patch-flow', label: 'Patch flow', disposition: 'experiment', owner: 'TF-0510', implementationNodeId: 'TF-0510', currentMode: 'opt-in', targetDefaultMode: 'internal',
    ...internal('Patch flow is a time-boxed coding experiment and has no ordinary-user control surface.'),
    currentConsumers: ['patch_flow tools', 'write recovery path'], evidenceRefs: [...EXECUTION_EVIDENCE, DCS],
    coverage: { dcsFlagIds: ['patch-flow'], runtimeLeafPatterns: ['coding.patchFlow.*'] },
    experimentOwner: 'TF-0510', expiry: EXPERIMENT_EXPIRY, graduateOrRetireCriteria: 'Keep only if patch execution improves verified coding outcomes and preserves write-journal authority; otherwise retire by TF-0510.',
  }),
  entry({
    id: 'feature.worktree-isolation', label: 'Worktree isolation', disposition: 'advanced', owner: 'coding-execution-backend', implementationNodeId: 'TF-0510', currentMode: 'opt-in', targetDefaultMode: 'opt-in',
    ...user('advanced multi-agent coding isolation'),
    currentConsumers: ['worktree backend', 'isolation request', 'subagent workspaces'], evidenceRefs: [...EXECUTION_EVIDENCE, DCS],
    coverage: { dcsFlagIds: ['worktree-backend', 'isolation-request'], runtimeLeafPatterns: ['coding.worktree.*'] },
  }),
  entry({
    id: 'feature.agent-map', label: 'AgentMap', disposition: 'experiment', owner: 'TF-0511', implementationNodeId: 'TF-0511', currentMode: 'shadow', targetDefaultMode: 'shadow',
    ...internal('AgentMap prompt/cutover leaves are time-boxed shadow experiments with no user surface.'),
    currentConsumers: ['agent-map provider', 'prompt assembly experiments'], evidenceRefs: [...EXECUTION_EVIDENCE, RUNTIME],
    coverage: { runtimeLeafPatterns: ['agentMap.*'] },
    experimentOwner: 'TF-0511', expiry: EXPERIMENT_EXPIRY, graduateOrRetireCriteria: 'Keep only if a measured prompt-routing benefit survives the single-capability-catalog decision; otherwise retire by TF-0511.',
  }),
  entry({
    id: 'feature.runtime-shadow-governance', label: 'Runtime shadow/governance leaves', disposition: 'experiment', owner: 'TF-0511', implementationNodeId: 'TF-0511', currentMode: 'shadow', targetDefaultMode: 'shadow',
    ...internal('Provider/catalog/governance shadow leaves are time-boxed experiments and remain invisible to users.'),
    currentConsumers: ['provider registry shadow', 'context provider pilots', 'tool protocol/evidence shadow'], evidenceRefs: [...EXECUTION_EVIDENCE, RUNTIME],
    coverage: { runtimeLeafPatterns: ['registryPilot.*', 'providerRegistry.*', 'contextProviders.*', 'registryDiagnostics.*', 'toolProtocol.*', 'evidenceVerifier.*', 'resilience.*'] },
    experimentOwner: 'TF-0511', expiry: EXPERIMENT_EXPIRY, graduateOrRetireCriteria: 'Keep only the leaves with a measured runtime or safety benefit; retire the remaining shadow stack by TF-0511.',
  }),
  entry({
    id: 'feature.local-control-plane', label: 'Local control-plane reports', disposition: 'internal', owner: 'observability-recorder', implementationNodeId: 'TF-0511', currentMode: 'mixed', targetDefaultMode: 'internal',
    ...internal('Local control-plane reports are diagnostic internal surfaces.'),
    currentConsumers: ['context Report', 'model router report', 'capability/evidence/mission reports'], evidenceRefs: [...EXECUTION_EVIDENCE, RUNTIME],
    coverage: { runtimeLeafPatterns: ['localControlPlane.*'] },
  }),  entry({
    id: 'surface.inbox', label: 'Inbox', disposition: 'advanced', owner: 'renderer-ui-surface', implementationNodeId: 'TF-0505', currentMode: 'mixed', targetDefaultMode: 'baseline',
    ...user('/inbox'),
    currentConsumers: ['Inbox route', 'host notifications'], evidenceRefs: UI_EVIDENCE,
    coverage: { routePaths: ['/inbox'] },
  }),
  entry({
    id: 'surface.cron', label: 'Cron and auto-approve', disposition: 'advanced', owner: 'renderer-ui-surface', implementationNodeId: 'TF-0505', currentMode: 'mixed', targetDefaultMode: 'opt-in',
    ...user('/cron'),
    currentConsumers: ['Cron page', 'rc05 operator slice', 'cron auto-approve policy'], evidenceRefs: [...UI_EVIDENCE, RUNTIME],
    coverage: { runtimeLeafPatterns: ['rc05.*'], routePaths: ['/cron'] },
    defaultOffAllowed: true, defaultOffReason: 'cronAutoApprove is an irreversible action and remains explicitly off unless the user authorizes it.',
  }),
  entry({
    id: 'surface.remote-tasks', label: 'Remote tasks', disposition: 'advanced', owner: 'renderer-ui-surface', implementationNodeId: 'TF-0505', currentMode: 'mixed', targetDefaultMode: 'baseline',
    ...user('/remote-tasks'),
    currentConsumers: ['Remote tasks route', 'remote task developer panel'], evidenceRefs: UI_EVIDENCE,
    coverage: { routePaths: ['/remote-tasks'] },
  }),
  entry({
    id: 'surface.clawgraph', label: 'ClawGraph', disposition: 'advanced', owner: 'coding-execution-backend', implementationNodeId: 'TF-0505', currentMode: 'mixed', targetDefaultMode: 'baseline',
    ...user('/clawgraph'),
    currentConsumers: ['ClawGraph route', 'execution graph projections'], evidenceRefs: [...UI_EVIDENCE, ...EXECUTION_EVIDENCE],
    coverage: { routePaths: ['/clawgraph'] },
  }),
  entry({
    id: 'surface.code-review', label: 'Code review', disposition: 'advanced', owner: 'renderer-ui-surface', implementationNodeId: 'TF-0505', currentMode: 'mixed', targetDefaultMode: 'baseline',
    ...user('/code-review'),
    currentConsumers: ['Code review route', 'review workflow'], evidenceRefs: UI_EVIDENCE,
    coverage: { routePaths: ['/code-review'] },
  }),
  entry({
    id: 'surface.image-generation', label: 'Image generation', disposition: 'advanced', owner: 'renderer-ui-surface', implementationNodeId: 'TF-0505', currentMode: 'mixed', targetDefaultMode: 'baseline',
    ...user('/image-generation'),
    currentConsumers: ['Image generation route', 'ImageGenerationSettings'], evidenceRefs: [...UI_EVIDENCE, SETTINGS],
    coverage: { settingsPanelIds: ['ImageGenerationSettings'], routePaths: ['/image-generation'] },
  }),
  entry({
    id: 'surface.observability', label: 'Observability', disposition: 'advanced', owner: 'observability-recorder', implementationNodeId: 'TF-0511', currentMode: 'mixed', targetDefaultMode: 'baseline',
    ...user('/observability'),
    currentConsumers: ['Observability page', 'trace/issues/problems'], evidenceRefs: [...UI_EVIDENCE, RUNTIME],
    coverage: { routePaths: ['/observability'] },
  }),
  entry({
    id: 'surface.dreams', label: 'Dreams page', disposition: 'retired', owner: 'renderer-ui-surface', implementationNodeId: 'TF-0500', currentMode: 'baseline', targetDefaultMode: 'retired',
    ...retired('Dreams is a legacy user-visible surface with no retained product authority; removal/retirement is owned by TF-0500.'),
    currentConsumers: ['Dreams route', 'legacy background consolidation references'], evidenceRefs: [...UI_EVIDENCE, DEFAULTS],
    coverage: { routePaths: ['/dreams'] },
  }),
  entry({
    id: 'surface.ui-v2-showcase', label: 'UI v2 showcase', disposition: 'retired', owner: 'renderer-ui-surface', implementationNodeId: 'TF-0505', currentMode: 'baseline', targetDefaultMode: 'retired',
    ...retired('Developer showcase route is not a product capability and is owned by surface cleanup.'),
    currentConsumers: ['UiV2Showcase route'], evidenceRefs: UI_EVIDENCE,
    coverage: { routePaths: ['/ui-v2-showcase'] },
  }),
  entry({
    id: 'settings.developer-advanced', label: 'Developer Settings advanced controls', disposition: 'advanced', owner: 'renderer-ui-surface', implementationNodeId: 'TF-0505', currentMode: 'mixed', targetDefaultMode: 'opt-in',
    ...user('Settings > Developer'),
    currentConsumers: ['Developer Settings section', 'context/coding/agent-dev/browser diagnostics'], evidenceRefs: [...UI_EVIDENCE, RUNTIME],
    coverage: { settingsSectionIds: ['developer'], settingsPanelIds: ['AgentDevWorkbenchPanel', 'ContextControlPlanePanel', 'RemoteTaskDeveloperPanel', 'DcsProdFlagsPanel', 'VtokenBridgePanel', 'ContextLayersExplainer', 'EfficiencySamplingPanel', 'HooksTrustPanel', 'ProjectRulesCenter'] },
  }),
  entry({
    id: 'settings.billing', label: 'Billing Settings', disposition: 'advanced', owner: 'renderer-ui-surface', implementationNodeId: 'TF-0505', currentMode: 'mixed', targetDefaultMode: 'baseline',
    ...user('Settings > Billing'),
    currentConsumers: ['Billing page', 'usage/cost aggregation'], evidenceRefs: UI_EVIDENCE,
    coverage: { settingsSectionIds: ['billing'] },
  }),
];

export const COMPONENT_DISPOSITION_MANIFEST: ComponentDispositionManifest = {
  schemaVersion: COMPONENT_DISPOSITION_MANIFEST_VERSION,
  generatedForDate: '2026-10-21',
  entries: COMPONENT_DISPOSITION_ENTRIES,
};function coverageIssue(code: string, message: string, pathValue?: string): ComponentDispositionValidationIssue {
  return { code, message, ...(pathValue ? { path: pathValue } : {}) };
}

export function matchComponentDispositionRuntimeLeaf(pattern: string, leafPath: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/gu, '\\$&').replaceAll('*', '.*');
  return new RegExp(`^${escaped}$`, 'u').test(leafPath);
}

function validateExactCoverage(
  entries: readonly ComponentDispositionEntry[],
  dimension: 'authorityComponentIds' | 'dcsFlagIds' | 'settingsSectionIds' | 'settingsPanelIds' | 'routePaths',
  expectedValues: readonly string[],
  issues: ComponentDispositionValidationIssue[],
): void {
  const owners = new Map<string, string>();
  for (const entry of entries) {
    for (const value of entry.coverage[dimension] ?? []) {
      const prior = owners.get(value);
      if (prior) issues.push(coverageIssue('double_disposition', `${value} is assigned to both ${prior} and ${entry.id}`, value));
      else owners.set(value, entry.id);
    }
  }
  for (const value of expectedValues) {
    if (!owners.has(value)) issues.push(coverageIssue('unclassified_component', `${dimension} has no disposition: ${value}`, value));
  }
  const expected = new Set(expectedValues);
  for (const [value, ownerId] of owners) {
    if (!expected.has(value)) issues.push(coverageIssue('unknown_coverage', `${ownerId} references unknown ${dimension}: ${value}`, value));
  }
}

export function validateComponentDispositionManifest(
  manifest: ComponentDispositionManifest = COMPONENT_DISPOSITION_MANIFEST,
  inputs: ComponentDispositionCoverageInputs,
): { ok: boolean; issues: ComponentDispositionValidationIssue[] } {
  const issues: ComponentDispositionValidationIssue[] = [];
  const ids = new Set<string>();
  const now = inputs.now ? Date.parse(inputs.now) : Date.now();
  for (const item of manifest.entries) {
    if (ids.has(item.id)) issues.push(coverageIssue('duplicate_entry', `Duplicate disposition entry: ${item.id}`, item.id));
    ids.add(item.id);
    if (!item.owner.trim()) issues.push(coverageIssue('missing_owner', `${item.id} has no owner`, item.id));
    if (!COMPONENT_DISPOSITIONS.includes(item.disposition)) issues.push(coverageIssue('invalid_disposition', `${item.id} has invalid disposition`, item.id));
    if (!COMPONENT_AUTHORITY_DEFAULT_MODES.includes(item.targetDefaultMode)) issues.push(coverageIssue('invalid_target_mode', `${item.id} has invalid target default mode`, item.id));
    if (item.currentConsumers.length === 0) issues.push(coverageIssue('missing_consumers', `${item.id} has no current consumer`, item.id));
    if (item.evidenceRefs.length === 0) issues.push(coverageIssue('missing_evidence', `${item.id} has no evidence artifact`, item.id));
    if (item.disposition === 'default' || item.disposition === 'advanced') {
      if (item.visibility !== 'user' || !item.userEntry) issues.push(coverageIssue('user_entry_required', `${item.id} is user-facing but has no user entry`, item.id));
    } else if (!item.visibilityReason?.trim()) {
      issues.push(coverageIssue('visibility_reason_missing', `${item.id} needs an internal-only or retired visibility reason`, item.id));
    }
    if (item.disposition === 'internal') {
      if (item.visibility !== 'internal' || item.userEntry) issues.push(coverageIssue('internal_boundary', `${item.id} must be internal-only`, item.id));
    } else if (item.disposition === 'experiment') {
      if (item.visibility !== 'internal' || item.userEntry) issues.push(coverageIssue('visible_experiment', `${item.id} is a user-visible experiment`, item.id));
      if (!item.experimentOwner?.trim()) issues.push(coverageIssue('experiment_owner_missing', `${item.id} experiment has no owner`, item.id));
      if (!item.expiry || Number.isNaN(Date.parse(item.expiry)) || Date.parse(item.expiry) <= now) issues.push(coverageIssue('experiment_expiry_missing', `${item.id} experiment has no future expiry`, item.id));
      if (!item.graduateOrRetireCriteria?.trim()) issues.push(coverageIssue('experiment_decision_missing', `${item.id} has no graduate/retire criteria`, item.id));
    } else if (item.disposition === 'retired') {
      if (item.visibility !== 'retired' || item.userEntry) issues.push(coverageIssue('retired_boundary', `${item.id} must be retired from the user surface`, item.id));
      if (!item.retirementNodeId) issues.push(coverageIssue('retirement_path_missing', `${item.id} has no retirement node`, item.id));
    }
    if (item.disposition !== 'retired' && !item.implementationNodeId) issues.push(coverageIssue('implementation_path_missing', `${item.id} has no implementation node`, item.id));
    for (const nodeId of [item.implementationNodeId, item.retirementNodeId].filter((value): value is string => Boolean(value))) {
      if (!/^TF-\d{4}$/u.test(nodeId)) issues.push(coverageIssue('invalid_node_id', `${item.id} references invalid node ${nodeId}`, item.id));
      if (inputs.knownNodeIds && !inputs.knownNodeIds.has(nodeId)) issues.push(coverageIssue('unknown_node', `${item.id} references missing node ${nodeId}`, item.id));
    }
    if (item.defaultOffAllowed && !item.defaultOffReason?.trim()) {
      issues.push(coverageIssue('default_off_reason_missing', `${item.id} allows default-off without a reason`, item.id));
    }
    if (item.currentMode === 'shadow' && item.visibility === 'user') {
      issues.push(coverageIssue('visible_shadow_surface', `${item.id} exposes a shadow surface to users`, item.id));
    }
  }

  validateExactCoverage(manifest.entries, 'authorityComponentIds', inputs.authorityComponentIds, issues);
  validateExactCoverage(manifest.entries, 'dcsFlagIds', inputs.dcsFlagIds, issues);
  validateExactCoverage(manifest.entries, 'settingsSectionIds', inputs.settingsSectionIds, issues);
  validateExactCoverage(manifest.entries, 'settingsPanelIds', inputs.settingsPanelIds, issues);
  validateExactCoverage(manifest.entries, 'routePaths', inputs.routePaths, issues);

  const runtimeMatches = new Map<string, string[]>();
  for (const item of manifest.entries) {
    for (const pattern of item.coverage.runtimeLeafPatterns ?? []) {
      const matches = inputs.runtimeLeafPaths.filter((leaf) => matchComponentDispositionRuntimeLeaf(pattern, leaf));
      if (matches.length === 0) issues.push(coverageIssue('runtime_pattern_unmatched', `${item.id} pattern matched no runtime leaf: ${pattern}`, pattern));
      for (const leaf of matches) {
        const owners = runtimeMatches.get(leaf) ?? [];
        owners.push(item.id);
        runtimeMatches.set(leaf, owners);
      }
    }
  }
  for (const leaf of inputs.runtimeLeafPaths) {
    const owners = runtimeMatches.get(leaf) ?? [];
    if (owners.length === 0) issues.push(coverageIssue('unclassified_runtime_leaf', `Runtime leaf has no disposition: ${leaf}`, leaf));
    if (owners.length > 1) issues.push(coverageIssue('double_disposition', `Runtime leaf is assigned to ${owners.join(',')}: ${leaf}`, leaf));
  }

  return { ok: issues.length === 0, issues };
}

export function findComponentDisposition(
  authorityComponentId: string,
  manifest: ComponentDispositionManifest = COMPONENT_DISPOSITION_MANIFEST,
): ComponentDispositionEntry | undefined {
  return manifest.entries.find((entryItem) => entryItem.coverage.authorityComponentIds?.includes(authorityComponentId));
}

export type ComponentDispositionProjection = {
  schemaVersion: 'ComponentDispositionProjection/v1';
  entries: Array<{
    id: string;
    label: string;
    disposition: ComponentDisposition;
    owner: string;
    visibility: ComponentDispositionVisibility;
    userEntry: string | null;
    implementationNodeId: string | null;
    retirementNodeId: string | null;
    expiry?: string;
  }>;
};

export function buildComponentDispositionProjection(): ComponentDispositionProjection {
  return {
    schemaVersion: 'ComponentDispositionProjection/v1',
    entries: COMPONENT_DISPOSITION_MANIFEST.entries.map((item) => ({
      id: item.id,
      label: item.label,
      disposition: item.disposition,
      owner: item.owner,
      visibility: item.visibility,
      userEntry: item.userEntry,
      implementationNodeId: item.implementationNodeId,
      retirementNodeId: item.retirementNodeId,
      ...(item.expiry ? { expiry: item.expiry } : {}),
    })),
  };
}
