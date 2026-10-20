import { shell } from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, watch as fsWatch, type Dirent, type FSWatcher } from 'node:fs';
import { mkdir, open as openFile, readFile, readdir, rename, rm, stat, unlink, writeFile, appendFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse as parseYaml } from 'yaml';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import type { GatewayManager } from '../gateway/manager';
import type { ChatRuntimeEvent } from '../../shared/chat-runtime-events';
import { expandPath, getDataDir, getOpenClawConfigDir, getOpenClawRuntimeDir } from '../utils/paths';
import { isRecord } from './payload-utils';
import { logger } from '../utils/logger';
import { readJsonAtomic, writeJsonAtomic } from '../utils/atomic-write';
import { rotateLogIfNeeded } from '../utils/log-retention';
// R2: main-side error returns must stay inside the sanitize boundary — the
// renderer renders these strings directly in banners/toasts.
import { sanitizeUiErrorText } from '../../shared/privacy/ui-error-sanitize';
// DCS Stage 5: real BlockStore-backed experience write-back. Electron imports
// the runtime source directly (same pattern as agency-role-package-store), so
// confirmed SEKB principles land in the same openclaw-state SQLite that
// runtime context_search / context_read consume, instead of a detached journal.
import { openOpenClawStateDatabase } from '../../openclaw_runtime/src/state/openclaw-state-db';
import { BlockStore } from '../../openclaw_runtime/src/context-engine/block-store';
import {
  GovernanceStore,
  type GovernanceCandidateRecord,
  type GovernanceProposalRecord,
  type GovernanceImportParity,
} from '../../openclaw_runtime/src/knowledge/governance-store';
import {
  createMemoryWikiGovernedAdapter,
  createRoleMemoryGovernedAdapter,
  createSekbGovernedAdapter,
  governedAdapterRegistry,
} from '../../openclaw_runtime/src/knowledge/governance-adapters';
import { createContextBlockSink } from '../../openclaw_runtime/src/agents/harness/hook-context';
import { isRuntimeLineage } from '../../openclaw_runtime/src/runtime-core/lineage';
import {
  digestSourceSetContent,
  retrieveSourceSet,
  type SourceSetCandidate,
} from '../../openclaw_runtime/src/context-engine/source-set';
import {
  createSiliconFlowEmbeddingProvider,
  hasSiliconFlowEmbeddingProvider,
} from './knowledge-embedding-provider';
import type { ContextBlockSink } from '../../openclaw_runtime/src/context-engine/block';
import type {
  HostSuccess,
  ChatKnowledgeReference,
  KnowledgeAnswerFromSourceSetResult,
  KnowledgeArtifactType,
  KnowledgeRouteCandidate,
  KnowledgeRouteContextPayload,
  KnowledgeRouteContextResult,
  KnowledgeRuntimeLessonsReportResult,
  KnowledgeSekbBatchDistillSuggestPayload,
  KnowledgeSekbBatchDistillSuggestResult,
  KnowledgeSekbConfirmPrinciplePayload,
  KnowledgeSekbConfirmPrincipleResult,
  KnowledgeSekbRejectSuggestionPayload,
  KnowledgeSekbRejectSuggestionResult,
  KnowledgeSekbCaptureTrajectoryPayload,
  KnowledgeSekbCaptureTrajectoryResult,
  KnowledgeSekbRetrieveForTaskPayload,
  KnowledgeSekbRetrieveForTaskResult,
  KnowledgeSekbShadowEvaluationExportPayload,
  KnowledgeSekbShadowEvaluationExportResult,
  KnowledgeSekbShadowEvaluationProtocolPayload,
  KnowledgeSekbShadowEvaluationProtocolResult,
  KnowledgeSekbShadowEvaluationReportPayload,
  KnowledgeSekbShadowEvaluationReportResult,
  KnowledgeSekbSuggestPrinciplesPayload,
  KnowledgeSekbSuggestPrinciplesResult,
  KnowledgeApplyReviewedChangeResult,
  KnowledgeChangeOperation,
  KnowledgeChangeProposal,
  KnowledgeGovernanceCompensation,
  KnowledgeGovernanceReceipt,
  KnowledgeListGovernanceReceiptsResult,
  KnowledgeCreateDraftPayload,
  KnowledgeCreateArtifactDraftPayload,
  KnowledgeCreateInboxItemPayload,
  KnowledgeDraft,
  KnowledgeDraftActor,
  KnowledgeDraftStatus,
  KnowledgeDraftType,
  KnowledgeInboxItem,
  KnowledgeInboxKind,
  KnowledgeInboxStatus,
  KnowledgeOkfConcept,
  KnowledgeOkfFrontmatter,
  KnowledgeOkfImportItem,
  KnowledgeOkfValidationResult,
  KnowledgeOkfWarning,
  KnowledgeProvenanceRecord,
  KnowledgeProvenanceTargetKind,
  KnowledgeReferenceEvent,
  KnowledgeReferenceKind,
  KnowledgeSourceRef,
  KnowledgeSourceSet,
  KnowledgeSourceSetAnswerSource,
  KnowledgeStewardConfig,
  KnowledgeRolePlayerConfig,
  KnowledgeRoleRegistryFile,
  KnowledgeStewardConfigGetResult,
  KnowledgeStewardConfigUpdatePayload,
  KnowledgeStewardConfigUpdateResult,
  StewardSemanticReview,
  KnowledgeRouteCandidateGroup,
  KnowledgeRouteCandidateGroupKey,
  KnowledgeStewardTriage,
  KnowledgeGovernanceIssue,
  KnowledgeGovernanceResult,
  KnowledgeErrorExperienceCard,
  KnowledgeErrorExperienceEffectivenessAction,
  KnowledgeErrorGuardSignal,
  KnowledgeRetrievalDiagnostics,
  KnowledgeCompileResult,
  KnowledgeLintResult,
  KnowledgeListWatchedDirectoryEventsPayload,
  KnowledgeWatchedDirectoryConfig,
  KnowledgeWatchedDirectoryEvent,
} from '../../shared/host-api/contract';
import {
  matchErrorExperienceCards,
  normalizeErrorExperienceCard,
  updateErrorExperienceEffectiveness,
} from '../../shared/knowledge/error-experience';
import { aggregateKnowledgeQualityMetrics } from '../../shared/knowledge/quality-metrics';

const DEFAULT_MAX_FILES = 80;
const DEFAULT_MAX_BYTES_PER_FILE = 512 * 1024;
const MAX_IMPORT_FILES = 250;
const MAX_IMPORT_BYTES_PER_FILE = 2 * 1024 * 1024;
const MAX_DIRECTORY_DEPTH = 8;

const TEXT_EXTENSIONS = new Set([
  '.md',
  '.markdown',
  '.txt',
  '.json',
  '.jsonl',
  '.yaml',
  '.yml',
  '.csv',
  '.tsv',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.css',
  '.html',
  '.htm',
]);

const SKIP_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'dist',
  'build',
  '.next',
  '.turbo',
  '.cache',
  '__pycache__',
  '.venv',
]);

type ConfigSnapshot = {
  hash?: string;
  config?: Record<string, unknown>;
};

type KnowledgeFileCandidate = {
  inputPath: string;
  title?: string;
};

type KnowledgeIngestItemRecord = {
  inputPath: string;
  error?: string;
  sourcePath?: string;
  pageId?: string;
  pagePath?: string;
  title?: string;
  bytes?: number;
  created?: boolean;
};

type RuntimeLessonsReporter = () => Promise<KnowledgeRuntimeLessonsReportResult>;

const EMPTY_BATCH_METRIC = { status: 'unavailable' as const, reason: 'not_persisted' };
const EMPTY_RUNTIME_LESSONS_EVIDENCE: KnowledgeRuntimeLessonsReportResult['evidence'] = {
  state: 'unknown',
  ageDistribution: { underHour: 0, underDay: 0, underWeek: 0, older: 0, invalid: 0 },
  trajectoriesByOutcome: { success: 0, partial: 0, failure: 0 },
  steps: { min: 0, max: 0, average: 0 },
  durationSeconds: { min: 0, max: 0, average: 0 },
  errorSignatures: { withoutSignature: 0, distinct: 0, recurringTrajectories: 0 },
  shadow: {
    evaluatedTrajectories: 0,
    captureRecommendations: { retain: 0, review_low_signal: 0 },
    completionStatuses: { supported: 0, partial: 0, unsupported: 0, unknown: 0 },
  },
  feedback: {
    confirmedPrinciples: 0,
    rejectedSuggestions: 0,
    rejectionBreakdown: { general: 0, batchAssisted: 0 },
    retrievals: 0,
    adoptions: 0,
    postAdoptionSuccesses: 0,
  },
  batchDistillationAssistant: {
    state: 'unknown',
    suggestionCount: EMPTY_BATCH_METRIC,
    acceptedCount: EMPTY_BATCH_METRIC,
    rejectedCount: EMPTY_BATCH_METRIC,
    normalizedEditDistance: EMPTY_BATCH_METRIC,
    duplicateSuggestionRate: { status: 'unavailable', reason: 'not_evaluated' },
    sourceAttributionCompleteness: { status: 'unavailable', reason: 'not_evaluated' },
    inputTokens: EMPTY_BATCH_METRIC,
    outputTokens: EMPTY_BATCH_METRIC,
    totalCostUsd: EMPTY_BATCH_METRIC,
    fallbackCount: EMPTY_BATCH_METRIC,
    subsequentAdoption: EMPTY_BATCH_METRIC,
  },
  metricsUnavailable: [
    { metric: 'historical_suggestion_count', reason: 'not_persisted' },
    { metric: 'suggestion_edit_distance', reason: 'not_persisted' },
    { metric: 'historical_acceptance_rate', reason: 'not_persisted' },
    { metric: 'duplicate_principle_rate', reason: 'not_evaluated' },
  ],
};

const EMPTY_RUNTIME_LESSONS_REPORT: Omit<
  KnowledgeRuntimeLessonsReportResult,
  'success' | 'available' | 'reason'
> = {
  counts: { trajectories: 0, undistilledTrajectories: 0, activePrinciples: 0 },
  undistilled: [],
  activePrinciples: [],
  indexPreview: '',
  evidence: EMPTY_RUNTIME_LESSONS_EVIDENCE,
};

/** Align Host SEKB state with Electron/OPENCLAW_STATE_DIR (pnpm dev: %APPDATA%/Electron/openclaw-source-state). */
export function resolveHostOpenClawStateDir(
  env: NodeJS.ProcessEnv = process.env,
  userDataDir: string = getDataDir(),
): string {
  const fromEnv = env.OPENCLAW_STATE_DIR?.trim();
  if (fromEnv) return fromEnv;
  return join(userDataDir, 'openclaw-source-state');
}

/**
 * Artifact workspace root for offline SEKB evaluation only.
 * Prefer VERSE_CLAW_REPO_ROOT; never default to process.cwd().
 */
export function resolveHostSekbWorkspaceRoot(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.VERSE_CLAW_REPO_ROOT?.trim();
  if (fromEnv) return fromEnv;
  return resolve(getOpenClawRuntimeDir(), '..');
}

type HostExperienceShadowOptions = {
  workspaceRoot: string;
  enabled: true;
  dualWrite: true;
};

/**
 * Resolve the explicit host confirm API shadow request. Omitted/false returns
 * undefined so the production options stay byte-identical to the pre-feature
 * call. The host owns workspaceRoot; callers cannot choose an arbitrary path.
 */
function resolveHostExperienceShadowOptions(value: unknown): HostExperienceShadowOptions | undefined {
  if (!isRecord(value) || value.enabled !== true) return undefined;
  return {
    workspaceRoot: resolveHostSekbWorkspaceRoot(),
    enabled: true,
    dualWrite: true,
  };
}

type SekbRuntimeModule = {
  KnowledgeStore: new (options?: { database?: { env?: NodeJS.ProcessEnv } }) => {
    query_trajectories: (filters?: Record<string, unknown>) => unknown[];
  };
  DistillationTool: new (options: { store: unknown }) => {
    suggest_principles_from_trajectories: (
      trajectoryIds?: string[] | null,
      minClusterSize?: number,
    ) => unknown[];
    confirm_and_save: (
      suggestion: unknown,
      edits?: unknown,
      options?: {
        sessionId?: string;
        requireSession?: boolean;
        sourceSystem?: unknown;
        integrityClaim?: unknown;
        summaryOnly?: boolean;
        contextBlockSink?: ContextBlockSink;
        experienceShadow?: HostExperienceShadowOptions;
      },
    ) => string;
    confirm_and_save_with_lineage?: (
      suggestion: unknown,
      edits?: unknown,
      options?: {
        sessionId?: string;
        requireSession?: boolean;
        sourceSystem?: unknown;
        integrityClaim?: unknown;
        summaryOnly?: boolean;
        contextBlockSink?: ContextBlockSink;
        experienceShadow?: HostExperienceShadowOptions;
        contextBlockSinkKind?: 'blockstore' | 'journal';
      },
    ) => Promise<{
      principleId: string;
      provenance?: KnowledgeSekbConfirmPrincipleResult['provenance'];
      dcsWrite: 'persisted' | 'journaled_degraded' | 'rejected' | 'not_attempted' | 'written' | 'skipped';
      projectionBlockId?: string;
      highTrustEligible: boolean;
    }>;
    reject_suggestion: (suggestion: unknown, reason?: string) => void;
  };
  TrajectoryCapture: new (options: { store: unknown }) => {
    start_trajectory: (
      taskIntent: string,
      taskType: string,
      contextTags: string[],
      metadata?: Record<string, unknown>,
    ) => string;
    log_step: (trajectoryId: string, action: string, input: unknown, output: unknown) => void;
    finish_trajectory: (
      trajectoryId: string,
      outcome: 'success' | 'failure' | 'partial',
      rawError?: string | null,
    ) => { trajectory_id: string; steps: unknown[] };
  };
  RetrievalEngine: new (options: { store: unknown }) => {
    retrieve_for_task: (
      taskIntent: string,
      taskType: string,
      contextTags: string[],
      topK?: number,
    ) => Array<{
      principle_id: string;
      title: string;
      condition: string;
      action: string;
      reason: string;
      retrieval_count: number;
    }>;
    format_for_injection: (principles: Array<{ principle_id: string; title: string }>) => string;
  };
  SekbBatchDistillationAssistant: new (options: Record<string, unknown>) => {
    suggest: (input: Record<string, unknown>) => Promise<{
      suggestions: unknown[];
      userVisibleStatus: string;
      operatorEvidence?: Record<string, unknown>;
      mode?: string;
    }>;
  };
  buildSekbOperatorReport: (
    store: unknown,
    options?: Record<string, unknown>,
  ) => Omit<KnowledgeRuntimeLessonsReportResult, 'success' | 'available' | 'reason'>;
  buildSekbShadowEvaluationExport: (input: Record<string, unknown>) => Record<string, unknown>;
  writeSekbShadowEvaluationExportArtifact: (input: Record<string, unknown>) => {
    artifactPath: string;
    artifact: { records: unknown[] };
  };
  createSekbShadowEvaluationReviewProtocol: (
    artifact: Record<string, unknown>,
    options?: Record<string, unknown>,
  ) => { sample: Array<{ trajectoryId: string; split: string }> };
  buildSekbOfflineEvaluationReport: (input: Record<string, unknown>) => Record<string, unknown>;
  writeSekbOfflineEvaluationReportArtifact: (input: Record<string, unknown>) => { artifactPath: string };
  isSekbBatchDistillationAssistantEnabled: (
    cfg?: unknown,
    env?: NodeJS.ProcessEnv,
  ) => boolean;
  createDeepSeekSekbBatchDistillationProvider?: () => unknown;
};

let sekbRuntimeModuleOverrideForTests: SekbRuntimeModule | undefined;

export function __setSekbRuntimeModuleForTests(
  module?: SekbRuntimeModule,
): void {
  sekbRuntimeModuleOverrideForTests = module;
}

async function loadSekbRuntimeModule(): Promise<SekbRuntimeModule | null> {
  if (sekbRuntimeModuleOverrideForTests) return sekbRuntimeModuleOverrideForTests;
  const entryPath = join(getOpenClawRuntimeDir(), 'dist', 'knowledge', 'sekb', 'index.js');
  if (!existsSync(entryPath)) return null;
  return import(pathToFileURL(entryPath).href) as Promise<SekbRuntimeModule>;
}


function createHostExperienceJournalSink(stateDir: string): ContextBlockSink {
  return async (writes) => {
    const dir = join(stateDir, 'dcs-experience-journal');
    await mkdir(dir, { recursive: true });
    const results: Array<{ accepted: boolean; reason?: string }> = [];
    for (const write of writes) {
      const admission = write.admission ?? {};
      const integrity = admission.integrity;
      const source = admission.provenance_source;
      const sessionId = typeof write.block.session_id === 'string' ? write.block.session_id : '';
      if (integrity === 'high_trust' && (source === 'unknown' || !sessionId)) {
        results.push({ accepted: false, reason: 'unknown_source_high_trust' });
        continue;
      }
      if (!sessionId) {
        results.push({ accepted: false, reason: 'missing_session' });
        continue;
      }
      const blockId = typeof write.block.block_id === 'string' ? write.block.block_id : randomUUID();
      const fileName = blockId.replace(/[:/\\]/g, '_') + '.json';
      const filePath = join(dir, fileName);
      await writeFile(
        filePath,
        JSON.stringify(
          {
            writtenAt: new Date().toISOString(),
            // Honest fallback journal: the real DCS write-back goes through the
            // BlockStore sink (createHostBlockStoreSink); this journal is only
            // used when that sink is unavailable and must not claim a task or
            // finding it did not record.
            block: write.block,
            admission,
          },
          null,
          2,
        ),
        'utf8',
      );
      results.push({ accepted: true });
    }
    return results;
  };
}

function createHostSekbStore(sekb: SekbRuntimeModule) {
  const stateDir = resolveHostOpenClawStateDir();
  return new sekb.KnowledgeStore({
    database: {
      env: {
        ...process.env,
        OPENCLAW_STATE_DIR: stateDir,
      },
    },
  });
}

type HostExperienceProjectionSink = {
  kind: 'blockstore' | 'journal';
  sink: ContextBlockSink;
  verifyBlock?: (blockId: string, sessionId: string) => Promise<boolean>;
};

/**
 * Build a real DCS ContextBlockSink backed by the shared openclaw-state
 * SQLite. This is the same BlockStore that runtime context_search /
 * context_read consume, so confirmed SEKB experience Blocks become visible to
 * the DCS context tools instead of only a detached journal file.
 * Returns a journal sink when the shared state DB cannot be opened (best-effort),
 * and the sink kind is surfaced so the UI can be truthful about degradation.
 */
export function createHostExperienceProjectionSink(stateDir: string): HostExperienceProjectionSink {
  try {
    const database = openOpenClawStateDatabase({
      env: {
        ...process.env,
        OPENCLAW_STATE_DIR: stateDir,
      },
    });
    const blockStore = new BlockStore(database.db);
    return {
      kind: 'blockstore',
      sink: createContextBlockSink(blockStore),
      verifyBlock: async (blockId, sessionId) => {
        const blocks = await blockStore.query({
          requester_session_id: sessionId,
          session_id: sessionId,
          block_types: ['experience'],
          source_systems: ['sekb'],
        });
        return blocks.some((block) => block.block_id === blockId);
      },
    };
  } catch (error) {
    console.warn('[knowledge-api] BlockStore sink unavailable, falling back to journal:', error);
    return { kind: 'journal', sink: createHostExperienceJournalSink(stateDir) };
  }
}

function readHostSekbFlagConfig(): unknown {
  try {
    const candidates = [
      join(resolveHostOpenClawStateDir(), 'openclaw.json'),
      join(process.env.USERPROFILE || process.env.HOME || '', '.openclaw', 'openclaw.json'),
    ];
    for (const configPath of candidates) {
      if (!configPath || !existsSync(configPath)) continue;
      return JSON.parse(readFileSync(configPath, 'utf8'));
    }
  } catch {
    // ignore malformed local config
  }
  return undefined;
}

type OkfMarkdownFile = {
  filePath: string;
  relativePath: string;
  bytes: number;
  reserved: boolean;
};

type OkfFileCollection = {
  files: OkfMarkdownFile[];
  scannedFiles: number;
  markdownFiles: number;
  truncated: boolean;
  errors: KnowledgeOkfWarning[];
  warnings: KnowledgeOkfWarning[];
};

const KNOWLEDGE_DRAFT_TYPES = new Set<KnowledgeDraftType>([
  'source-note',
  'synthesis',
  'decision',
  'architecture',
  'command',
  'troubleshooting',
  'glossary',
  'procedure',
]);
const KNOWLEDGE_ARTIFACT_TYPES = new Set<KnowledgeArtifactType>([
  'summary',
  'faq',
  'decision-memo',
  'troubleshooting-recipe',
  'concept-map',
]);
const KNOWLEDGE_CHANGE_OPERATIONS = new Set<KnowledgeChangeOperation>([
  'create',
  'update',
  'merge',
  'archive',
  'revoke',
  'delete',
  'restore',
]);
const KNOWLEDGE_INBOX_KINDS = new Set<KnowledgeInboxKind>([
  'chat-session',
  'task-ledger',
  'clawgraph',
  'file',
  'okf',
  'manual',
  'wiki-result',
]);
const KNOWLEDGE_INBOX_STATUSES = new Set<KnowledgeInboxStatus>(['pending', 'promoted', 'dismissed']);
const KNOWLEDGE_PROVENANCE_TARGET_KINDS = new Set<KnowledgeProvenanceTargetKind>([
  'wiki-page',
  'draft',
  'inbox',
  'okf-concept',
  'manual',
]);
const KNOWLEDGE_REFERENCE_KINDS = new Set<KnowledgeReferenceKind>([
  'chat',
  'search',
  'draft',
  'task-ledger',
  'clawgraph',
  'manual',
]);

const OKF_RESERVED_FILES = new Set(['index.md', 'log.md']);
const OKF_KNOWN_FRONTMATTER_KEYS = new Set(['type', 'title', 'description', 'resource', 'tags', 'timestamp', 'okf_version']);
const OKF_COMMON_TYPES = new Set([
  'architecture',
  'api',
  'command',
  'concept',
  'dataset',
  'decision',
  'feature',
  'glossary',
  'metric',
  'policy',
  'procedure',
  'resource',
  'service',
  'source-note',
  'synthesis',
  'system',
  'table',
  'topic',
  'troubleshooting',
]);

const DEFAULT_STEWARD_CONFIG: KnowledgeStewardConfig = {
  enabled: true,
  roleId: 'knowledge-steward',
  capabilities: {
    canSearch: true,
    canRead: true,
    canProposeDraft: true,
    canClassify: true,
    canSuggestMerge: true,
    canSuggestArchive: true,
    canApplyDirectly: false,
  },
  scope: {
    workspace: true,
    agent: false,
    global: false,
  },
};

/**
 * Area 5 §3.1 — KB role registry. The default registry is byte-identical to
 * today's `DEFAULT_STEWARD_CONFIG` so missing/corrupt file → today's behavior
 * (zero-harm). The file lives at `<OpenClaw config dir>/knowledge/steward-roles.json`
 * (KB-local, next to `watched-directories.json`). Loaded lazily on first
 * steward operation per process; cached in `cachedRoleRegistry`.
 *
 * Boundary preservation: `capabilities.canApplyDirectly` MUST stay literal
 * `false`. Hand-edited files attempting `canApplyDirectly: true` are rejected
 * at load time with a logged issue and the entry skipped (§9 boundary). The
 * semantic pass (§3.2) is opt-in per-variant; the default steward ships with
 * `classification: 'heuristic'` — today's behavior.
 */
const DEFAULT_REGISTRY: KnowledgeRoleRegistryFile = {
  version: 1,
  defaultRoleId: DEFAULT_STEWARD_CONFIG.roleId,
  roles: [{ ...DEFAULT_STEWARD_CONFIG, classification: 'heuristic' }],
};

let cachedRoleRegistry: KnowledgeRoleRegistryFile | null = null;
let roleRegistryLoadFailed = false;

function getStewardRolesPath(): string {
  return join(getKnowledgeDir(), 'steward-roles.json');
}

function normalizeReviewFocus(value: unknown): Array<'classification' | 'duplicates' | 'freshness' | 'conflicts'> {
  if (!Array.isArray(value)) return [];
  const allowed: ReadonlySet<'classification' | 'duplicates' | 'freshness' | 'conflicts'> = new Set([
    'classification',
    'duplicates',
    'freshness',
    'conflicts',
  ]);
  const seen = new Set<'classification' | 'duplicates' | 'freshness' | 'conflicts'>();
  for (const item of value) {
    if (typeof item === 'string' && allowed.has(item as 'classification' | 'duplicates' | 'freshness' | 'conflicts')) {
      seen.add(item as 'classification' | 'duplicates' | 'freshness' | 'conflicts');
    }
  }
  return [...seen];
}

/**
 * Normalize one registry entry. Returns `undefined` and pushes an issue when:
 *   - missing `roleId` or `enabled` flag
 *   - `capabilities.canApplyDirectly` is anything but literal `false` (§9 boundary)
 *   - `capabilities` block is otherwise malformed
 *   - duplicate `roleId` of an already-accepted entry
 *
 * The literal-false check is the JSON parse-level enforcement the design doc
 * specifies (the type can't express it for hand-edited files). A hand-edited
 * entry with `canApplyDirectly: true` is rejected at load with a logged issue
 * and the entry skipped — the steward remains mechanically write-incapable.
 */
function normalizeRolePlayerConfig(
  value: unknown,
  acceptedRoleIds: Set<string>,
  issues: Array<{ path: string; message: string }>,
  pathPrefix: string,
): KnowledgeRolePlayerConfig | undefined {
  if (!isRecord(value)) {
    issues.push({ path: pathPrefix, message: 'role entry must be an object' });
    return undefined;
  }
  const roleId = getString(value.roleId);
  if (!roleId) {
    issues.push({ path: `${pathPrefix}.roleId`, message: 'roleId is required' });
    return undefined;
  }
  if (acceptedRoleIds.has(roleId)) {
    issues.push({ path: `${pathPrefix}.roleId`, message: `duplicate roleId: ${roleId}` });
    return undefined;
  }
  const enabled = typeof value.enabled === 'boolean' ? value.enabled : undefined;
  if (typeof enabled === 'undefined') {
    issues.push({ path: `${pathPrefix}.enabled`, message: 'enabled (boolean) is required' });
    return undefined;
  }
  const capabilities = isRecord(value.capabilities) ? value.capabilities : {};
  // Boundary preservation (§9): canApplyDirectly must be literal false.
  if (capabilities.canApplyDirectly !== false) {
    issues.push({
      path: `${pathPrefix}.capabilities.canApplyDirectly`,
      message: `canApplyDirectly must be literal false (got ${JSON.stringify(capabilities.canApplyDirectly)}); entry skipped`,
    });
    return undefined;
  }
  const scope = isRecord(value.scope) ? value.scope : {};
  const normalized: KnowledgeRolePlayerConfig = {
    enabled,
    roleId,
    capabilities: {
      canSearch: typeof capabilities.canSearch === 'boolean' ? capabilities.canSearch : false,
      canRead: typeof capabilities.canRead === 'boolean' ? capabilities.canRead : false,
      canProposeDraft: typeof capabilities.canProposeDraft === 'boolean' ? capabilities.canProposeDraft : false,
      canClassify: typeof capabilities.canClassify === 'boolean' ? capabilities.canClassify : false,
      canSuggestMerge: typeof capabilities.canSuggestMerge === 'boolean' ? capabilities.canSuggestMerge : false,
      canSuggestArchive: typeof capabilities.canSuggestArchive === 'boolean' ? capabilities.canSuggestArchive : false,
      canApplyDirectly: false,
    },
    scope: {
      workspace: typeof scope.workspace === 'boolean' ? scope.workspace : false,
      agent: typeof scope.agent === 'boolean' ? scope.agent : false,
      global: typeof scope.global === 'boolean' ? scope.global : false,
    },
    ...(getString(value.displayName) ? { displayName: getString(value.displayName) } : {}),
    ...(getString(value.description) ? { description: getString(value.description) } : {}),
    ...(value.classification === 'heuristic' || value.classification === 'semantic'
      ? { classification: value.classification }
      : {}),
    ...(Array.isArray(value.reviewFocus)
      ? { reviewFocus: normalizeReviewFocus(value.reviewFocus) }
      : {}),
    ...(getString(value.contractRef) ? { contractRef: getString(value.contractRef) } : {}),
  };
  acceptedRoleIds.add(roleId);
  return normalized;
}

function normalizeRoleRegistry(value: unknown): { registry: KnowledgeRoleRegistryFile; issues: Array<{ path: string; message: string }> } {
  const issues: Array<{ path: string; message: string }> = [];
  if (!isRecord(value)) {
    return { registry: DEFAULT_REGISTRY, issues: [{ path: 'root', message: 'registry file is not an object; using default' }] };
  }
  if (value.version !== 1) {
    return { registry: DEFAULT_REGISTRY, issues: [{ path: 'version', message: `unsupported version ${JSON.stringify(value.version)}; using default` }] };
  }
  const defaultRoleId = getString(value.defaultRoleId);
  if (!defaultRoleId) {
    return { registry: DEFAULT_REGISTRY, issues: [{ path: 'defaultRoleId', message: 'defaultRoleId is required; using default' }] };
  }
  const rawRoles = Array.isArray(value.roles) ? value.roles : [];
  if (rawRoles.length === 0) {
    return { registry: DEFAULT_REGISTRY, issues: [{ path: 'roles', message: 'roles array is empty; using default' }] };
  }
  const acceptedRoleIds = new Set<string>();
  const acceptedRoles: KnowledgeRolePlayerConfig[] = [];
  rawRoles.forEach((entry, index) => {
    const normalized = normalizeRolePlayerConfig(entry, acceptedRoleIds, issues, `roles[${index}]`);
    if (normalized) acceptedRoles.push(normalized);
  });
  if (acceptedRoles.length === 0) {
    return { registry: DEFAULT_REGISTRY, issues: [...issues, { path: 'roles', message: 'no valid role entries; using default' }] };
  }
  if (!acceptedRoleIds.has(defaultRoleId)) {
    return { registry: DEFAULT_REGISTRY, issues: [...issues, { path: 'defaultRoleId', message: `defaultRoleId ${defaultRoleId} not present in accepted roles; using default` }] };
  }
  return { registry: { version: 1, defaultRoleId, roles: acceptedRoles }, issues };
}

/**
 * Load the KB role registry. Missing/corrupt file → `DEFAULT_REGISTRY`
 * (byte-identical to today's `DEFAULT_STEWARD_CONFIG`). All parse issues are
 * logged to console (offline-safe; no telemetry dependency). Once a file has
 * been read successfully, the result is cached in `cachedRoleRegistry`.
 */
async function loadRoleRegistry(): Promise<KnowledgeRoleRegistryFile> {
  if (cachedRoleRegistry) return cachedRoleRegistry;
  if (roleRegistryLoadFailed) return DEFAULT_REGISTRY;
  const path = getStewardRolesPath();
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    const { registry, issues } = normalizeRoleRegistry(parsed);
    if (issues.length > 0) {
       
      console.warn(`[knowledge] steward-roles.json issues:`, issues);
    }
    cachedRoleRegistry = registry;
    return registry;
  } catch (error) {
    roleRegistryLoadFailed = true;
    // Missing file is the expected initial state — log debug, not warn.
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code !== 'ENOENT') {
       
      console.warn(`[knowledge] steward-roles.json load failed (${code ?? 'unknown'}); using default`);
    }
    return DEFAULT_REGISTRY;
  }
}

async function writeRoleRegistry(registry: KnowledgeRoleRegistryFile): Promise<void> {
  const path = getStewardRolesPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(registry, null, 2), 'utf8');
  cachedRoleRegistry = registry;
  roleRegistryLoadFailed = false;
}

/**
 * Resolve the active KB role player for a steward review. Falls back to the
 * registry's default role if `roleId` is absent or unknown. Never throws —
 * any failure returns the default steward (today's behavior).
 */
async function resolveStewardRole(roleId?: string): Promise<KnowledgeRolePlayerConfig> {
  const registry = await loadRoleRegistry();
  if (roleId) {
    const match = registry.roles.find((role) => role.roleId === roleId && role.enabled);
    if (match) return match;
  }
  const fallback = registry.roles.find((role) => role.roleId === registry.defaultRoleId && role.enabled);
  return fallback ?? registry.roles[0] ?? DEFAULT_REGISTRY.roles[0];
}

/**
 * Test-only: reset the in-memory registry cache so the next read reloads
 * from disk. Production code never needs this — the cache is process-scoped
 * and updates flow through `writeRoleRegistry`. Used by Area 5 §3.1 unit
 * tests for per-test isolation.
 */
export function __resetRoleRegistryCacheForTests(): void {
  cachedRoleRegistry = null;
  roleRegistryLoadFailed = false;
}

function clampPositiveInt(value: unknown, fallback: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(Math.floor(value), max));
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function nowIso(): string {
  return new Date().toISOString();
}


/**
 * KS-01: canonical digest for governance CAS. Only content-bearing fields are
 * hashed; timestamps, status, revision, and transport-only metadata are not.
 */
export function knowledgeContentDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function draftDigestInput(draft: KnowledgeDraft): Record<string, unknown> {
  return {
    id: draft.id,
    title: draft.title,
    body: draft.body,
    type: draft.type,
    sourceIds: draft.sourceIds,
    sourceRefs: draft.sourceRefs,
    tags: draft.tags,
    workspaceId: draft.workspaceId ?? null,
    agentId: draft.agentId ?? null,
    ...(Array.isArray(draft.roleTags) ? { roleTags: draft.roleTags } : {}),
    ...(isRecord(draft.metadata) ? { metadata: draft.metadata } : {}),
  };
}

export function draftDigest(draft: KnowledgeDraft): string {
  return knowledgeContentDigest(draftDigestInput(draft));
}

function withNextRevision<T extends { revision?: number }>(record: T, fallback = 0): T {
  return { ...record, revision: Math.max(record.revision ?? fallback, fallback + 1, 1) };
}

function withFirstRevision<T extends { revision?: number }>(record: T): T {
  return { ...record, revision: record.revision ?? 1 };
}

/** KS-01 single in-process writer queue. All governance mutation critical sections pass here. */
let governanceWriterQueue: Promise<unknown> = Promise.resolve();
function withGovernanceWriteLock<T>(operation: () => Promise<T>): Promise<T> {
  const next = governanceWriterQueue.then(operation, operation);
  governanceWriterQueue = next.catch(() => undefined);
  return next;
}

export function __resetGovernanceWriterQueueForTests(): void {
  governanceWriterQueue = Promise.resolve();
}

/** Non-throwing existence check used to distinguish "absent" from "corrupt". */
async function fileExistsOrNull(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

function getKnowledgeDir(): string {
  return join(getOpenClawConfigDir(), 'knowledge');
}

function getDraftsDir(): string {
  return join(getKnowledgeDir(), 'drafts');
}

function getInboxDir(): string {
  return join(getKnowledgeDir(), 'inbox');
}

function getProposalsDir(): string {
  return join(getKnowledgeDir(), 'proposals');
}

function getProvenanceDir(): string {
  return join(getKnowledgeDir(), 'provenance');
}

function getSourceSetsDir(): string {
  return join(getKnowledgeDir(), 'source-sets');
}

function getOkfBundlesDir(): string {
  return join(getKnowledgeDir(), 'okf', 'bundles');
}

function getAuditPath(): string {
  return join(getKnowledgeDir(), 'audit.jsonl');
}

function getDraftPath(id: string): string {
  return join(getDraftsDir(), `${id}.json`);
}

function getInboxPath(id: string): string {
  return join(getInboxDir(), `${id}.json`);
}

function getProposalPath(id: string): string {
  return join(getProposalsDir(), `${id}.json`);
}

function provenanceRecordId(targetKind: string, targetId: string): string {
  const hash = createHash('sha256').update(`${targetKind}:${targetId}`).digest('hex').slice(0, 24);
  return `kpv_${hash}`;
}

function getProvenancePath(targetKind: string, targetId: string): string {
  return join(getProvenanceDir(), `${provenanceRecordId(targetKind, targetId)}.json`);
}

function getSourceSetPath(id: string): string {
  return join(getSourceSetsDir(), `${encodeURIComponent(id)}.json`);
}

function getOkfBundleMappingPath(bundleId: string): string {
  return join(getOkfBundlesDir(), `${bundleId}.json`);
}

async function ensureKnowledgeDirs(): Promise<void> {
  await mkdir(getDraftsDir(), { recursive: true });
  await mkdir(getInboxDir(), { recursive: true });
  await mkdir(getProposalsDir(), { recursive: true });
  await mkdir(getProvenanceDir(), { recursive: true });
  await mkdir(getSourceSetsDir(), { recursive: true });
  await mkdir(getOkfBundlesDir(), { recursive: true });
}

function normalizeStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? Array.from(new Set(value.flatMap((entry) => (typeof entry === 'string' && entry.trim() ? [entry.trim()] : []))))
    : [];
}

function normalizeSourceRefs(value: unknown): KnowledgeSourceRef[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): KnowledgeSourceRef[] => {
    if (!isRecord(entry)) return [];
    const id = getString(entry.id);
    if (!id) return [];
    const kind = entry.kind === 'chat'
      || entry.kind === 'file'
      || entry.kind === 'wiki'
      || entry.kind === 'task_ledger'
      || entry.kind === 'trace'
      || entry.kind === 'task_loop'
      || entry.kind === 'manual'
      || entry.kind === 'search_result'
      || entry.kind === 'other'
      ? entry.kind
      : undefined;
    return [{
      id,
      ...(getString(entry.label) ? { label: getString(entry.label) } : {}),
      ...(kind ? { kind } : {}),
      ...(getString(entry.path) ? { path: getString(entry.path) } : {}),
      ...(getString(entry.url) ? { url: getString(entry.url) } : {}),
    }];
  });
}

function isGovernedRulesPath(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.replace(/\\/g, '/').toLowerCase();
  const segments = normalized.split('/').filter(Boolean);
  if (segments.at(-1) === 'agents.md') return true;
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (segments[index] === 'harness' && segments[index + 1] === 'specs') return true;
    if (segments[index] === '.clawx' && segments[index + 1] === 'rules' && normalized.endsWith('.md')) return true;
  }
  return false;
}

function rulesGuardWarningsForRefs(sourceRefs: KnowledgeSourceRef[]): string[] {
  return sourceRefs.some((ref) => isGovernedRulesPath(ref.path) || isGovernedRulesPath(ref.id))
    ? ['Rules-governed files are source evidence only; automatic memory paths must not modify AGENTS.md, harness/specs/**, or .clawx/rules/*.md.']
    : [];
}

function normalizeDraftType(value: unknown): KnowledgeDraftType {
  return typeof value === 'string' && KNOWLEDGE_DRAFT_TYPES.has(value as KnowledgeDraftType)
    ? value as KnowledgeDraftType
    : 'synthesis';
}

function normalizeDraftActor(value: unknown): KnowledgeDraftActor {
  return value === 'agent' || value === 'steward' || value === 'user' ? value : 'user';
}

function normalizeInboxKind(value: unknown): KnowledgeInboxKind {
  return typeof value === 'string' && KNOWLEDGE_INBOX_KINDS.has(value as KnowledgeInboxKind)
    ? value as KnowledgeInboxKind
    : 'manual';
}

function normalizeInboxStatus(value: unknown): KnowledgeInboxStatus {
  return typeof value === 'string' && KNOWLEDGE_INBOX_STATUSES.has(value as KnowledgeInboxStatus)
    ? value as KnowledgeInboxStatus
    : 'pending';
}

function normalizeProvenanceTargetKind(value: unknown): KnowledgeProvenanceTargetKind {
  return typeof value === 'string' && KNOWLEDGE_PROVENANCE_TARGET_KINDS.has(value as KnowledgeProvenanceTargetKind)
    ? value as KnowledgeProvenanceTargetKind
    : 'wiki-page';
}

function normalizeReferenceKind(value: unknown): KnowledgeReferenceKind {
  return typeof value === 'string' && KNOWLEDGE_REFERENCE_KINDS.has(value as KnowledgeReferenceKind)
    ? value as KnowledgeReferenceKind
    : 'manual';
}

function normalizeConfidence(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : undefined;
}

/**
 * Area 5 §3.4 — stable ranking shaping. When `roleTag` is set, entries whose
 * `roleTags` array contains the tag are moved to the front; entries without
 * the tag (or with no roleTags at all) remain in their original relative
 * order after the tagged block. The sort is stable (Array.prototype.sort is
 * stable in Node ≥ 12), so within each block the prior order is preserved.
 *
 * Ranking-only — no entry is filtered out. The KB is a single user's wiki;
 * per-role ACLs are explicitly off-spec (§9 boundary).
 */
function rankByRoleTag<T extends { roleTags?: string[] }>(entries: T[], roleTag: string | undefined): T[] {
  if (!roleTag || roleTag.length === 0) return entries;
  const tag = roleTag;
  return [...entries].sort((a, b) => {
    const aHas = Array.isArray(a.roleTags) && a.roleTags.includes(tag) ? 0 : 1;
    const bHas = Array.isArray(b.roleTags) && b.roleTags.includes(tag) ? 0 : 1;
    return aHas - bHas;
  });
}

function hasDraftShape(value: unknown): value is KnowledgeDraft {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string'
    && typeof value.title === 'string'
    && typeof value.body === 'string'
    && typeof value.type === 'string'
    && typeof value.status === 'string'
    && Array.isArray(value.sourceIds)
    && Array.isArray(value.sourceRefs)
    && Array.isArray(value.tags)
    && typeof value.createdBy === 'string'
    && typeof value.createdAt === 'string'
    && typeof value.updatedAt === 'string';
}

function hasInboxShape(value: unknown): value is KnowledgeInboxItem {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string'
    && typeof value.title === 'string'
    && typeof value.body === 'string'
    && typeof value.kind === 'string'
    && typeof value.type === 'string'
    && typeof value.status === 'string'
    && Array.isArray(value.sourceIds)
    && Array.isArray(value.sourceRefs)
    && Array.isArray(value.tags)
    && typeof value.createdBy === 'string'
    && typeof value.createdAt === 'string'
    && typeof value.updatedAt === 'string';
}

function hasProposalShape(value: unknown): value is KnowledgeChangeProposal {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string'
    && typeof value.operation === 'string'
    && typeof value.status === 'string'
    && typeof value.reason === 'string'
    && Array.isArray(value.sources)
    && value.requiresUserConfirmation === true
    && typeof value.createdAt === 'string'
    && typeof value.updatedAt === 'string';
}

function hasProvenanceShape(value: unknown): value is KnowledgeProvenanceRecord {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string'
    && typeof value.targetId === 'string'
    && typeof value.targetKind === 'string'
    && Array.isArray(value.sourceRefs)
    && Array.isArray(value.references)
    && typeof value.createdAt === 'string'
    && typeof value.updatedAt === 'string';
}

function hasSourceSetShape(value: unknown): value is KnowledgeSourceSet {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string'
    && typeof value.title === 'string'
    && Array.isArray(value.sourceRefs)
    && typeof value.createdAt === 'string'
    && typeof value.updatedAt === 'string';
}

async function appendAudit(event: Record<string, unknown>): Promise<void> {
  const timestamp = nowIso();
  await mkdir(getKnowledgeDir(), { recursive: true });
  // Keep the append-only audit log bounded. Rotation renames the live file
  // aside and starts a fresh one, so no history is lost; the SQLite
  // governance event table remains the authority regardless.
  await rotateLogIfNeeded(getAuditPath()).catch(() => undefined);

  await appendFile(getAuditPath(), `${JSON.stringify({ ...event, timestamp })}
`, 'utf8');
  // KS-03: governance events are also persisted in the SQLite event table.
  // The JSON audit line remains a legacy/debug artifact, not governance authority.
  try {
    const store = getGovernanceStore();
    if (store) {
      store.saveEvent({
        id: `kge_${randomUUID()}`,
        stream: 'knowledge-governance',
        eventType: typeof event.type === 'string' ? event.type : 'knowledge_event',
        payload: event,
        createdAt: timestamp,
      });
    }
  } catch {
    // Audit write must never block the governed operation.
  }
}

async function readJsonFile<T>(path: string, guard: (value: unknown) => value is T): Promise<T | null> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
    return guard(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * KS-01: atomic governance JSON write. Write same-directory temp file,
 * fsync file handle, close, then atomic rename over the target. Fallback only
 * for Windows rename-over-existing EPERM/EEXIST after a failed atomic attempt.
 */
async function writeJsonFile(path: string, value: unknown): Promise<void> {
  const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const serialized = `${JSON.stringify(value, null, 2)}
`;
  const handle = await openFile(tempPath, 'wx', 0o600);
  try {
    await handle.writeFile(serialized, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(tempPath, path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EEXIST' && code !== 'EPERM') {
      await rm(tempPath, { force: true }).catch(() => undefined);
      throw error;
    }
    await rm(path, { force: true });
    await rename(tempPath, path);
  }
}


let cachedGovernanceStore: GovernanceStore | null = null;
let governanceMigrationPromise: Promise<GovernanceImportParity | null> | null = null;

function getGovernanceStore(): GovernanceStore | null {
  if (cachedGovernanceStore) return cachedGovernanceStore;
  try {
    const database = openOpenClawStateDatabase({
      env: { ...process.env, OPENCLAW_STATE_DIR: resolveHostOpenClawStateDir() },
    });
    cachedGovernanceStore = new GovernanceStore({ database: { path: database.path } });
    return cachedGovernanceStore;
  } catch (error) {
    console.warn('[knowledge-api] GovernanceStore unavailable:', error);
    return null;
  }
}

function governanceMigrationPath(): string {
  return join(getKnowledgeDir(), 'governance-migration.json');
}

async function readLegacyGovernanceJsonRecords(): Promise<{
  candidates: GovernanceCandidateRecord[];
  proposals: GovernanceProposalRecord[];
}> {
  await ensureKnowledgeDirs();
  const draftNames = await readdir(getDraftsDir()).catch(() => []);
  const inboxNames = await readdir(getInboxDir()).catch(() => []);
  const proposalNames = await readdir(getProposalsDir()).catch(() => []);
  const readAll = async (dir: string, names: string[], guard: (value: unknown) => boolean): Promise<unknown[]> => (
    await Promise.all(names
      .filter((name) => name.endsWith('.json'))
      .map(async (name) => {
        try {
          const value = JSON.parse(await readFile(join(dir, name), 'utf8')) as unknown;
          return guard(value) ? value : null;
        } catch {
          return null;
        }
      }))
  ).filter((value): value is Record<string, unknown> => isRecord(value));
  const drafts = await readAll(getDraftsDir(), draftNames, hasDraftShape);
  const inbox = await readAll(getInboxDir(), inboxNames, hasInboxShape);
  const proposals = await readAll(getProposalsDir(), proposalNames, hasProposalShape);
  return {
    candidates: [
      ...drafts.map((draft) => draftToGovernanceCandidate(draft as KnowledgeDraft)),
      ...inbox.map((item) => inboxToGovernanceCandidate(item as KnowledgeInboxItem)),
    ],
    proposals: proposals.map((proposal) => proposalToGovernanceRecord(proposal as KnowledgeChangeProposal)),
  };
}

async function migrateLegacyGovernanceJsonOnce(): Promise<GovernanceImportParity | null> {
  if (governanceMigrationPromise) return governanceMigrationPromise;
  governanceMigrationPromise = (async () => {
    const store = getGovernanceStore();
    if (!store) return null;
    if (existsSync(governanceMigrationPath())) {
      return (await readJsonFile(governanceMigrationPath(), (value): value is GovernanceImportParity => (
        isRecord(value) && value.schema === 'knowledge-governance-import-parity.v1'
      ))) as GovernanceImportParity | null;
    }
    const legacy = await readLegacyGovernanceJsonRecords();
    const report = store.importBatch(legacy);
    await mkdir(getKnowledgeDir(), { recursive: true });
    await writeJsonFile(governanceMigrationPath(), report);
    return report;
  })().catch((error) => {
    governanceMigrationPromise = null;
    console.warn('[knowledge-api] Governance JSON migration failed:', error);
    return null;
  });
  return governanceMigrationPromise;
}

export function __resetKnowledgeGovernanceForTests(): void {
  cachedGovernanceStore = null;
  governanceMigrationPromise = null;
}

function draftToGovernanceCandidate(draft: KnowledgeDraft): GovernanceCandidateRecord {
  return {
    id: draft.id,
    recordKind: 'draft',
    kind: draft.type,
    type: draft.type,
    status: draft.status,
    title: draft.title,
    body: draft.body,
    sourceIds: draft.sourceIds,
    sourceRefs: draft.sourceRefs,
    tags: draft.tags,
    workspaceId: draft.workspaceId,
    agentId: draft.agentId,
    ...(Array.isArray(draft.roleTags) ? { roleTags: draft.roleTags } : {}),
    createdBy: draft.createdBy,
    warnings: draft.warnings,
    metadata: draft.metadata,
    revision: draft.revision,
    contentDigest: draft.contentDigest,
    ...(draft.stewardNotes ? { stewardNotes: draft.stewardNotes } : {}),
    ...(typeof draft.confidence === 'number' ? { confidence: draft.confidence } : {}),
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
    ...(draft.reviewedAt ? { reviewedAt: draft.reviewedAt } : {}),
    ...(draft.appliedAt ? { appliedAt: draft.appliedAt } : {}),
  };
}

function inboxToGovernanceCandidate(item: KnowledgeInboxItem): GovernanceCandidateRecord {
  const metadata = isRecord(item.metadata) ? item.metadata : {};
  const captureKey = typeof metadata.captureKey === 'string' && metadata.captureKey.trim() ? metadata.captureKey.trim() : undefined;
  return {
    id: item.id,
    recordKind: 'inbox',
    kind: item.kind,
    type: item.type,
    status: item.status,
    title: item.title,
    body: item.body,
    sourceIds: item.sourceIds,
    sourceRefs: item.sourceRefs,
    tags: item.tags,
    workspaceId: item.workspaceId,
    agentId: item.agentId,
    ...(Array.isArray(item.roleTags) ? { roleTags: item.roleTags } : {}),
    createdBy: item.createdBy,
    warnings: item.warnings,
    metadata: item.metadata,
    ...(captureKey ? { captureKey } : {}),
    ...(item.promotedDraftId ? { promotedDraftId: item.promotedDraftId } : {}),
    ...(item.promotedProposalId ? { promotedProposalId: item.promotedProposalId } : {}),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    ...(item.promotedAt ? { promotedAt: item.promotedAt } : {}),
    ...(item.dismissedAt ? { dismissedAt: item.dismissedAt } : {}),
  };
}

function proposalToGovernanceRecord(proposal: KnowledgeChangeProposal): GovernanceProposalRecord {
  return {
    id: proposal.id,
    operation: proposal.operation,
    status: proposal.status,
    ...(Array.isArray(proposal.targetPageIds) ? { targetPageIds: proposal.targetPageIds } : {}),
    ...(proposal.draftId ? { draftId: proposal.draftId } : {}),
    ...(proposal.diff ? { diff: proposal.diff } : {}),
    reason: proposal.reason,
    sources: proposal.sources,
    requiresUserConfirmation: proposal.requiresUserConfirmation,
    workspaceId: proposal.workspaceId,
    revision: proposal.revision,
    ...(proposal.contentDigest ? { contentDigest: proposal.contentDigest } : {}),
    ...(proposal.reviewedDigest ? { reviewedDigest: proposal.reviewedDigest } : {}),
    ...(typeof proposal.expectedRevision === 'number' ? { expectedRevision: proposal.expectedRevision } : {}),
    ...(proposal.idempotencyKey ? { idempotencyKey: proposal.idempotencyKey } : {}),
    createdAt: proposal.createdAt,
    updatedAt: proposal.updatedAt,
    ...(proposal.appliedAt ? { appliedAt: proposal.appliedAt } : {}),
  };
}

function draftFromGovernanceCandidate(record: GovernanceCandidateRecord): KnowledgeDraft {
  return {
    id: record.id,
    title: record.title,
    body: record.body,
    type: normalizeDraftType(record.type),
    status: record.status as KnowledgeDraftStatus,
    sourceIds: record.sourceIds,
    sourceRefs: record.sourceRefs as KnowledgeSourceRef[],
    tags: record.tags,
    workspaceId: record.workspaceId,
    agentId: record.agentId,
    ...(record.roleTags && record.roleTags.length > 0 ? { roleTags: record.roleTags } : {}),
    createdBy: normalizeDraftActor(record.createdBy),
    warnings: record.warnings,
    ...(record.metadata && Object.keys(record.metadata).length > 0 ? { metadata: record.metadata } : {}),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    revision: record.revision,
    contentDigest: record.contentDigest,
    ...(record.stewardNotes ? { stewardNotes: record.stewardNotes } : {}),
    ...(typeof record.confidence === 'number' ? { confidence: record.confidence } : {}),
    ...(record.reviewedAt ? { reviewedAt: record.reviewedAt } : {}),
    ...(record.appliedAt ? { appliedAt: record.appliedAt } : {}),
  };
}

function inboxFromGovernanceCandidate(record: GovernanceCandidateRecord): KnowledgeInboxItem {
  return {
    id: record.id,
    title: record.title,
    body: record.body,
    kind: normalizeInboxKind(record.kind),
    type: normalizeDraftType(record.type),
    status: normalizeInboxStatus(record.status),
    sourceIds: record.sourceIds,
    sourceRefs: record.sourceRefs as KnowledgeSourceRef[],
    tags: record.tags,
    workspaceId: record.workspaceId,
    agentId: record.agentId,
    ...(record.roleTags && record.roleTags.length > 0 ? { roleTags: record.roleTags } : {}),
    createdBy: normalizeDraftActor(record.createdBy),
    warnings: record.warnings,
    ...(record.metadata && Object.keys(record.metadata).length > 0 ? { metadata: record.metadata } : {}),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.promotedAt ? { promotedAt: record.promotedAt } : {}),
    ...(record.dismissedAt ? { dismissedAt: record.dismissedAt } : {}),
    ...(record.promotedDraftId ? { promotedDraftId: record.promotedDraftId } : {}),
    ...(record.promotedProposalId ? { promotedProposalId: record.promotedProposalId } : {}),
  };
}

function proposalFromGovernanceRecord(record: GovernanceProposalRecord): KnowledgeChangeProposal {
  return {
    id: record.id,
    operation: record.operation as KnowledgeChangeProposal['operation'],
    status: record.status as KnowledgeChangeProposal['status'],
    ...(record.targetPageIds && record.targetPageIds.length > 0 ? { targetPageIds: record.targetPageIds } : {}),
    ...(record.draftId ? { draftId: record.draftId } : {}),
    ...(record.diff ? { diff: record.diff } : {}),
    reason: record.reason,
    sources: record.sources as KnowledgeChangeProposal['sources'],
    requiresUserConfirmation: true,
    workspaceId: record.workspaceId,
    revision: record.revision,
    ...(record.contentDigest ? { contentDigest: record.contentDigest } : {}),
    ...(record.reviewedDigest ? { reviewedDigest: record.reviewedDigest } : {}),
    ...(typeof record.expectedRevision === 'number' ? { expectedRevision: record.expectedRevision } : {}),
    ...(record.idempotencyKey ? { idempotencyKey: record.idempotencyKey } : {}),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.appliedAt ? { appliedAt: record.appliedAt } : {}),
  };
}
async function readDraft(id: string): Promise<KnowledgeDraft | null> {
  if (!id.trim()) return null;
  await migrateLegacyGovernanceJsonOnce();
  const store = getGovernanceStore();
  const record = store?.getCandidate(id.trim());
  if (record) return draftFromGovernanceCandidate(record);
  // Legacy JSON compatibility read only (KS-03). New records never write here.
  const draft = await readJsonFile(getDraftPath(id.trim()), hasDraftShape);
  return draft ? withFirstRevision(draft) : null;
}

async function readInboxItem(id: string): Promise<KnowledgeInboxItem | null> {
  if (!id.trim()) return null;
  await migrateLegacyGovernanceJsonOnce();
  const store = getGovernanceStore();
  const record = store?.getCandidate(id.trim());
  if (record) return inboxFromGovernanceCandidate(record);
  const item = await readJsonFile(getInboxPath(id.trim()), hasInboxShape);
  return item ? item : null;
}

async function readSourceSet(id: string): Promise<KnowledgeSourceSet | null> {
  if (!id.trim()) return null;
  return readJsonFile(getSourceSetPath(id.trim()), hasSourceSetShape);
}

async function writeDraft(draft: KnowledgeDraft): Promise<void> {
  await migrateLegacyGovernanceJsonOnce();
  const existing = await readDraft(draft.id);
  const next = withNextRevision(draft, existing?.revision ?? 0);
  const store = getGovernanceStore();
  if (!store) throw new Error('GovernanceStore unavailable; refusing legacy JSON dual-write');
  store.saveCandidate(draftToGovernanceCandidate(next));
}

async function writeSourceSet(sourceSet: KnowledgeSourceSet): Promise<void> {
  await ensureKnowledgeDirs();
  await writeJsonFile(getSourceSetPath(sourceSet.id), sourceSet);
}

async function writeInboxItem(item: KnowledgeInboxItem): Promise<void> {
  await migrateLegacyGovernanceJsonOnce();
  const store = getGovernanceStore();
  if (!store) throw new Error('GovernanceStore unavailable; refusing legacy JSON dual-write');
  store.saveCandidate(inboxToGovernanceCandidate(item));
}

async function listDraftRecords(): Promise<KnowledgeDraft[]> {
  await migrateLegacyGovernanceJsonOnce();
  const store = getGovernanceStore();
  if (store) {
    return store.listCandidates({ recordKind: 'draft' })
      .map(draftFromGovernanceCandidate)
      .map(withFirstRevision)
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  }
  await ensureKnowledgeDirs();
  const names = await readdir(getDraftsDir()).catch(() => []);
  const drafts = await Promise.all(names
    .filter((name) => name.endsWith('.json'))
    .map((name) => readJsonFile(join(getDraftsDir(), name), hasDraftShape)));
  return drafts
    .filter((draft): draft is KnowledgeDraft => Boolean(draft))
    .map(withFirstRevision)
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

async function listSourceSetRecords(): Promise<KnowledgeSourceSet[]> {
  await ensureKnowledgeDirs();
  const names = await readdir(getSourceSetsDir()).catch(() => []);
  const sourceSets = await Promise.all(names
    .filter((name) => name.endsWith('.json'))
    .map((name) => readJsonFile(join(getSourceSetsDir(), name), hasSourceSetShape)));
  return sourceSets
    .filter((sourceSet): sourceSet is KnowledgeSourceSet => Boolean(sourceSet))
    .sort((left, right) => Date.parse(right.lastUsedAt ?? right.updatedAt) - Date.parse(left.lastUsedAt ?? left.updatedAt));
}

/**
 * Area 5 §3.3 — Lookup persisted steward notes for chat-injected references.
 *
 * For each reference (matched by `lookup` or `title` against draft titles),
 * returns the draft's persisted review state: warnings, review status, and
 * any steward suggestion encoded in `stewardNotes`. No LLM call at send
 * time — reads only persisted state, keeping the chat send path fast and
 * offline-safe.
 *
 * Matching is intentionally conservative: a reference matches a draft only
 * when their titles are equal (case-insensitive, trimmed) OR the reference's
 * `lookup` equals the draft's `id`. This avoids false matches on partial
 * text. Lookup failure for any reference → no note for that reference.
 *
 * The steward variant's `roleId` is filled from the active registry role
 * (default: 'knowledge-steward'). Per-variant attribution lets the model
 * weigh conflicting opinions from different steward variants in future.
 *
 * Never throws — any error returns an empty array (no block injected).
 */
export type StewardNoteForReference = {
  referenceId: string;
  roleId: string;
  warnings: string[];
  reviewStatus: 'steward_reviewed' | 'unreviewed';
  suggestion: 'merge' | 'archive' | null;
};

export async function findStewardNotesForReferences(
  references: ReadonlyArray<{
    id: string;
    lookup?: string;
    title?: string;
    pageId?: string;
  }>,
): Promise<StewardNoteForReference[]> {
  if (references.length === 0) return [];
  try {
    const drafts = await listDraftRecords();
    if (drafts.length === 0) return [];
    // Resolve active steward role id for attribution.
    const registry = await loadRoleRegistry();
    const activeRoleId = registry.defaultRoleId;
    const notes: StewardNoteForReference[] = [];
    for (const reference of references) {
      // Conservative match: title equal (case-insensitive) or lookup === draft.id.
      const refTitle = (reference.title ?? '').trim().toLowerCase();
      const refLookup = (reference.lookup ?? '').trim();
      const matchedDraft = drafts.find((draft) => (
        (refTitle && draft.title.trim().toLowerCase() === refTitle)
        || (refLookup && draft.id === refLookup)
      ));
      if (!matchedDraft) continue;
      // Only surface notes for drafts that completed a steward review.
      if (matchedDraft.status !== 'steward_reviewed' && matchedDraft.status !== 'approved' && matchedDraft.status !== 'applied') {
        continue;
      }
      // Parse suggestion from stewardNotes (free-form text). Conservative:
      // detect explicit "merge" or "archive" keywords at start of a line.
      const notesText = matchedDraft.stewardNotes ?? '';
      let suggestion: 'merge' | 'archive' | null = null;
      if (/\bmerge\b/i.test(notesText)) suggestion = 'merge';
      else if (/\barchive\b/i.test(notesText)) suggestion = 'archive';
      notes.push({
        referenceId: reference.id,
        roleId: activeRoleId,
        warnings: Array.isArray(matchedDraft.warnings) ? matchedDraft.warnings.slice(0, 5) : [],
        reviewStatus: matchedDraft.status === 'steward_reviewed' ? 'steward_reviewed' : 'unreviewed',
        suggestion,
      });
    }
    return notes;
  } catch {
    // Lookup is best-effort — never break the chat send path.
    return [];
  }
}

async function listInboxRecords(): Promise<KnowledgeInboxItem[]> {
  await migrateLegacyGovernanceJsonOnce();
  const store = getGovernanceStore();
  if (store) {
    return store.listCandidates({ recordKind: 'inbox' })
      .map(inboxFromGovernanceCandidate)
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  }
  await ensureKnowledgeDirs();
  const names = await readdir(getInboxDir()).catch(() => []);
  const items = await Promise.all(names
    .filter((name) => name.endsWith('.json'))
    .map((name) => readJsonFile(join(getInboxDir(), name), hasInboxShape)));
  return items
    .filter((item): item is KnowledgeInboxItem => Boolean(item))
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

function normalizedInboxText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/giu, ' ').replace(/\s+/g, ' ').trim();
}

function inboxTokens(value: string): Set<string> {
  return new Set(normalizedInboxText(value).split(' ').filter((token) => token.length >= 3));
}

function inboxTextSimilarity(left: string, right: string): number {
  const leftTokens = inboxTokens(left);
  const rightTokens = inboxTokens(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1;
  }
  return intersection / (leftTokens.size + rightTokens.size - intersection);
}

function inboxMetadataList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => (typeof entry === 'string' && entry.trim() ? [entry.trim()] : []));
  }
  return typeof value === 'string' && value.trim() ? [value.trim()] : [];
}

function inboxConflictRefs(item: KnowledgeInboxItem): string[] {
  const metadata = isRecord(item.metadata) ? item.metadata : {};
  return Array.from(new Set([
    ...inboxMetadataList(metadata.conflictWith),
    ...inboxMetadataList(metadata.conflicts),
  ]));
}

function inboxSourceCount(item: KnowledgeInboxItem): number {
  return Math.max(item.sourceRefs.length, item.sourceIds.length);
}

function findDuplicateInboxItem(item: KnowledgeInboxItem, existingItems: KnowledgeInboxItem[]): KnowledgeInboxItem | null {
  const currentCreatedAt = Date.parse(item.createdAt) || 0;
  const currentText = `${item.title}\n${item.body}`;
  const normalizedTitle = normalizedInboxText(item.title);
  const normalizedBody = normalizedInboxText(item.body);
  const candidates = existingItems
    .filter((candidate) => candidate.id !== item.id && candidate.status !== 'dismissed')
    .filter((candidate) => {
      const candidateCreatedAt = Date.parse(candidate.createdAt) || 0;
      return candidateCreatedAt < currentCreatedAt || (candidateCreatedAt === currentCreatedAt && candidate.id < item.id);
    });
  for (const candidate of candidates) {
    if (normalizedTitle && normalizedTitle === normalizedInboxText(candidate.title)) return candidate;
    if (normalizedBody && normalizedBody === normalizedInboxText(candidate.body)) return candidate;
    if (inboxTextSimilarity(currentText, `${candidate.title}\n${candidate.body}`) >= 0.72) return candidate;
  }
  return null;
}

function clampTriageConfidence(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}

export function triageKnowledgeInboxItem(
  item: KnowledgeInboxItem,
  existingItems: KnowledgeInboxItem[] = [],
): KnowledgeStewardTriage {
  const title = item.title.trim();
  const body = item.body.trim();
  const sourceCount = inboxSourceCount(item);
  const conflicts = inboxConflictRefs(item);
  const duplicate = findDuplicateInboxItem(item, existingItems);

  if (!title || !body || (body.length < 24 && sourceCount === 0)) {
    return {
      action: 'reject-low-value',
      confidence: 0.8,
      reason: 'Candidate is too sparse to promote without more context.',
      suggestedEdits: ['Add a concrete title, reusable body, and at least one source reference.'],
    };
  }

  if ((item.warnings ?? []).length > 0 || conflicts.length > 0) {
    return {
      action: 'needs-decision',
      confidence: clampTriageConfidence(conflicts.length > 0 ? 0.86 : 0.78),
      ...(conflicts.length > 0 ? { conflictWith: conflicts } : {}),
      reason: conflicts.length > 0
        ? 'Candidate declares possible conflicts that need human resolution.'
        : 'Candidate has warnings that should be reviewed before promotion.',
      suggestedEdits: ['Resolve warning or conflict notes before promoting to a draft.'],
    };
  }

  if (duplicate) {
    return {
      action: 'possible-duplicate',
      confidence: 0.74,
      duplicateOf: duplicate.id,
      reason: `Candidate overlaps with "${duplicate.title}".`,
      suggestedEdits: ['Compare with the existing candidate and dismiss or merge during draft review.'],
    };
  }

  if (sourceCount === 0) {
    return {
      action: 'observe',
      confidence: 0.62,
      reason: 'Candidate has reusable content but no source reference yet.',
      suggestedEdits: ['Attach a chat, file, task, trace, or wiki source before promotion.'],
    };
  }

  return {
    action: 'ready-for-review',
    confidence: 0.76,
    reason: 'Candidate has a clear type and source evidence for manual draft review.',
  };
}

function withInboxTriage(item: KnowledgeInboxItem, existingItems: KnowledgeInboxItem[] = []): KnowledgeInboxItem {
  const metadata = isRecord(item.metadata) ? item.metadata : {};
  return {
    ...item,
    metadata: {
      ...metadata,
      triage: triageKnowledgeInboxItem(item, existingItems),
    },
  };
}

function sameTriage(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

const INBOX_TRIAGE_ORDER: Record<KnowledgeStewardTriage['action'], number> = {
  'needs-decision': 0,
  'ready-for-review': 1,
  'possible-duplicate': 2,
  observe: 3,
  'reject-low-value': 4,
};

function sortInboxByTriagePriority(items: KnowledgeInboxItem[]): KnowledgeInboxItem[] {
  return [...items].sort((left, right) => {
    const leftTriage = isRecord(left.metadata) && isRecord(left.metadata.triage)
      ? left.metadata.triage as KnowledgeStewardTriage
      : triageKnowledgeInboxItem(left, items);
    const rightTriage = isRecord(right.metadata) && isRecord(right.metadata.triage)
      ? right.metadata.triage as KnowledgeStewardTriage
      : triageKnowledgeInboxItem(right, items);
    const byTriage = (INBOX_TRIAGE_ORDER[leftTriage.action] ?? 99) - (INBOX_TRIAGE_ORDER[rightTriage.action] ?? 99);
    if (byTriage !== 0) return byTriage;
    return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
  });
}

async function readProposal(id: string): Promise<KnowledgeChangeProposal | null> {
  if (!id.trim()) return null;
  await migrateLegacyGovernanceJsonOnce();
  const store = getGovernanceStore();
  const record = store?.getProposal(id.trim());
  if (record) return proposalFromGovernanceRecord(record);
  const proposal = await readJsonFile(getProposalPath(id.trim()), hasProposalShape);
  return proposal ? withFirstRevision(proposal) : null;
}

async function writeProposal(proposal: KnowledgeChangeProposal): Promise<void> {
  await migrateLegacyGovernanceJsonOnce();
  const existing = await readProposal(proposal.id);
  const next = withNextRevision(proposal, existing?.revision ?? 0);
  const store = getGovernanceStore();
  if (!store) throw new Error('GovernanceStore unavailable; refusing legacy JSON dual-write');
  store.saveProposal(proposalToGovernanceRecord(next));
}

async function listProposalRecords(): Promise<KnowledgeChangeProposal[]> {
  await migrateLegacyGovernanceJsonOnce();
  const store = getGovernanceStore();
  if (store) {
    return store.listProposals({})
      .map(proposalFromGovernanceRecord)
      .map(withFirstRevision)
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  }
  await ensureKnowledgeDirs();
  const names = await readdir(getProposalsDir()).catch(() => []);
  const proposals = await Promise.all(names
    .filter((name) => name.endsWith('.json'))
    .map((name) => readJsonFile(join(getProposalsDir(), name), hasProposalShape)));
  return proposals
    .filter((proposal): proposal is KnowledgeChangeProposal => Boolean(proposal))
    .map(withFirstRevision)
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}


function getOperationsDir(): string {
  return join(getKnowledgeDir(), 'operations');
}

function getOperationJournalPath(operationId: string): string {
  return join(getOperationsDir(), `${operationId}.json`);
}

type GovernanceOperationJournalEntry = {
  schema: 'knowledge-governance-operation.v1';
  operationId: string;
  kind: 'review_apply';
  proposalId: string;
  draftId: string;
  idempotencyKey: string;
  state: 'intent' | 'wiki_committed' | 'json_committed' | 'failed';
  contentDigest: string;
  reviewedDigest?: string;
  expectedRevision?: number;
  operation?: KnowledgeChangeOperation;
  owner?: 'memory-wiki' | 'memory-slot' | 'sekb';
  subjectId?: string;
  subjectRevision?: string;
  receiptId?: string;
  compensation?: KnowledgeGovernanceCompensation;
  createdAt: string;
  updatedAt: string;
  error?: string;
};

async function readOperationJournal(operationId: string): Promise<GovernanceOperationJournalEntry | null> {
  return readJsonFile(getOperationJournalPath(operationId), (value): value is GovernanceOperationJournalEntry => {
    if (!isRecord(value)) return false;
    return value.schema === 'knowledge-governance-operation.v1'
      && typeof value.operationId === 'string'
      && typeof value.proposalId === 'string'
      && typeof value.draftId === 'string'
      && typeof value.state === 'string';
  });
}

async function writeOperationJournal(entry: GovernanceOperationJournalEntry): Promise<void> {
  await ensureKnowledgeDirs();
  await mkdir(getOperationsDir(), { recursive: true });
  await writeJsonFile(getOperationJournalPath(entry.operationId), entry);
}

function operationJournalId(proposal: KnowledgeChangeProposal, draft: KnowledgeDraft): string {
  return createHash('sha256')
    .update(`${proposal.id}:${draft.id}:${proposal.idempotencyKey ?? proposal.revision ?? 'v1'}`)
    .digest('hex')
    .slice(0, 24);
}

function compensationForOperation(operation: KnowledgeChangeOperation): KnowledgeGovernanceCompensation {
  if (operation === 'delete') {
    return {
      status: 'unrecoverable',
      reason: 'memory-wiki page deletion is not automatically reversible without a restore source',
    };
  }
  return {
    status: 'partial',
    reason: 'Automatic rollback is not attempted; use a new governed update/restore proposal to reverse this effect.',
  };
}

function receiptFromOperationJournal(
  entry: GovernanceOperationJournalEntry,
  proposal: KnowledgeChangeProposal | null,
  draft: KnowledgeDraft | null,
): KnowledgeGovernanceReceipt | null {
  const operation = entry.operation ?? proposal?.operation;
  const owner = entry.owner ?? 'memory-wiki';
  const subjectId = entry.subjectId ?? proposal?.targetPageIds?.[0] ?? draft?.sourceIds[0];
  if (!operation || !subjectId || !entry.idempotencyKey) return null;
  return {
    schema: 'knowledge-governance-receipt.v1',
    receiptId: entry.receiptId ?? `kgr_${entry.operationId}`,
    operation,
    owner,
    subjectId,
    ...(entry.subjectRevision !== undefined
      ? { subjectRevision: String(entry.subjectRevision) }
      : entry.expectedRevision !== undefined
        ? { subjectRevision: String(entry.expectedRevision) }
        : {}),
    contentDigest: entry.contentDigest,
    idempotencyKey: entry.idempotencyKey,
    status: entry.state === 'failed' ? 'failed' : 'committed',
    committedAt: entry.updatedAt,
    evidenceRefs: [entry.proposalId, entry.draftId],
    compensation: entry.compensation ?? compensationForOperation(operation),
  };
}

async function listOperationReceipts(): Promise<KnowledgeGovernanceReceipt[]> {
  await ensureKnowledgeDirs();
  const names = await readdir(getOperationsDir()).catch(() => []);
  const receipts: KnowledgeGovernanceReceipt[] = [];
  for (const name of names.filter((entry) => entry.endsWith('.json'))) {
    const entry = await readOperationJournal(name.slice(0, -'.json'.length));
    if (!entry) continue;
    const proposal = entry.proposalId ? await readProposal(entry.proposalId) : null;
    const draft = entry.draftId ? await readDraft(entry.draftId) : null;
    const receipt = receiptFromOperationJournal(entry, proposal, draft);
    if (receipt) receipts.push(receipt);
  }
  return receipts.sort((left, right) => right.committedAt.localeCompare(left.committedAt));
}

function proposalIdempotencyKey(proposal: KnowledgeChangeProposal, draft: KnowledgeDraft): string {
  const existing = getString(proposal.idempotencyKey);
  if (existing) return existing;
  return createHash('sha256')
    .update(JSON.stringify({
      draftId: proposal.draftId,
      operation: proposal.operation,
      targetPageIds: proposal.targetPageIds ?? [],
      digest: draftDigest(draft),
    }))
    .digest('hex')
    .slice(0, 32);
}

function reviewBundleId(proposal: KnowledgeChangeProposal, draft: KnowledgeDraft): string {
  return `kb_${proposal.id}_${draft.id}`;
}

type KnowledgeReviewBundleInternal = {
  id: string;
  draftId: string;
  proposalId: string;
  operation: KnowledgeChangeOperation;
  status: KnowledgeChangeProposal['status'];
  draftStatus: KnowledgeDraftStatus;
  reviewedDigest?: string;
  expectedRevision?: number;
  workspaceId?: string | null;
  contentDigest?: string;
  idempotencyKey?: string;
  draft?: KnowledgeDraft;
  proposal?: KnowledgeChangeProposal;
};

function buildReviewBundle(proposal: KnowledgeChangeProposal, draft: KnowledgeDraft): KnowledgeReviewBundleInternal {
  return {
    id: reviewBundleId(proposal, draft),
    draftId: draft.id,
    proposalId: proposal.id,
    operation: proposal.operation,
    status: proposal.status,
    draftStatus: draft.status,
    ...(getString(proposal.reviewedDigest) ? { reviewedDigest: getString(proposal.reviewedDigest) } : {}),
    ...(typeof proposal.expectedRevision === 'number' ? { expectedRevision: proposal.expectedRevision } : {}),
    ...(typeof draft.workspaceId === 'string' || draft.workspaceId === null ? { workspaceId: draft.workspaceId } : {}),
    ...(getString(proposal.contentDigest) ? { contentDigest: getString(proposal.contentDigest) } : {}),
    ...(getString(proposal.idempotencyKey) ? { idempotencyKey: getString(proposal.idempotencyKey) } : {}),
    draft,
    proposal,
  };
}

async function listReviewBundleRecords(): Promise<KnowledgeReviewBundleInternal[]> {
  const [proposals, drafts] = await Promise.all([listProposalRecords(), listDraftRecords()]);
  const draftsById = new Map(drafts.map((draft) => [draft.id, draft]));
  const bundles: KnowledgeReviewBundleInternal[] = [];
  for (const proposal of proposals) {
    if (!proposal.draftId) continue;
    const draft = draftsById.get(proposal.draftId);
    if (!draft) continue;
    bundles.push(buildReviewBundle(proposal, draft));
  }
  return bundles.sort((left, right) => (
    Date.parse(right.proposal?.updatedAt ?? right.draft?.updatedAt ?? '') -
    Date.parse(left.proposal?.updatedAt ?? left.draft?.updatedAt ?? '')
  ));
}

async function readReviewBundle(id: string): Promise<KnowledgeReviewBundleInternal | null> {
  if (!id.trim()) return null;
  const bundles = await listReviewBundleRecords();
  return bundles.find((bundle) => bundle.id === id.trim()) ?? null;
}

const KNOWLEDGE_LIFECYCLE_WIKI_RPC: Record<
  Exclude<KnowledgeChangeOperation, 'create'>,
  'wiki.update' | 'wiki.merge' | 'wiki.archive' | 'wiki.revoke' | 'wiki.delete' | 'wiki.restore'
> = {
  update: 'wiki.update',
  merge: 'wiki.merge',
  archive: 'wiki.archive',
  revoke: 'wiki.revoke',
  delete: 'wiki.delete',
  restore: 'wiki.restore',
};

function wikiLifecycleRpcPayload(params: {
  operation: Exclude<KnowledgeChangeOperation, 'create'>;
  draft: KnowledgeDraft;
  proposal: KnowledgeChangeProposal;
  idempotencyKey: string;
}): Record<string, unknown> {
  const { operation, draft, proposal, idempotencyKey } = params;
  const lookup = proposal.targetPageIds?.[0];
  const base = {
    lookup,
    expectedRevision: proposal.expectedRevision,
    idempotencyKey,
    reason: proposal.reason,
  };
  switch (operation) {
    case 'update':
      return {
        ...base,
        title: draft.title,
        body: draft.body,
        ...(draft.sourceIds.length > 0 ? { sourceIds: draft.sourceIds } : {}),
      };
    case 'merge':
      return {
        ...base,
        ...(proposal.targetPageIds?.[1] ? { sourceLookup: proposal.targetPageIds[1] } : {}),
        body: draft.body,
        ...(draft.sourceIds.length > 0 ? { sourceIds: draft.sourceIds } : {}),
      };
    case 'archive':
    case 'revoke':
    case 'delete':
    case 'restore':
      return base;
  }
}

function applyConflict(
  code: NonNullable<KnowledgeApplyReviewedChangeResult['conflict']>['code'],
  reason: string,
  bundle: KnowledgeReviewBundleInternal,
  actualRevision?: number,
): KnowledgeApplyReviewedChangeResult {
  const expectedRevision = typeof bundle.expectedRevision === 'number' ? bundle.expectedRevision : undefined;
  return {
    success: false,
    error: reason,
    reviewBundle: bundle,
    proposal: bundle.proposal,
    draft: bundle.draft,
    conflict: {
      code,
      reason,
      ...(expectedRevision !== undefined ? { expectedRevision } : {}),
      ...(actualRevision !== undefined ? { actualRevision } : {}),
    },
  };
}

async function readProvenance(targetKind: KnowledgeProvenanceTargetKind, targetId: string): Promise<KnowledgeProvenanceRecord | null> {
  if (!targetId.trim()) return null;
  return readJsonFile(getProvenancePath(targetKind, targetId.trim()), hasProvenanceShape);
}

async function writeProvenance(record: KnowledgeProvenanceRecord): Promise<void> {
  await ensureKnowledgeDirs();
  await writeJsonFile(getProvenancePath(record.targetKind, record.targetId), record);
}

function errorExperienceFromMetadata(metadata: unknown): KnowledgeErrorExperienceCard | null {
  const record = isRecord(metadata) ? metadata : {};
  return normalizeErrorExperienceCard(record.errorExperience);
}

async function listErrorExperienceTargets(): Promise<Array<{
  targetKind: 'inbox' | 'draft';
  targetId: string;
  sourceRefs: KnowledgeSourceRef[];
  card: KnowledgeErrorExperienceCard;
}>> {
  const [inbox, drafts] = await Promise.all([listInboxRecords(), listDraftRecords()]);
  return [
    ...inbox.flatMap((item) => {
      const card = errorExperienceFromMetadata(item.metadata);
      return card ? [{ targetKind: 'inbox' as const, targetId: item.id, sourceRefs: item.sourceRefs, card }] : [];
    }),
    ...drafts.flatMap((draft) => {
      const card = errorExperienceFromMetadata(draft.metadata);
      return card ? [{ targetKind: 'draft' as const, targetId: draft.id, sourceRefs: draft.sourceRefs, card }] : [];
    }),
  ];
}

async function updateStoredErrorExperienceCard(
  targetKind: 'inbox' | 'draft',
  targetId: string,
  action: KnowledgeErrorExperienceEffectivenessAction,
): Promise<KnowledgeErrorExperienceCard['effectiveness'] | null> {
  if (targetKind === 'inbox') {
    const item = await readInboxItem(targetId);
    const card = item ? errorExperienceFromMetadata(item.metadata) : null;
    if (!item || !card) return null;
    const nextCard = updateErrorExperienceEffectiveness(card, action);
    const nextItem: KnowledgeInboxItem = {
      ...item,
      metadata: {
        ...(item.metadata ?? {}),
        errorExperience: nextCard,
      },
      updatedAt: nowIso(),
    };
    await writeInboxItem(nextItem);
    return nextCard.effectiveness;
  }
  const draft = await readDraft(targetId);
  const card = draft ? errorExperienceFromMetadata(draft.metadata) : null;
  if (!draft || !card) return null;
  const nextCard = updateErrorExperienceEffectiveness(card, action);
  const nextDraft: KnowledgeDraft = {
    ...draft,
    metadata: {
      ...(draft.metadata ?? {}),
      errorExperience: nextCard,
    },
    updatedAt: nowIso(),
  };
  await writeDraft(nextDraft);
  return nextCard.effectiveness;
}

function createDraftFromPayload(payload: KnowledgeCreateDraftPayload): KnowledgeDraft | null {
  const title = getString(payload.title);
  const body = getString(payload.body);
  if (!title || !body) return null;
  const timestamp = nowIso();
  // Area 5 §3.4 — normalize roleTags (dedupe/trim/filter-empty). Absent or
  // empty payload field → omitted from the draft (ranking-only, default-off).
  const roleTags = normalizeStringList(payload.roleTags);
  const draft: KnowledgeDraft = {
    id: `kd_${randomUUID()}`,
    title,
    body,
    type: normalizeDraftType(payload.type),
    status: 'draft',
    sourceIds: normalizeStringList(payload.sourceIds),
    sourceRefs: normalizeSourceRefs(payload.sourceRefs),
    tags: normalizeStringList(payload.tags),
    workspaceId: typeof payload.workspaceId === 'string' ? payload.workspaceId : payload.workspaceId ?? null,
    agentId: typeof payload.agentId === 'string' ? payload.agentId : payload.agentId ?? null,
    ...(roleTags.length > 0 ? { roleTags } : {}),
    createdBy: normalizeDraftActor(payload.createdBy),
    ...(normalizeConfidence(payload.confidence) != null ? { confidence: normalizeConfidence(payload.confidence) } : {}),
    warnings: [],
    ...(isRecord(payload.metadata) ? { metadata: payload.metadata } : {}),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  return {
    ...draft,
    revision: 1,
    contentDigest: draftDigest(draft),
  };
}

function normalizeArtifactType(value: unknown): KnowledgeArtifactType {
  return typeof value === 'string' && KNOWLEDGE_ARTIFACT_TYPES.has(value as KnowledgeArtifactType)
    ? value as KnowledgeArtifactType
    : 'summary';
}

function draftTypeForArtifact(artifactType: KnowledgeArtifactType): KnowledgeDraftType {
  if (artifactType === 'decision-memo') return 'decision';
  if (artifactType === 'troubleshooting-recipe') return 'troubleshooting';
  return 'synthesis';
}

function defaultArtifactTitle(artifactType: KnowledgeArtifactType): string {
  switch (artifactType) {
    case 'faq':
      return 'FAQ';
    case 'decision-memo':
      return 'Decision memo';
    case 'troubleshooting-recipe':
      return 'Troubleshooting recipe';
    case 'concept-map':
      return 'Concept map';
    case 'summary':
    default:
      return 'Summary';
  }
}

async function normalizeSourceSetPayload(payload: unknown): Promise<KnowledgeSourceSet | null> {
  const body: Record<string, unknown> = isRecord(payload) ? payload : {};
  const title = getString(body.title);
  if (!title) return null;
  const sourceRefs = normalizeSourceRefs(body.sourceRefs);
  const id = getString(body.id) ?? `ks_${randomUUID()}`;
  const existing = await readSourceSet(id);
  const timestamp = nowIso();
  return {
    id,
    title,
    sourceRefs,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
    ...(existing?.lastUsedAt ? { lastUsedAt: existing.lastUsedAt } : {}),
    ...(isRecord(body.metadata) ? { metadata: body.metadata } : existing?.metadata ? { metadata: existing.metadata } : {}),
  };
}

function sourceIdsFromRefs(sourceRefs: KnowledgeSourceRef[]): string[] {
  return Array.from(new Set(sourceRefs.map((ref) => ref.id).filter(Boolean)));
}

function createInboxItemFromPayload(payload: KnowledgeCreateInboxItemPayload): KnowledgeInboxItem | null {
  const title = getString(payload.title);
  const body = getString(payload.body);
  if (!title || !body) return null;
  const timestamp = nowIso();
  const sourceRefs = normalizeSourceRefs(payload.sourceRefs);
  const sourceIds = Array.from(new Set([
    ...normalizeStringList(payload.sourceIds),
    ...sourceRefs.map((ref) => ref.id),
  ]));
  const warnings = Array.from(new Set([
    ...normalizeStringList(payload.warnings),
    ...rulesGuardWarningsForRefs(sourceRefs),
  ]));
  const roleTags = normalizeStringList(payload.roleTags);
  const item: KnowledgeInboxItem = {
    id: `ki_${randomUUID()}`,
    title,
    body,
    kind: normalizeInboxKind(payload.kind),
    type: normalizeDraftType(payload.type),
    status: 'pending',
    sourceIds,
    sourceRefs,
    tags: normalizeStringList(payload.tags),
    workspaceId: typeof payload.workspaceId === 'string' ? payload.workspaceId : payload.workspaceId ?? null,
    agentId: typeof payload.agentId === 'string' ? payload.agentId : payload.agentId ?? null,
    ...(roleTags.length > 0 ? { roleTags } : {}),
    createdBy: normalizeDraftActor(payload.createdBy),
    warnings,
    ...(isRecord(payload.metadata) ? { metadata: payload.metadata } : {}),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  return withInboxTriage(item);
}

function draftFromInboxItem(item: KnowledgeInboxItem): KnowledgeDraft {
  const timestamp = nowIso();
  const draft: KnowledgeDraft = {
    id: `kd_${randomUUID()}`,
    title: item.title,
    body: item.body,
    type: item.type,
    status: 'draft',
    sourceIds: item.sourceIds,
    sourceRefs: item.sourceRefs,
    tags: item.tags,
    workspaceId: item.workspaceId,
    agentId: item.agentId,
    // Area 5 §3.4 — carry role-tag binding forward when promoting inbox → draft.
    ...(Array.isArray(item.roleTags) && item.roleTags.length > 0 ? { roleTags: item.roleTags } : {}),
    createdBy: item.createdBy,
    warnings: item.warnings ?? [],
    ...(isRecord(item.metadata) ? { metadata: item.metadata } : {}),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  return {
    ...draft,
    revision: 1,
    contentDigest: draftDigest(draft),
  };
}

function createProposalForDraft(draft: KnowledgeDraft, reason: string): KnowledgeChangeProposal {
  const timestamp = nowIso();
  const proposal: KnowledgeChangeProposal = {
    id: `kp_${randomUUID()}`,
    operation: 'create',
    status: 'proposed',
    draftId: draft.id,
    reason,
    sources: draft.sourceRefs.length > 0
      ? draft.sourceRefs
      : draft.sourceIds.map((id) => ({ id, kind: 'manual' as const })),
    requiresUserConfirmation: true,
    workspaceId: draft.workspaceId,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  return {
    ...proposal,
    revision: 1,
    contentDigest: draftDigest(draft),
    idempotencyKey: proposalIdempotencyKey(proposal, draft),
  };
}

function classifyDraft(title: string, body: string, tags: string[] = []): KnowledgeDraftType {
  const haystack = `${title}\n${body}\n${tags.join(' ')}`.toLowerCase();
  if (/(decision|decide|decided|adr|取舍|决定|决策)/u.test(haystack)) return 'decision';
  if (/(architecture|架构|module|boundary|design)/u.test(haystack)) return 'architecture';
  if (/(command|pnpm|npm|yarn|git|powershell|bash|命令)/u.test(haystack)) return 'command';
  if (/(troubleshoot|failure|error|fix|故障|错误|修复)/u.test(haystack)) return 'troubleshooting';
  if (/(glossary|term|definition|术语|定义)/u.test(haystack)) return 'glossary';
  if (/(procedure|steps|workflow|流程|步骤)/u.test(haystack)) return 'procedure';
  if (/(source|excerpt|import|来源)/u.test(haystack)) return 'source-note';
  return 'synthesis';
}

function knowledgeCaptureKey(value: unknown): string | null {
  const metadata = isRecord(value) ? value : {};
  const captureKey = metadata.captureKey;
  return typeof captureKey === 'string' && captureKey.trim() ? captureKey.trim() : null;
}

async function findInboxItemByCaptureKey(captureKey: string): Promise<KnowledgeInboxItem | null> {
  await migrateLegacyGovernanceJsonOnce();
  const store = getGovernanceStore();
  const records = store?.listCandidates({ recordKind: 'inbox', captureKey }) ?? [];
  if (records[0]) return inboxFromGovernanceCandidate(records[0]);
  const items = await listInboxRecords();
  return items.find((item) => knowledgeCaptureKey(item.metadata) === captureKey) ?? null;
}

function stewardReviewDraft(input: { title?: string; body?: string; sourceIds?: string[]; tags?: string[] }): {
  type: KnowledgeDraftType;
  tags: string[];
  warnings: string[];
  notes: string;
} {
  const title = input.title ?? '';
  const body = input.body ?? '';
  const sourceIds = input.sourceIds ?? [];
  const tags = Array.from(new Set([...(input.tags ?? []), classifyDraft(title, body)].filter(Boolean)));
  const warnings: string[] = [];
  if (sourceIds.length === 0) warnings.push('Missing source references. User confirmation is still required before writing.');
  if (body.length < 80) warnings.push('Draft body is short; consider adding context before applying.');
  if (/todo|tbd|unknown|不确定|待定/iu.test(body)) warnings.push('Draft contains unresolved language and may need revision.');
  return {
    type: classifyDraft(title, body, tags),
    tags,
    warnings,
    notes: 'Knowledge Steward review is advisory only. It cannot write, update, archive, or delete knowledge without user confirmation.',
  };
}

function isTextFile(filePath: string): boolean {
  return TEXT_EXTENSIONS.has(extname(filePath).toLowerCase());
}

function sourceTitle(rootPath: string, filePath: string): string {
  const rel = relative(rootPath, filePath).replace(/\\/g, '/');
  const withoutExt = rel.replace(/\.[^/.]+$/u, '');
  return withoutExt || basename(filePath, extname(filePath));
}

function mergeRecords(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const existing = out[key];
    if (isRecord(existing) && isRecord(value)) {
      out[key] = mergeRecords(existing, value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function readMemoryWikiEntry(config: Record<string, unknown> | undefined): Record<string, unknown> {
  const plugins = isRecord(config?.plugins) ? config.plugins : {};
  const entries = isRecord(plugins.entries) ? plugins.entries : {};
  const entry = isRecord(entries['memory-wiki']) ? entries['memory-wiki'] : {};
  return entry;
}

function buildMemoryWikiPatch(snapshot: ConfigSnapshot, input: unknown): Record<string, unknown> {
  const body: Record<string, unknown> = isRecord(input) ? input : {};
  const existingEntry = readMemoryWikiEntry(snapshot.config);
  const existingConfig = isRecord(existingEntry.config) ? existingEntry.config : {};
  const vaultPatch: Record<string, unknown> = {
    renderMode: body.renderMode === 'obsidian' ? 'obsidian' : 'native',
  };
  const vaultPath = getString(body.vaultPath);
  if (vaultPath) vaultPatch.path = expandPath(vaultPath);

  const defaultConfig = {
    vaultMode: 'isolated',
    vault: vaultPatch,
    search: {
      backend: 'shared',
      corpus: 'wiki',
    },
  };

  return {
    plugins: {
      entries: {
        'memory-wiki': {
          ...existingEntry,
          enabled: true,
          config: mergeRecords(mergeRecords(defaultConfig, existingConfig), { vault: vaultPatch }),
        },
      },
    },
  };
}

async function collectCandidates(paths: string[], maxFiles: number, maxBytes: number): Promise<{
  candidates: KnowledgeFileCandidate[];
  scanned: number;
  truncated: boolean;
  errors: Array<{ inputPath: string; error: string }>;
}> {
  const fsP = await import('node:fs/promises');
  const candidates: KnowledgeFileCandidate[] = [];
  const errors: Array<{ inputPath: string; error: string }> = [];
  let scanned = 0;
  let truncated = false;

  const addFile = async (rootPath: string, filePath: string, title?: string) => {
    scanned += 1;
    if (!isTextFile(filePath)) return;
    const stat = await fsP.stat(filePath);
    if (!stat.isFile()) return;
    if (stat.size > maxBytes) {
      errors.push({ inputPath: filePath, error: 'tooLarge' });
      return;
    }
    if (candidates.length >= maxFiles) {
      truncated = true;
      return;
    }
    candidates.push({ inputPath: filePath, title: title ?? sourceTitle(rootPath, filePath) });
  };

  const walkDir = async (rootPath: string, dirPath: string, depth: number): Promise<void> => {
    if (truncated || depth > MAX_DIRECTORY_DEPTH) {
      truncated = true;
      return;
    }
    const entries = await fsP.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (truncated) break;
      const nextPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
        await walkDir(rootPath, nextPath, depth + 1);
      } else if (entry.isFile()) {
        await addFile(rootPath, nextPath);
      }
    }
  };

  for (const inputPath of paths) {
    const expanded = resolve(expandPath(inputPath));
    try {
      const stat = await fsP.stat(expanded);
      if (stat.isDirectory()) {
        await walkDir(expanded, expanded, 1);
      } else if (stat.isFile()) {
        await addFile(expanded, expanded, basename(expanded, extname(expanded)));
      }
    } catch (error) {
      errors.push({ inputPath: expanded, error: sanitizeUiErrorText(error) });
    }
  }

  return { candidates, scanned, truncated, errors };
}

function okfIssue(
  code: string,
  message: string,
  input: Partial<Omit<KnowledgeOkfWarning, 'code' | 'message'>> = {},
): KnowledgeOkfWarning {
  return { code, message, ...input };
}

function emptyOkfValidationResult(error: string, bundlePath?: string): KnowledgeOkfValidationResult {
  const issue = okfIssue('invalidBundle', error, bundlePath ? { filePath: bundlePath } : {});
  return {
    success: false,
    error,
    ...(bundlePath ? { bundlePath } : {}),
    summary: {
      scannedFiles: 0,
      markdownFiles: 0,
      conceptFiles: 0,
      validConcepts: 0,
      reservedFiles: 0,
      warnings: 0,
      errors: 1,
      truncated: false,
    },
    typeDistribution: {},
    concepts: [],
    warnings: [],
    errors: [issue],
  };
}

function isOkfMarkdownFile(filePath: string): boolean {
  return extname(filePath).toLowerCase() === '.md';
}

function isReservedOkfFile(filePath: string): boolean {
  return OKF_RESERVED_FILES.has(basename(filePath).toLowerCase());
}

function okfConceptId(rootPath: string, filePath: string): string {
  return relative(rootPath, filePath).replace(/\\/g, '/').replace(/\.md$/iu, '');
}

function createOkfBundleId(rootPath: string): string {
  const base = basename(rootPath).toLowerCase().replace(/[^a-z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '') || 'bundle';
  return `okf_${base}_${randomUUID()}`;
}

function splitYamlFrontmatter(content: string): { yaml: string; body: string } | null {
  const text = content.replace(/^\uFEFF/u, '');
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/u.exec(text);
  return match ? { yaml: match[1], body: match[2] ?? '' } : null;
}

function normalizeOkfTags(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const tags = normalizeStringList(value);
    return tags.length > 0 ? tags : undefined;
  }
  if (typeof value === 'string') {
    const tags = normalizeStringList(value.split(','));
    return tags.length > 0 ? tags : undefined;
  }
  return undefined;
}

function normalizeOkfFrontmatter(raw: Record<string, unknown>, type: string): KnowledgeOkfFrontmatter {
  const frontmatter = { ...raw, type } as KnowledgeOkfFrontmatter;
  const title = getString(raw.title);
  const description = getString(raw.description);
  const resource = getString(raw.resource);
  const timestamp = getString(raw.timestamp);
  const okfVersion = getString(raw.okf_version);
  const tags = normalizeOkfTags(raw.tags);
  if (title) frontmatter.title = title; else delete frontmatter.title;
  if (description) frontmatter.description = description; else delete frontmatter.description;
  if (resource) frontmatter.resource = resource; else delete frontmatter.resource;
  if (timestamp) frontmatter.timestamp = timestamp; else delete frontmatter.timestamp;
  if (okfVersion) frontmatter.okf_version = okfVersion; else delete frontmatter.okf_version;
  if (tags) frontmatter.tags = tags; else delete frontmatter.tags;
  return frontmatter;
}

function bodyPreview(body: string): string {
  const compact = body.replace(/\s+/gu, ' ').trim();
  return compact.length > 360 ? `${compact.slice(0, 357)}...` : compact;
}

function extractMarkdownLinks(body: string): string[] {
  const links = new Set<string>();
  const pattern = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/gu;
  for (const match of body.matchAll(pattern)) {
    const target = match[1]?.trim();
    if (target) links.add(target);
  }
  return Array.from(links);
}

function extractCitations(body: string): string[] {
  const lines = body.split(/\r?\n/u);
  const citationLines: string[] = [];
  let inCitationSection = false;
  for (const line of lines) {
    if (/^#{1,6}\s+(citations?|references?)\s*$/iu.test(line.trim())) {
      inCitationSection = true;
      continue;
    }
    if (inCitationSection && /^#{1,6}\s+/u.test(line.trim())) break;
    if (inCitationSection) citationLines.push(line);
  }
  return extractMarkdownLinks(citationLines.join('\n'));
}

function isExternalOkfLink(target: string): boolean {
  return target.startsWith('#')
    || target.startsWith('//')
    || /^[a-z][a-z0-9+.-]*:/iu.test(target);
}

function okfLinkTargetCandidates(rootPath: string, fromPath: string, target: string): string[] {
  if (!target || isExternalOkfLink(target)) return [];
  const clean = target.split('#')[0].split('?')[0].trim();
  if (!clean) return [];
  const basePath = clean.startsWith('/')
    ? resolve(join(rootPath, clean.replace(/^\/+/u, '')))
    : resolve(dirname(fromPath), clean);
  const candidates = [basePath];
  if (!extname(basePath)) {
    candidates.push(`${basePath}.md`);
    candidates.push(join(basePath, 'index.md'));
  }
  return candidates.filter((candidate) => {
    const rel = relative(rootPath, candidate);
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
  });
}

async function collectOkfMarkdownFiles(rootPath: string): Promise<OkfFileCollection> {
  const files: OkfMarkdownFile[] = [];
  const warnings: KnowledgeOkfWarning[] = [];
  const errors: KnowledgeOkfWarning[] = [];
  let scannedFiles = 0;
  let markdownFiles = 0;
  let truncated = false;

  const walkDir = async (dirPath: string, depth: number): Promise<void> => {
    if (truncated) return;
    if (depth > MAX_DIRECTORY_DEPTH) {
      truncated = true;
      warnings.push(okfIssue('maxDepthExceeded', `OKF folder depth exceeds ${MAX_DIRECTORY_DEPTH}.`, { filePath: dirPath }));
      return;
    }
    let entries: Dirent[];
    try {
      entries = await readdir(dirPath, { withFileTypes: true });
    } catch (error) {
      errors.push(okfIssue('readDirectoryFailed', sanitizeUiErrorText(error), { filePath: dirPath }));
      return;
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (truncated) break;
      const nextPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
        await walkDir(nextPath, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      scannedFiles += 1;
      if (!isOkfMarkdownFile(nextPath)) continue;
      markdownFiles += 1;
      try {
        const fileStat = await stat(nextPath);
        if (fileStat.size > MAX_IMPORT_BYTES_PER_FILE) {
          errors.push(okfIssue('tooLarge', `OKF concept file exceeds ${MAX_IMPORT_BYTES_PER_FILE} bytes.`, { filePath: nextPath }));
          continue;
        }
        if (files.length >= MAX_IMPORT_FILES) {
          truncated = true;
          warnings.push(okfIssue('maxFilesExceeded', `OKF bundle scan was capped at ${MAX_IMPORT_FILES} Markdown files.`, { filePath: rootPath }));
          break;
        }
        files.push({
          filePath: nextPath,
          relativePath: relative(rootPath, nextPath).replace(/\\/g, '/'),
          bytes: fileStat.size,
          reserved: isReservedOkfFile(nextPath),
        });
      } catch (error) {
        errors.push(okfIssue('statFailed', sanitizeUiErrorText(error), { filePath: nextPath }));
      }
    }
  };

  await walkDir(rootPath, 1);
  return { files, scannedFiles, markdownFiles, truncated, errors, warnings };
}

async function readRootOkfVersion(rootIndexPath: string, warnings: KnowledgeOkfWarning[]): Promise<string | undefined> {
  try {
    const content = await readFile(rootIndexPath, 'utf8');
    const split = splitYamlFrontmatter(content);
    if (!split) return undefined;
    const parsed = parseYaml(split.yaml) as unknown;
    if (!isRecord(parsed)) {
      warnings.push(okfIssue('invalidIndexFrontmatter', 'Root index.md frontmatter is not a YAML mapping.', { filePath: rootIndexPath }));
      return undefined;
    }
    return getString(parsed.okf_version);
  } catch (error) {
    warnings.push(okfIssue('indexReadFailed', sanitizeUiErrorText(error), { filePath: rootIndexPath }));
    return undefined;
  }
}

async function validateOkfBundleAtPath(inputPath: string): Promise<KnowledgeOkfValidationResult> {
  const bundlePath = resolve(expandPath(inputPath));
  if (!inputPath.trim()) return emptyOkfValidationResult('path is required');

  try {
    const bundleStat = await stat(bundlePath);
    if (!bundleStat.isDirectory()) {
      return emptyOkfValidationResult('OKF bundle path must be a local directory', bundlePath);
    }
  } catch (error) {
    return emptyOkfValidationResult(sanitizeUiErrorText(error), bundlePath);
  }

  const collection = await collectOkfMarkdownFiles(bundlePath);
  const warnings: KnowledgeOkfWarning[] = [...collection.warnings];
  const errors: KnowledgeOkfWarning[] = [...collection.errors];
  const concepts: KnowledgeOkfConcept[] = [];
  const typeDistribution: Record<string, number> = {};
  const bundleId = createOkfBundleId(bundlePath);
  const markdownPathSet = new Set(collection.files.map((file) => resolve(file.filePath).toLowerCase()));
  const rootIndex = collection.files.find((file) => file.relativePath.toLowerCase() === 'index.md');

  if (!rootIndex) {
    warnings.push(okfIssue('missingRootIndex', 'Root index.md is recommended for OKF bundles.', { filePath: bundlePath }));
  }
  const okfVersion = rootIndex ? await readRootOkfVersion(rootIndex.filePath, warnings) : undefined;

  let conceptFiles = 0;
  for (const file of collection.files) {
    if (file.reserved) continue;
    conceptFiles += 1;
    const conceptId = okfConceptId(bundlePath, file.filePath);
    let content;
    try {
      content = await readFile(file.filePath, 'utf8');
    } catch (error) {
      errors.push(okfIssue('readConceptFailed', sanitizeUiErrorText(error), { conceptId, filePath: file.filePath }));
      continue;
    }

    const split = splitYamlFrontmatter(content);
    if (!split) {
      errors.push(okfIssue('missingFrontmatter', 'OKF concept files require YAML frontmatter.', { conceptId, filePath: file.filePath }));
      continue;
    }

    let parsed: unknown;
    try {
      parsed = parseYaml(split.yaml) as unknown;
    } catch (error) {
      errors.push(okfIssue('invalidFrontmatter', sanitizeUiErrorText(error), { conceptId, filePath: file.filePath }));
      continue;
    }
    if (!isRecord(parsed)) {
      errors.push(okfIssue('invalidFrontmatter', 'OKF frontmatter must be a YAML mapping.', { conceptId, filePath: file.filePath }));
      continue;
    }

    const type = getString(parsed.type);
    if (!type) {
      errors.push(okfIssue('missingType', 'OKF concept frontmatter requires a non-empty type.', { conceptId, filePath: file.filePath }));
      continue;
    }

    const conceptWarnings: KnowledgeOkfWarning[] = [];
    const unknownKeys = Object.keys(parsed).filter((key) => !OKF_KNOWN_FRONTMATTER_KEYS.has(key));
    if (unknownKeys.length > 0) {
      conceptWarnings.push(okfIssue('unknownFields', `Unknown OKF frontmatter fields preserved: ${unknownKeys.join(', ')}.`, { conceptId, filePath: file.filePath }));
    }
    if (!OKF_COMMON_TYPES.has(type.toLowerCase())) {
      conceptWarnings.push(okfIssue('unknownType', `Unknown OKF type "${type}" preserved for compatibility.`, { conceptId, filePath: file.filePath }));
    }
    if (!getString(parsed.description)) {
      conceptWarnings.push(okfIssue('missingDescription', 'description is recommended for OKF concepts.', { conceptId, filePath: file.filePath }));
    }

    const links = extractMarkdownLinks(split.body);
    for (const target of links) {
      const candidates = okfLinkTargetCandidates(bundlePath, file.filePath, target);
      if (candidates.length > 0 && !candidates.some((candidate) => markdownPathSet.has(resolve(candidate).toLowerCase()))) {
        conceptWarnings.push(okfIssue('brokenLink', `Broken OKF link: ${target}`, { conceptId, filePath: file.filePath, target }));
      }
    }

    const frontmatter = normalizeOkfFrontmatter(parsed, type);
    const concept: KnowledgeOkfConcept = {
      conceptId,
      filePath: file.filePath,
      frontmatter,
      bodyPreview: bodyPreview(split.body),
      links,
      citations: extractCitations(split.body),
      warnings: conceptWarnings,
    };
    concepts.push(concept);
    warnings.push(...conceptWarnings);
    typeDistribution[type] = (typeDistribution[type] ?? 0) + 1;
  }

  return {
    success: errors.length === 0,
    ...(errors.length > 0 ? { error: `${errors.length} OKF validation error(s)` } : {}),
    bundleId,
    bundlePath,
    ...(okfVersion ? { okfVersion } : {}),
    summary: {
      scannedFiles: collection.scannedFiles,
      markdownFiles: collection.markdownFiles,
      conceptFiles,
      validConcepts: concepts.length,
      reservedFiles: collection.files.filter((file) => file.reserved).length,
      warnings: warnings.length,
      errors: errors.length,
      truncated: collection.truncated,
    },
    typeDistribution,
    concepts,
    warnings,
    errors,
  };
}

function okfImportTitle(concept: KnowledgeOkfConcept): string {
  return concept.frontmatter.title
    || basename(concept.filePath, extname(concept.filePath))
    || concept.conceptId;
}

const ROUTER_BUDGET = {
  maxReferences: 3,
  maxSnippetChars: 800,
} as const;

function retrievalSourceKindFromRow(row: Record<string, unknown>): KnowledgeRetrievalDiagnostics['items'][number]['sourceKind'] {
  const metadata = routeMetadataFromRow(row);
  const knowledgeKind = routeStringFromRecord(metadata, ['knowledgeKind', 'kind']).toLowerCase();
  const type = (rowString(row, ['type', 'draftType', 'okfType']) || routeStringFromRecord(metadata, ['type', 'draftType', 'okfType'])).toLowerCase();
  if (knowledgeKind === 'error-experience' || isRecord(metadata.errorExperience) || isRecord(row.errorExperience)) return 'error-experience';
  if (knowledgeKind === 'rule' || type === 'rule') return 'rule';
  if (type === 'draft') return 'draft';
  if (type === 'inbox') return 'inbox';
  if (type === 'memory' || type === 'memory-card') return 'memory-card';
  if (rowString(row, ['lookup', 'pagePath', 'path', 'id', 'pageId'])) return 'wiki-page';
  return 'unknown';
}

function buildRetrievalDiagnostics(input: {
  query: string;
  corpus: 'wiki' | 'memory' | 'all';
  mode: string;
  rows: Record<string, unknown>[];
  selectedLookups?: Set<string>;
  reason: string;
  backend?: KnowledgeRetrievalDiagnostics['backend'];
}): KnowledgeRetrievalDiagnostics {
  const selectedLookups = input.selectedLookups ?? new Set(input.rows.map((row) => rowString(row, ['lookup', 'pagePath', 'path', 'id', 'pageId'])));
  const items = input.rows.map((row) => {
    const lookup = rowString(row, ['lookup', 'pagePath', 'path', 'id', 'pageId']);
    const score = rowNumber(row, ['score', 'rank', 'similarity'], 0);
    const confidence = score > 0 ? Math.max(0, Math.min(1, score > 1 ? score / 100 : score)) : undefined;
    return {
      id: rowString(row, ['id', 'pageId']) || lookup || rowString(row, ['title', 'name']) || 'unknown',
      title: rowString(row, ['title', 'name', 'pageTitle']) || lookup || 'Untitled',
      lookup,
      sourceKind: retrievalSourceKindFromRow(row),
      reason: lookup && selectedLookups.has(lookup) ? input.reason : 'available search result',
      ...(score > 0 ? { score } : {}),
      ...(confidence != null ? { confidence } : {}),
      ...(rowString(row, ['sourcePath', 'pagePath', 'path']) ? { path: rowString(row, ['sourcePath', 'pagePath', 'path']) } : {}),
    };
  });
  return {
    query: input.query,
    corpus: input.corpus,
    mode: input.mode,
    backend: input.backend ?? 'fallback-keyword',
    resultCount: input.rows.length,
    selectedCount: items.filter((item) => item.lookup && selectedLookups.has(item.lookup)).length,
    reason: input.reason,
    items,
  };
}

const KNOWLEDGE_INTENT_PATTERN = /(之前|以往|历史|项目里|项目中|规范|架构|为什么|决策|约定|排障|故障|知识库|wiki|memory|context|architecture|decision|convention|troubleshoot|previous|history|project notes|knowledge)/i;

function normalizeRouteMode(value: unknown): 'manual' | 'suggest' | 'auto-read' {
  return value === 'manual' || value === 'auto-read' ? value : 'suggest';
}

function normalizeRouteScope(value: unknown): 'none' | 'memory' | 'wiki' | 'all' {
  return value === 'memory' || value === 'wiki' || value === 'all' ? value : 'none';
}

function shouldRouteKnowledge(message: string, scope: 'none' | 'memory' | 'wiki' | 'all', mode: 'manual' | 'suggest' | 'auto-read', selectedCount: number): { route: boolean; reason: string; query?: string } {
  const text = message.trim();
  if (scope === 'none') return { route: false, reason: 'knowledge scope is none' };
  if (mode === 'manual') return { route: false, reason: 'knowledge mode is manual' };
  if (selectedCount > 0) return { route: false, reason: 'user selected explicit knowledge references' };
  if (text.startsWith('/')) return { route: false, reason: 'slash command in progress' };
  if (text.length < 18) return { route: false, reason: 'message too short for routing' };
  if (!KNOWLEDGE_INTENT_PATTERN.test(text) && scope !== 'wiki' && scope !== 'all') {
    return { route: false, reason: 'no project knowledge intent detected' };
  }
  return { route: true, reason: 'project knowledge intent detected', query: text.replace(/\s+/g, ' ').slice(0, 180) };
}

function getRouteSearchRows(value: unknown): Record<string, unknown>[] {
  const record = isRecord(value) ? value : {};
  const results = record.results;
  if (Array.isArray(results)) return results.filter(isRecord) as Record<string, unknown>[];
  const hits = record.hits;
  if (Array.isArray(hits)) return hits.filter(isRecord) as Record<string, unknown>[];
  return [];
}

function rowNumber(row: Record<string, unknown>, keys: string[], fallback = 0): number {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return fallback;
}

function rowString(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function routeMetadataFromRow(row: Record<string, unknown>): Record<string, unknown> {
  const metadata = isRecord(row.metadata) ? row.metadata : {};
  const frontmatter = isRecord(row.frontmatter) ? row.frontmatter : {};
  const okf = isRecord(row.okf) ? row.okf : {};
  return { ...okf, ...frontmatter, ...metadata };
}

function routeStringFromRecord(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function routeGroupForRow(row: Record<string, unknown>): KnowledgeRouteCandidateGroupKey {
  const metadata = routeMetadataFromRow(row);
  const knowledgeKind = routeStringFromRecord(metadata, ['knowledgeKind', 'kind']).toLowerCase();
  const type = (rowString(row, ['type', 'draftType', 'okfType']) || routeStringFromRecord(metadata, ['type', 'draftType', 'okfType'])).toLowerCase();
  const sourcePath = rowString(row, ['sourcePath', 'pagePath', 'path', 'lookup']).replace(/\\/g, '/').toLowerCase();
  const hasErrorExperience = isRecord(metadata.errorExperience) || isRecord(row.errorExperience);

  if (
    knowledgeKind === 'error-experience'
    || hasErrorExperience
    || (type === 'troubleshooting' && (hasErrorExperience || /error|failure|pitfall|troubleshoot|incident/u.test(sourcePath)))
  ) {
    return 'pitfalls';
  }
  if (
    knowledgeKind === 'rule'
    || type === 'rule'
    || isGovernedRulesPath(sourcePath)
    || /(^|\/)(rules?|conventions?)\//u.test(sourcePath)
  ) {
    return 'rules';
  }
  return 'docs';
}

function routeCandidateFromRow(row: Record<string, unknown>, corpus: 'wiki' | 'memory' | 'all', attachKind: 'suggested' | 'auto', reason: string): KnowledgeRouteCandidate | null {
  const lookup = rowString(row, ['lookup', 'pagePath', 'path', 'id', 'pageId']);
  if (!lookup) return null;
  const title = rowString(row, ['title', 'name', 'pageTitle']) || lookup;
  const score = rowNumber(row, ['score', 'rank', 'similarity'], 0.7);
  const confidence = Math.max(0, Math.min(1, score > 1 ? score / 100 : score));
  const snippet = rowString(row, ['snippet', 'bodyPreview', 'preview', 'text']).slice(0, ROUTER_BUDGET.maxSnippetChars);
  const freshnessLevel = rowString(row, ['freshnessLevel', 'freshness']);
  const matchedClaimStatus = rowString(row, ['matchedClaimStatus', 'claimStatus']);
  return {
    id: rowString(row, ['id', 'pageId']) || lookup,
    title,
    lookup,
    corpus,
    attachKind,
    routingReason: reason,
    routeGroup: routeGroupForRow(row),
    confidence,
    ...(rowString(row, ['pageId']) ? { pageId: rowString(row, ['pageId']) } : {}),
    ...(rowString(row, ['pagePath', 'path']) ? { pagePath: rowString(row, ['pagePath', 'path']) } : {}),
    ...(rowString(row, ['sourcePath']) ? { sourcePath: rowString(row, ['sourcePath']) } : {}),
    ...(snippet ? { snippet } : {}),
    ...(score ? { score } : {}),
    ...(freshnessLevel ? { freshnessLevel } : {}),
    ...(matchedClaimStatus ? { matchedClaimStatus } : {}),
  };
}

function routeCandidatesFromSearch(result: unknown, corpus: 'wiki' | 'memory' | 'all', mode: 'suggest' | 'auto-read', reason: string): KnowledgeRouteCandidate[] {
  const attachKind = mode === 'auto-read' ? 'auto' : 'suggested';
  const candidates = getRouteSearchRows(result)
    .map((row) => routeCandidateFromRow(row, corpus, attachKind, reason))
    .filter((candidate): candidate is KnowledgeRouteCandidate => Boolean(candidate));
  const filtered = mode === 'auto-read'
    ? candidates.filter((candidate) => (
      candidate.confidence >= 0.55
      && candidate.freshnessLevel !== 'stale'
      && candidate.matchedClaimStatus !== 'contradicted'
    ))
    : candidates;
  return filtered.slice(0, ROUTER_BUDGET.maxReferences);
}

function groupedRouteCandidates(candidates: KnowledgeRouteCandidate[]): KnowledgeRouteCandidateGroup[] {
  const groups: Record<KnowledgeRouteCandidateGroupKey, KnowledgeRouteCandidate[]> = {
    docs: [],
    pitfalls: [],
    rules: [],
    runtime_lessons: [],
  };
  for (const candidate of candidates) {
    groups[candidate.routeGroup ?? 'docs'].push(candidate);
  }
  return (['docs', 'pitfalls', 'rules', 'runtime_lessons'] as KnowledgeRouteCandidateGroupKey[])
    .flatMap((key) => (groups[key].length > 0 ? [{ key, candidates: groups[key] }] : []));
}

function routeCandidateGroupRecord(candidates: KnowledgeRouteCandidate[]): Partial<Record<KnowledgeRouteCandidateGroupKey, KnowledgeRouteCandidate[]>> {
  const record: Partial<Record<KnowledgeRouteCandidateGroupKey, KnowledgeRouteCandidate[]>> = {};
  for (const group of groupedRouteCandidates(candidates)) {
    record[group.key] = group.candidates;
  }
  return record;
}

// ── Area 5 §3.2 — Semantic Steward pass (opt-in, default-off) ──

/**
 * Context gathered for the semantic steward pass: draft fields + top-K wiki
 * search results. The invoker receives this and returns a structured review
 * or null on failure.
 */
export type SemanticStewardContext = {
  title: string;
  body: string;
  tags: string[];
  sourceIds: string[];
  searchResults: Array<{ title: string; snippet: string; pagePath?: string }>;
};

/**
 * Pluggable LLM invoker for the semantic steward pass. In production this is
 * wired to a `chat.send` / `spawnRoleSubagent` call with the steward contract
 * as system prompt. In tests it is mocked. Default is null (no LLM available)
 * → semantic pass degrades to heuristic-only with a "semantic pass unavailable" note.
 */
export type SemanticStewardInvoker = (context: SemanticStewardContext) => Promise<StewardSemanticReview | null>;

let semanticStewardInvoker: SemanticStewardInvoker | null = null;
let semanticStewardInvokerExplicitlyInjected = false;

export function setSemanticStewardInvoker(invoker: SemanticStewardInvoker | null): void {
  semanticStewardInvoker = invoker;
  // null is the test/production reset sentinel: it clears any prior explicit DI
  // marker so a later createKnowledgeApi with a real gateway can install the
  // production invoker again.
  semanticStewardInvokerExplicitlyInjected = invoker !== null;
}

export function getSemanticStewardInvoker(): SemanticStewardInvoker | null {
  return semanticStewardInvoker;
}

/**
 * R3-1 v3 task 5: production Semantic Steward invoker backed by a real
 * embedded-agent turn through the gateway `agent` RPC (the same pattern the
 * Code Review Center uses). Runs a one-shot model-only turn with the steward
 * contract as the prompt, collects assistant deltas, waits for completion, and
 * parses the JSON review. Every failure path returns null so the caller's
 * heuristic result stands (degradation is explicit in the notes).
 */
export async function runSemanticStewardInvoker(
  gatewayManager: GatewayManager,
  context: SemanticStewardContext,
  timeoutMs = 60_000,
): Promise<StewardSemanticReview | null> {
  try {
    const deltas: string[] = [];
    let modelRunId: string | undefined;
    const sessionKey = `agent:main:steward-${createHash('sha256').update(context.title + context.body).digest('hex').slice(0, 8)}`;
    const onRuntimeEvent = (event: ChatRuntimeEvent) => {
      if (event.runId !== modelRunId) return;
      if (event.type === 'assistant.delta') deltas.push(event.text ?? event.delta ?? '');
    };

    gatewayManager.on('chat:runtime-event', onRuntimeEvent);
    try {
      const accepted = await gatewayManager.rpc<Record<string, unknown>>('agent', {
        sessionKey,
        message: buildSemanticStewardPrompt(context),
        deliver: false,
        idempotencyKey: `steward:${sessionKey}:${context.sourceIds.join(',')}`,
        modelRun: true,
        promptMode: 'none',
        disableMessageTool: true,
        bestEffortDeliver: false,
        label: 'Knowledge Steward',
        timeout: Math.ceil(timeoutMs / 1000),
      }, timeoutMs);
      modelRunId = typeof accepted?.runId === 'string' ? accepted.runId : undefined;
      if (!modelRunId) throw new Error('Runtime did not accept the steward run');

      const wait = await gatewayManager.rpc<Record<string, unknown>>('agent.wait', {
        runId: modelRunId,
        timeoutMs,
      }, timeoutMs + 5_000);
      if (wait?.status === 'timeout' || wait?.status === 'pending') {
        throw new Error('Semantic steward run timed out');
      }
      if (wait?.status === 'error') {
        throw new Error(typeof wait.error === 'string' ? wait.error : 'Semantic steward run failed');
      }

      const streamedText = deltas.join('').trim();
      if (streamedText) return parseStewardSemanticReview(streamedText);

      const history = await gatewayManager.rpc<Record<string, unknown>>('chat.history', {
        sessionKey,
        limit: 20,
        maxChars: 200_000,
      }, 30_000).catch(() => undefined);
      const latestText = extractLatestAssistantText(history?.messages);
      return latestText ? parseStewardSemanticReview(latestText) : null;
    } finally {
      gatewayManager.off('chat:runtime-event', onRuntimeEvent);
    }
  } catch {
    return null;
  }
}

/**
 * Builds the steward contract prompt for one draft review. The model must reply
 * with ONLY a JSON object matching StewardSemanticReview.
 */
export function buildSemanticStewardPrompt(context: SemanticStewardContext): string {
  const searchSection =
    context.searchResults.length > 0
      ? context.searchResults
          .map((result) => `- ${result.title}${result.pagePath ? ` (${result.pagePath})` : ''}: ${result.snippet}`)
          .join('\n')
      : '(no wiki search results)';
  return [
    'You are the Knowledge Steward semantic reviewer.',
    'Classify the knowledge draft below and identify quality issues.',
    'Allowed draft types: source-note, synthesis, decision, architecture, command, troubleshooting, glossary, procedure.',
    'Warning kinds: duplicate, conflict, stale, quality.',
    'Respond with ONLY a JSON object in this exact shape:',
    '{"type":"<draft type>","tags":["<tag>"],"warnings":[{"kind":"<warning kind>","message":"<text>","relatedPageId":"<optional>"}],"confidence":<0..1>}',
    '',
    '--- DRAFT ---',
    `Title: ${context.title}`,
    `Body: ${context.body}`,
    `Tags: ${context.tags.join(', ') || '(none)'}`,
    `Source ids: ${context.sourceIds.join(', ') || '(none)'}`,
    '',
    '--- WIKI SEARCH RESULTS (context) ---',
    searchSection,
  ].join('\n');
}

/**
 * Parses the steward model reply into a StewardSemanticReview. Returns null
 * when the reply is not a valid review object (degradation to heuristic).
 */
export function parseStewardSemanticReview(text: string): StewardSemanticReview | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonCandidateFromText(text));
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const type = KNOWLEDGE_DRAFT_TYPES.has(parsed.type as KnowledgeDraftType)
    ? (parsed.type as KnowledgeDraftType)
    : undefined;
  if (!type) return null;
  const confidence = typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence)
    ? Math.max(0, Math.min(1, parsed.confidence))
    : 0;
  const tags = Array.isArray(parsed.tags)
    ? parsed.tags.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0).map((tag) => tag.trim())
    : [];
  const warnings = Array.isArray(parsed.warnings)
    ? parsed.warnings.flatMap((entry) => {
        if (!isRecord(entry)) return [];
        const kind = entry.kind;
        if (kind !== 'duplicate' && kind !== 'conflict' && kind !== 'stale' && kind !== 'quality') return [];
        const message = typeof entry.message === 'string' && entry.message.trim() ? entry.message.trim() : '';
        if (!message) return [];
        const relatedPageId = typeof entry.relatedPageId === 'string' && entry.relatedPageId.trim() ? entry.relatedPageId.trim() : undefined;
        const warning: StewardSemanticReview['warnings'][number] = {
          kind: kind as StewardSemanticReview['warnings'][number]['kind'],
          message,
          ...(relatedPageId ? { relatedPageId } : {}),
        };
        return [warning];
      })
    : [];
  return { type, tags, warnings, confidence };
}

function jsonCandidateFromText(text: string): string {
  const trimmed = text.trim();
  const start = trimmed.indexOf('{');
  if (start < 0) return trimmed;
  const end = trimmed.lastIndexOf('}');
  if (end <= start) return trimmed;
  return trimmed.slice(start, end + 1);
}

function extractLatestAssistantText(messages: unknown): string | undefined {
  if (!Array.isArray(messages)) return undefined;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!isRecord(message) || message.role !== 'assistant') continue;
    const content = message.content;
    if (typeof content === 'string' && content.trim()) return content.trim();
    if (Array.isArray(content)) {
      const textParts = content
        .filter((part): part is { type: string; text?: string } => isRecord(part) && part.type === 'text')
        .map((part) => (typeof part.text === 'string' ? part.text : ''))
        .filter((text) => text.length > 0);
      if (textParts.length > 0) return textParts.join('').trim();
    }
  }
  return undefined;
}


/**
 * Pure merge of heuristic + semantic review results. Exported for unit testing.
 * - Semantic type overrides heuristic when confidence >= 0.7 (spec: "below threshold → keep heuristic result").
 * - Tags are unioned and deduped.
 * - Warnings are concatenated; semantic warnings are prefixed with [kind].
 * - Notes append a semantic pass summary line.
 */
export function mergeSemanticReview(
  heuristic: { type: KnowledgeDraftType; tags: string[]; warnings: string[]; notes: string },
  semantic: StewardSemanticReview,
): { type: KnowledgeDraftType; tags: string[]; warnings: string[]; notes: string } {
  const mergedType = semantic.confidence >= 0.7 ? semantic.type : heuristic.type;
  const mergedTags = Array.from(new Set([...heuristic.tags, ...semantic.tags]));
  const semanticWarnings = semantic.warnings.map((w) =>
    `[${w.kind}] ${w.message}${w.relatedPageId ? ` (→ ${w.relatedPageId})` : ''}`,
  );
  const mergedWarnings = [...heuristic.warnings, ...semanticWarnings];
  const mergedNotes = `${heuristic.notes}\nSemantic steward pass: confidence=${semantic.confidence.toFixed(2)}, type=${semantic.type}.`;
  return { type: mergedType, tags: mergedTags, warnings: mergedWarnings, notes: mergedNotes };
}

async function defaultRuntimeLessonsReporter(): Promise<KnowledgeRuntimeLessonsReportResult> {
  const sekb = await loadSekbRuntimeModule();
  if (!sekb) {
    return {
      success: true,
      available: false,
      reason: 'runtimeUnavailable',
      ...EMPTY_RUNTIME_LESSONS_REPORT,
    };
  }

  try {
    const store = createHostSekbStore(sekb);
    const report = sekb.buildSekbOperatorReport(store);
    return { success: true, available: true, ...report };
  } catch (error) {
    return {
      success: false,
      available: false,
      reason: 'reportFailed',
      error: sanitizeUiErrorText(error),
      ...EMPTY_RUNTIME_LESSONS_REPORT,
    };
  }
}

let hostGovernedAdaptersRegistered = false;

function registerHostGovernedAdapters(): void {
  if (hostGovernedAdaptersRegistered) return;
  governedAdapterRegistry.register(createMemoryWikiGovernedAdapter());
  governedAdapterRegistry.register(createRoleMemoryGovernedAdapter({ activeMemorySlot: 'role-memory' }));
  governedAdapterRegistry.register(createSekbGovernedAdapter());
  hostGovernedAdaptersRegistered = true;
}

export function __resetHostGovernedAdaptersForTests(): void {
  governedAdapterRegistry.clearForTests();
  hostGovernedAdaptersRegistered = false;
}

export function createKnowledgeApi({
  gatewayManager,
  runtimeLessonsReporter = defaultRuntimeLessonsReporter,
}: {
  gatewayManager: GatewayManager;
  runtimeLessonsReporter?: RuntimeLessonsReporter;
}): CompleteHostServiceRegistry['knowledge'] {
  const rpc = <T>(method: string, params: unknown = {}, timeoutMs = 30_000) =>
    gatewayManager.rpc(method, params, timeoutMs) as Promise<T>;

  // KS-03: register the three governed target adapters once per process.
  registerHostGovernedAdapters();

  // KS-01 / R3-1 v3 task 5: wire the production semantic steward invoker only
  // when a real gateway manager is available and no explicit invoker was
  // injected by the caller. Tests that call setSemanticStewardInvoker before
  // createKnowledgeApi keep their injected invoker (dependency injection).
  if (gatewayManager && !semanticStewardInvokerExplicitlyInjected) {
    semanticStewardInvoker = (context) => runSemanticStewardInvoker(gatewayManager, context);
  }

  async function readSourceSetAnswerSource(ref: KnowledgeSourceRef): Promise<KnowledgeSourceSetAnswerSource | null> {
    const lookup = ref.path || ref.id;
    if (!lookup) return null;
    try {
      const page = await rpc<Record<string, unknown>>('wiki.get', { lookup, lineCount: 80, corpus: 'wiki' }, 30_000);
      const title = rowString(page, ['title', 'name', 'pageTitle']) || ref.label || lookup;
      const pagePath = rowString(page, ['pagePath', 'path', 'sourcePath']) || ref.path;
      const body = rowString(page, ['body', 'content', 'text', 'snippet', 'bodyPreview']);
      return {
        id: ref.id,
        lookup,
        title,
        excerpt: bodyPreview(body || ref.label || lookup),
        ...(body ? { content: body } : {}),
        ...(pagePath ? { path: pagePath } : {}),
      };
    } catch {
      return null;
    }
  }

  function publicSourceSetAnswerSource(source: KnowledgeSourceSetAnswerSource): KnowledgeSourceSetAnswerSource {
    return {
      id: source.id,
      lookup: source.lookup,
      title: source.title,
      excerpt: source.excerpt,
      ...(source.path ? { path: source.path } : {}),
    };
  }

  function sourceSetCandidateFromAnswerSource(source: KnowledgeSourceSetAnswerSource): SourceSetCandidate {
    const content = source.content ?? source.excerpt;
    return {
      ref: {
        refId: `memory-wiki:${source.lookup}`,
        owner: 'memory-wiki',
        subjectKind: 'wiki-page',
        subjectId: source.lookup,
        revision: 'selected',
        contentDigest: digestSourceSetContent(content),
        trust: 'confirmed',
        sensitivity: 'workspace',
        acl: { read: ['operator'] },
        provenance: {
          sourceRefs: [source.id || source.lookup],
          evidenceRefs: [],
        },
      },
      content,
      status: 'active',
      indexedAt: nowIso(),
    };
  }

  async function buildAnswerFromSourceSet(input: {
    question: string;
    sourceRefs: KnowledgeSourceRef[];
    artifactType?: KnowledgeArtifactType;
    sourceSetId?: string;
    semantic?: boolean;
  }): Promise<KnowledgeAnswerFromSourceSetResult> {
    const question = input.question.trim();
    const sourceRefs = normalizeSourceRefs(input.sourceRefs);
    const sources = (await Promise.all(sourceRefs.map((ref) => readSourceSetAnswerSource(ref))))
      .filter((source): source is KnowledgeSourceSetAnswerSource => Boolean(source));
    const semanticRequested = input.semantic === true;
    let semanticLane: NonNullable<KnowledgeAnswerFromSourceSetResult['semanticLane']> | undefined;
    let orderedSources = sources;
    if (semanticRequested && sources.length > 0) {
      const embeddingProvider = hasSiliconFlowEmbeddingProvider()
        ? createSiliconFlowEmbeddingProvider()
        : undefined;
      const sourceSetCandidates = sources.map(sourceSetCandidateFromAnswerSource);
      const sourceSetResult = await retrieveSourceSet({
        sources: sourceSetCandidates,
        query: {
          text: question,
          aclSubjects: ['operator'],
          limit: Math.max(1, sources.length),
        },
        embeddingProvider,
        now: () => new Date(),
      });
      semanticLane = sourceSetResult.semanticLane;
      const nextSources: KnowledgeSourceSetAnswerSource[] = [];
      for (const entry of sourceSetResult.retrieved) {
        const source = sources.find((item) => `memory-wiki:${item.lookup}` === entry.ref.refId);
        if (source) {
          nextSources.push({ ...source, content: entry.content });
        }
      }
      orderedSources = nextSources;
      if (orderedSources.length === 0) {
        orderedSources = sources;
      }
    } else if (semanticRequested) {
      semanticLane = { status: 'unavailable', reason: 'no-readable-sources' };
    }
    const rows = sources.length > 0
      ? sources.map((source) => ({
        id: source.id,
        title: source.title,
        lookup: source.lookup,
        pagePath: source.path ?? source.lookup,
      }))
      : sourceRefs.map((ref) => ({
        id: ref.id,
        title: ref.label ?? ref.id,
        lookup: ref.path ?? ref.id,
        pagePath: ref.path ?? ref.id,
      }));
    const selectedLookups = new Set(rows.map((row) => row.lookup));
    const retrievalDiagnostics = buildRetrievalDiagnostics({
      query: question,
      corpus: 'wiki',
      mode: 'source-set',
      rows,
      selectedLookups,
      reason: 'explicit Source Set selection',
      backend: semanticRequested && semanticLane?.status === 'available' ? 'semantic' : 'fallback-keyword',
    });
    const missingCount = Math.max(0, sourceRefs.length - sources.length);
    const groundingStatus: KnowledgeAnswerFromSourceSetResult['groundingStatus'] = sources.length === 0
      ? 'missing_sources'
      : missingCount > 0
        ? 'partial'
        : 'grounded';
    const unknowns = [
      'Grounding is page/snippet level.',
      ...(missingCount > 0 ? [`${missingCount} selected source(s) could not be read.`] : []),
      ...(sources.length === 0 ? ['No selected sources were readable.'] : []),
    ];
    const suggestedNextActions = groundingStatus === 'missing_sources'
      ? ['Add readable sources to the Source Set.', 'Broaden the search and save a new Source Set.']
      : ['Review this answer before creating a durable draft.', 'Create a Studio artifact draft when the synthesis looks useful.'];
    const artifactHint = input.artifactType ? ` Artifact focus: ${input.artifactType}.` : '';
    const sourceLines = orderedSources.map((source, index) => (
      `${index + 1}. ${source.title}: ${source.excerpt}`
    ));
    const answer = orderedSources.length > 0
      ? [
        `Answer grounded in ${orderedSources.length} selected source(s).${artifactHint}`,
        `Question: ${question}`,
        '',
        ...sourceLines,
      ].join('\n')
      : [
        'I could not answer from the selected Source Set because no selected source was readable.',
        `Question: ${question}`,
      ].join('\n');
    if (input.sourceSetId) {
      const sourceSet = await readSourceSet(input.sourceSetId);
      if (sourceSet) await writeSourceSet({ ...sourceSet, lastUsedAt: nowIso(), updatedAt: nowIso() });
    }
    return {
      success: true,
      question,
      answer,
      sources: orderedSources.map(publicSourceSetAnswerSource),
      unknowns,
      suggestedNextActions,
      groundingStatus,
      confidence: groundingStatus === 'grounded' ? 0.78 : groundingStatus === 'partial' ? 0.48 : 0,
      retrievalDiagnostics,
      semanticRequested,
      ...(semanticLane ? { semanticLane } : {}),
    };
  }

  function artifactDraftBody(answer: KnowledgeAnswerFromSourceSetResult, artifactType: KnowledgeArtifactType): string {
    const sourceLines = answer.sources.length > 0
      ? answer.sources.map((source) => `- ${source.title} (${source.lookup})\n  ${source.excerpt}`).join('\n')
      : '- No readable selected sources.';
    return [
      `# ${defaultArtifactTitle(artifactType)}`,
      '',
      `Artifact type: ${artifactType}`,
      '',
      '## Answer',
      answer.answer,
      '',
      '## Sources used',
      sourceLines,
      '',
      '## Unknowns / missing sources',
      answer.unknowns.map((unknown) => `- ${unknown}`).join('\n'),
      '',
      '## Suggested next action',
      answer.suggestedNextActions.map((action) => `- ${action}`).join('\n'),
    ].join('\n');
  }


  // ── Inbox item helper ──
  function createInboxItemObject(input: Record<string, unknown>): KnowledgeInboxItem {
    const timestamp = nowIso();
    const title = getString(input.title) ?? 'Untitled';
    const body = getString(input.body) ?? getString(input.description) ?? '';
    const kind = normalizeInboxKind(input.kind);
    const sourcePath = getString(input.sourcePath);
    const sourceRefs: KnowledgeSourceRef[] = sourcePath ? [{ id: sourcePath, kind: 'file', path: sourcePath }] : [];
    const warnings = Array.from(new Set([
      ...normalizeStringList(input.warnings),
      ...rulesGuardWarningsForRefs(sourceRefs),
      ...(input.requiresReview === false ? ['Automatic knowledge capture is review-gated; direct wiki ingest is disabled for this path.'] : []),
    ]));
    const metadata: Record<string, unknown> = { 
      ...(isRecord(input.metadata) ? input.metadata : {}),
      ...(sourcePath ? { sourcePath } : {}),
      ...(sourcePath && isGovernedRulesPath(sourcePath) ? { rulesGuarded: true } : {}),
    };
    // Area 5 §3.4 — pass through roleTags if present in the input.
    const roleTags = normalizeStringList(input.roleTags);
    const item: KnowledgeInboxItem = {
      id: `ki_${randomUUID()}`,
      title,
      body,
      kind,
      type: typeof input.type === 'string' ? normalizeDraftType(input.type) : classifyDraft(title, body),
      status: 'pending',
      sourceIds: sourceRefs.map((ref) => ref.id),
      sourceRefs,
      tags: normalizeStringList(input.tags),
      workspaceId: null,
      agentId: null,
      ...(roleTags.length > 0 ? { roleTags } : {}),
      createdBy: normalizeDraftActor(input.createdBy),
      warnings,
      metadata,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    return withInboxTriage(item);
  }

  // ── Watched Directory Helpers ──

  const WATCHED_DIR_CONFIG_PATH = () => join(getKnowledgeDir(), 'watched-directories.json');
  const WATCHED_DIR_EVENTS_PATH = (configId: string) => join(getKnowledgeDir(), 'watched-events', `${configId}.jsonl`);

  const watchedStates = new Map<string, { configId: string; watcher: FSWatcher | null; debounceTimer: ReturnType<typeof setTimeout> | null }>();

  /**
   * Read watched-directory configuration.
   *
   * Corruption policy is fail-closed (harness rule
   * `local-data-fail-closed-config`). The previous implementation swallowed every
   * error and returned `[]`; because every caller follows with a
   * read-modify-write that rewrites the whole array, a corrupt or unreadable
   * file would have been silently replaced by an empty list, dropping every
   * user's watched directory with no error surfaced. `readJsonAtomic`
   * restores from `.bak` when the primary is corrupt or missing; only a
   * genuinely absent file yields `[]`.
   */
  async function readWatchedDirConfigs(): Promise<KnowledgeWatchedDirectoryConfig[]> {
    const configPath = WATCHED_DIR_CONFIG_PATH();
    if (!(await fileExistsOrNull(configPath))) return [];
    const result = await readJsonAtomic<KnowledgeWatchedDirectoryConfig[]>(configPath, {
      fallback: [],
    });
    if (result.recoveredFromBackup) {
      logger.warn(`[knowledge] ${result.recoveryNote ?? 'recovered watched-directories.json from backup'}`);
    }
    return Array.isArray(result.data) ? result.data : [];
  }

  /** Persist watched-directory configuration atomically (temp + fsync + rename + `.bak`). */
  async function writeWatchedDirConfigs(configs: KnowledgeWatchedDirectoryConfig[]): Promise<void> {
    await mkdir(getKnowledgeDir(), { recursive: true });
    await writeJsonAtomic(WATCHED_DIR_CONFIG_PATH(), configs);
  }

  async function appendWatchedDirEvent(configId: string, event: Omit<KnowledgeWatchedDirectoryEvent, 'id' | 'timestamp'>): Promise<void> {
    const eventsDir = dirname(WATCHED_DIR_EVENTS_PATH(configId));
    await mkdir(eventsDir, { recursive: true });
    const line = JSON.stringify({ ...event, id: `we_${randomUUID()}`, timestamp: nowIso() }) + '\n';
    await appendFile(WATCHED_DIR_EVENTS_PATH(configId), line, 'utf8');
  }

  async function readWatchedDirEvents(configId: string): Promise<KnowledgeWatchedDirectoryEvent[]> {
    try {
      const content = await readFile(WATCHED_DIR_EVENTS_PATH(configId), 'utf8');
      return content.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    } catch {
      return [];
    }
  }

  function stopWatching(configId: string): void {
    const state = watchedStates.get(configId);
    if (!state) return;
    if (state.debounceTimer) clearTimeout(state.debounceTimer);
    if (state.watcher) {
      try { state.watcher.close(); } catch { /* ignore */ }
    }
    watchedStates.delete(configId);
  }

  function startWatching(config: KnowledgeWatchedDirectoryConfig): void {
    if (!config.enabled) return;
    
    // Close existing watcher for this config
    stopWatching(config.id);

    try {
      const watcher = fsWatch(config.path, { recursive: true }, (eventType, filename) => {
        if (!filename || !config.enabled) return;

        const filenameStr = filename.toString();
        const matchesPattern = config.patterns.some(p => {
          if (p === '**/*.md') return filenameStr.endsWith('.md');
          if (p.startsWith('**/')) return filenameStr.endsWith(p.slice(3));
          return filenameStr.includes(p);
        });
        if (!matchesPattern) return;

        // Debounce
        const state = watchedStates.get(config.id);
        if (state?.debounceTimer) clearTimeout(state.debounceTimer);
        
        const timer = setTimeout(async () => {
          try {
            if (eventType === 'rename') {
              const fullPath = join(config.path, filenameStr);
              try {
                await stat(fullPath);
                // File exists - automatic capture is always review-gated.
                if (config.ingestNewFiles) {
                  const content = await readFile(fullPath, 'utf8');
                  const inboxItem = createInboxItemObject({
                    kind: 'file',
                    title: basename(filenameStr),
                    description: `Auto-detected from watched directory: ${config.path}`,
                    sourcePath: fullPath,
                    body: content,
                    createdBy: 'system',
                    requiresReview: config.requiresReview,
                    metadata: { watchedConfigId: config.id },
                  });
                  const triagedInboxItem = withInboxTriage(inboxItem, await listInboxRecords());
                  await writeInboxItem(triagedInboxItem);
                  await appendAudit({
                    type: 'inbox_created',
                    inboxId: triagedInboxItem.id,
                    kind: triagedInboxItem.kind,
                    createdBy: 'system',
                    watchedConfigId: config.id,
                    rulesGuarded: isGovernedRulesPath(fullPath),
                  });

                  await appendWatchedDirEvent(config.id, {
                    configId: config.id,
                    event: 'ingested',
                    filePath: fullPath,
                    detail: 'added to inbox pending review; automatic direct wiki ingest is disabled',
                  });
                }
              } catch {
                // File deleted — just log
                await appendWatchedDirEvent(config.id, {
                  configId: config.id,
                  event: 'skipped',
                  filePath: fullPath,
                  detail: 'file deleted; no action taken',
                });
              }
            }
            
            // Auto compile is skipped because watched-directory changes do not
            // mutate formal wiki pages until explicit review applies them.
            if (config.autoCompile) {
              await appendWatchedDirEvent(config.id, {
                configId: config.id,
                event: 'skipped',
                filePath: filenameStr,
                detail: 'auto compile skipped until reviewed knowledge is applied',
              });
            }
          } catch (err) {
            await appendWatchedDirEvent(config.id, {
              configId: config.id,
              event: 'error',
              filePath: filenameStr,
              detail: err instanceof Error ? err.message : String(err),
            });
          }
        }, 5000); // 5 second debounce

        watchedStates.set(config.id, { configId: config.id, watcher: state?.watcher ?? null, debounceTimer: timer });
      });

      watchedStates.set(config.id, { configId: config.id, watcher, debounceTimer: null });
    } catch (err) {
      // watcher failed to start — log but don't crash
      console.error(`[knowledge-api] Failed to watch directory: ${config.path}`, err);
    }
  }

  // Initialize watchers for persisted configs on module load
  (async () => {
    try {
      const configs = await readWatchedDirConfigs();
      for (const config of configs) {
        if (config.enabled) startWatching(config);
      }
    } catch { /* ignore */ }
  })();
  const retrieveRuntimeLessonsForRoute = async (
    query: string,
    mode: 'manual' | 'suggest' | 'auto-read',
    reason: string,
  ): Promise<{
    candidates: KnowledgeRouteCandidate[];
    runtimeLessons: NonNullable<KnowledgeRouteContextResult['runtimeLessons']>;
  }> => {
    const sekb = await loadSekbRuntimeModule();
    if (!sekb || typeof sekb.RetrievalEngine !== 'function') {
      return {
        candidates: [],
        runtimeLessons: {
          requested: true,
          included: false,
          available: false,
          principleCount: 0,
          reason: 'runtimeUnavailable',
        },
      };
    }
    try {
      const store = createHostSekbStore(sekb);
      const engine = new sekb.RetrievalEngine({ store });
      const principles = engine.retrieve_for_task(query, 'chat', [], ROUTER_BUDGET.maxReferences);
      const candidates: KnowledgeRouteCandidate[] = principles.map((principle) => ({
        id: `sekb:${principle.principle_id}`,
        title: principle.title,
        lookup: `sekb:${principle.principle_id}`,
        corpus: 'all',
        attachKind: mode === 'auto-read' ? 'auto' : 'suggested',
        routingReason: reason,
        routeGroup: 'runtime_lessons',
        confidence: 0.72,
        snippet: [
          `Condition: ${principle.condition}`,
          `Action: ${principle.action}`,
          `Reason: ${principle.reason}`,
        ].join('\n').slice(0, ROUTER_BUDGET.maxSnippetChars),
        sourceKind: 'sekb-principle',
        runtimeLesson: {
          principleId: principle.principle_id,
          condition: principle.condition,
          action: principle.action,
          reason: principle.reason,
          retrievalCount: principle.retrieval_count,
        },
      }));
      return {
        candidates,
        runtimeLessons: {
          requested: true,
          included: candidates.length > 0,
          available: true,
          principleCount: candidates.length,
          ...(candidates.length === 0 ? { reason: 'noMatchingPrinciples' } : {}),
        },
      };
    } catch {
      return {
        candidates: [],
        runtimeLessons: {
          requested: true,
          included: false,
          available: false,
          principleCount: 0,
          reason: 'retrieveFailed',
        },
      };
    }
  };

  return {
    status: async () => {
      try {
        return { success: true, status: await rpc('wiki.status', {}, 12_000) };
      } catch (error) {
        return { success: false, error: sanitizeUiErrorText(error) };
      }
    },

    init: async () => {
      try {
        const result = await rpc<Record<string, unknown>>('wiki.init', {}, 30_000);
        return { success: true, ...result };
      } catch (error) {
        return { success: false, error: sanitizeUiErrorText(error) };
      }
    },

    configure: async (payload) => {
      try {
        const snapshot = await rpc<ConfigSnapshot>('config.get', {}, 12_000);
        const patch = buildMemoryWikiPatch(snapshot, payload);
        await rpc('config.patch', {
          raw: JSON.stringify(patch),
          ...(snapshot.hash ? { baseHash: snapshot.hash } : {}),
          note: 'Enable and configure Verse Claw Knowledge Hub memory-wiki defaults.',
        }, 30_000);
        return { success: true };
      } catch (error) {
        return { success: false, error: sanitizeUiErrorText(error) };
      }
    },

    ingestFiles: async (payload) => {
      const body: Record<string, unknown> = isRecord(payload) ? payload : {};
      const paths = Array.isArray(body.paths)
        ? body.paths.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        : [];
      const maxFiles = clampPositiveInt(body.maxFiles, DEFAULT_MAX_FILES, MAX_IMPORT_FILES);
      const maxBytes = clampPositiveInt(body.maxBytesPerFile, DEFAULT_MAX_BYTES_PER_FILE, MAX_IMPORT_BYTES_PER_FILE);
      const collected = await collectCandidates(paths, maxFiles, maxBytes);
      const items: KnowledgeIngestItemRecord[] = collected.errors.map((entry) => ({ inputPath: entry.inputPath, error: entry.error }));
      let imported = 0;

      for (const candidate of collected.candidates) {
        try {
          const result = await rpc<Record<string, unknown>>('wiki.ingest', {
            inputPath: candidate.inputPath,
            title: candidate.title,
          }, 120_000);
          imported += 1;
          items.push({
            inputPath: candidate.inputPath,
            sourcePath: getString(result.sourcePath),
            pageId: getString(result.pageId),
            pagePath: getString(result.pagePath),
            title: getString(result.title),
            bytes: typeof result.bytes === 'number' ? result.bytes : undefined,
            created: typeof result.created === 'boolean' ? result.created : undefined,
          });
        } catch (error) {
          items.push({
            inputPath: candidate.inputPath,
            error: sanitizeUiErrorText(error),
          });
        }
      }

      const failed = items.filter((item) => item.error).length;
      return {
        success: failed === 0,
        items,
        scanned: collected.scanned,
        imported,
        failed,
        truncated: collected.truncated,
        ...(failed > 0 ? { error: `${failed} import(s) failed` } : {}),
      };
    },

    validateOkfBundle: async (payload) => {
      const body: Record<string, unknown> = isRecord(payload) ? payload : {};
      const bundlePath = getString(body.path);
      const result = bundlePath
        ? await validateOkfBundleAtPath(bundlePath)
        : emptyOkfValidationResult('path is required');
      await appendAudit({
        type: 'okf_validated',
        bundlePath: result.bundlePath ?? bundlePath,
        success: result.success,
        concepts: result.summary.validConcepts,
        warnings: result.summary.warnings,
        errors: result.summary.errors,
      });
      return result;
    },

    importOkfBundle: async (payload) => {
      const body: Record<string, unknown> = isRecord(payload) ? payload : {};
      const inputPath = getString(body.path);
      if (!inputPath) {
        return { success: false, error: 'path is required', imported: 0, skipped: 0, failed: 1, items: [] };
      }

      const validation = await validateOkfBundleAtPath(inputPath);
      if (!validation.success) {
        await appendAudit({
          type: 'okf_import_blocked',
          bundlePath: validation.bundlePath,
          errors: validation.summary.errors,
        });
        return {
          success: false,
          error: validation.error ?? 'OKF validation failed',
          bundleId: validation.bundleId,
          bundlePath: validation.bundlePath,
          imported: 0,
          skipped: validation.concepts.length,
          failed: validation.errors.length,
          items: validation.errors.map((issue) => ({
            conceptId: issue.conceptId ?? issue.filePath ?? 'bundle',
            inputPath: issue.filePath ?? validation.bundlePath ?? inputPath,
            error: issue.message,
          })),
        };
      }

      const requestedConceptIds = normalizeStringList(body.conceptIds);
      const conceptById = new Map(validation.concepts.map((concept) => [concept.conceptId, concept]));
      const selectedConcepts = requestedConceptIds.length > 0
        ? requestedConceptIds.flatMap((conceptId) => {
          const concept = conceptById.get(conceptId);
          return concept ? [concept] : [];
        })
        : validation.concepts;
      const unknownItems: KnowledgeOkfImportItem[] = requestedConceptIds
        .filter((conceptId) => !conceptById.has(conceptId))
        .map((conceptId) => ({
          conceptId,
          inputPath: validation.bundlePath ?? inputPath,
          skipped: true,
          error: 'concept not found',
        }));
      const items: KnowledgeOkfImportItem[] = [...unknownItems];
      let imported = 0;

      for (const concept of selectedConcepts) {
        try {
          const title = okfImportTitle(concept);
          const result = await rpc<Record<string, unknown>>('wiki.ingest', {
            inputPath: concept.filePath,
            title,
          }, 120_000);
          imported += 1;
          items.push({
            conceptId: concept.conceptId,
            inputPath: concept.filePath,
            title,
            frontmatter: concept.frontmatter,
            warnings: concept.warnings,
            sourcePath: getString(result.sourcePath),
            pageId: getString(result.pageId),
            pagePath: getString(result.pagePath),
          });
        } catch (error) {
          items.push({
            conceptId: concept.conceptId,
            inputPath: concept.filePath,
            title: okfImportTitle(concept),
            frontmatter: concept.frontmatter,
            warnings: concept.warnings,
            error: sanitizeUiErrorText(error),
          });
        }
      }

      const failed = items.filter((item) => item.error).length;
      const skipped = requestedConceptIds.length > 0
        ? Math.max(0, validation.concepts.length - selectedConcepts.length)
        : 0;
      const bundleId = validation.bundleId ?? createOkfBundleId(validation.bundlePath ?? inputPath);
      const mappingPath = getOkfBundleMappingPath(bundleId);
      await ensureKnowledgeDirs();
      await writeJsonFile(mappingPath, {
        bundleId,
        bundlePath: validation.bundlePath,
        okfVersion: validation.okfVersion,
        importedAt: nowIso(),
        selectedConceptIds: requestedConceptIds,
        summary: validation.summary,
        typeDistribution: validation.typeDistribution,
        items,
      });
      await appendAudit({
        type: 'okf_imported',
        bundleId,
        bundlePath: validation.bundlePath,
        imported,
        skipped,
        failed,
      });

      return {
        success: failed === 0,
        ...(failed > 0 ? { error: `${failed} OKF import(s) failed` } : {}),
        bundleId,
        bundlePath: validation.bundlePath,
        imported,
        skipped,
        failed,
        items,
        mappingPath,
      };
    },

    search: async (payload) => {
      try {
        const body: Record<string, unknown> = isRecord(payload) ? payload : {};
        const query = getString(body.query);
        if (!query) return { success: false, error: 'query is required', results: [] };
        const roleTag = typeof body.roleTag === 'string' ? body.roleTag.trim() : undefined;
        const corpus = body.corpus === 'memory' || body.corpus === 'all' || body.corpus === 'wiki' ? body.corpus : 'wiki';
        const mode = typeof body.mode === 'string' && body.mode ? body.mode : 'keyword';
        const result = await rpc<Record<string, unknown>>('wiki.search', {
          query,
          maxResults: clampPositiveInt(body.maxResults, 10, 50),
          corpus,
          ...(mode !== 'keyword' ? { mode } : {}),
        }, 30_000);
        const rows = getRouteSearchRows(result);
        // Area 5 §3.4 — best-effort ranking shaping. Compiled wiki pages may
        // carry `roleTags` forward from their source drafts; when present and
        // a roleTag filter was requested, results matching the tag rank first.
        // Results without roleTags metadata remain visible (ranking-only).
        if (roleTag && Array.isArray(result.results)) {
          const ranked = rankByRoleTag(
            (result.results as Array<Record<string, unknown>>).map((entry) => ({
              ...entry,
              roleTags: Array.isArray((entry as { roleTags?: unknown }).roleTags)
                ? ((entry as { roleTags: unknown[] }).roleTags as string[])
                : undefined,
            })),
            roleTag,
          );
          return {
            success: true,
            ...result,
            results: ranked,
            retrievalDiagnostics: buildRetrievalDiagnostics({
              query,
              corpus,
              mode,
              rows: ranked,
              reason: 'keyword fallback via wiki.search with role-tag ranking',
            }),
          };
        }
        return {
          success: true,
          ...result,
          retrievalDiagnostics: buildRetrievalDiagnostics({
            query,
            corpus,
            mode,
            rows,
            reason: 'keyword fallback via wiki.search',
          }),
        };
      } catch (error) {
        return { success: false, error: sanitizeUiErrorText(error), results: [] };
      }
    },

    get: async (payload) => {
      try {
        const body: Record<string, unknown> = isRecord(payload) ? payload : {};
        const lookup = getString(body.lookup);
        if (!lookup) return { success: false, error: 'lookup is required' };
        const result = await rpc<Record<string, unknown>>('wiki.get', {
          lookup,
          ...(typeof body.fromLine === 'number' ? { fromLine: body.fromLine } : {}),
          ...(typeof body.lineCount === 'number' ? { lineCount: body.lineCount } : {}),
          ...(body.corpus === 'memory' || body.corpus === 'all' || body.corpus === 'wiki' ? { corpus: body.corpus } : {}),
        }, 30_000);
        return { success: true, ...result };
      } catch (error) {
        return { success: false, error: sanitizeUiErrorText(error) };
      }
    },

    compile: async () => {
      try {
        return { success: true, ...(await rpc<Record<string, unknown>>('wiki.compile', {}, 120_000)) };
      } catch (error) {
        return { success: false, error: sanitizeUiErrorText(error) };
      }
    },

    lint: async () => {
      try {
        return { success: true, ...(await rpc<Record<string, unknown>>('wiki.lint', {}, 120_000)) };
      } catch (error) {
        return { success: false, error: sanitizeUiErrorText(error) };
      }
    },

    applyDraft: async (payload) => {
      try {
        const body: Record<string, unknown> = isRecord(payload) ? payload : {};
        const title = getString(body.title);
        const draftBody = getString(body.body);
        const sourceIds = Array.isArray(body.sourceIds)
          ? body.sourceIds.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
          : [];
        if (!title || !draftBody || sourceIds.length === 0) {
          return { success: false, error: 'title, body, and sourceIds are required' };
        }
        const draft = createDraftFromPayload({
          title,
          body: draftBody,
          type: 'synthesis',
          sourceIds,
          createdBy: 'user',
          ...(typeof body.confidence === 'number' ? { confidence: body.confidence } : {}),
          metadata: {
            reviewGate: 'applyDraft',
            directApplyDisabled: true,
            ...(Array.isArray(body.claims) ? { claims: body.claims } : {}),
            ...(Array.isArray(body.contradictions) ? { contradictions: body.contradictions } : {}),
            ...(Array.isArray(body.questions) ? { questions: body.questions } : {}),
            ...(typeof body.status === 'string' ? { requestedStatus: body.status } : {}),
          },
        });
        if (!draft) return { success: false, error: 'title and body are required' };
        const proposal = createProposalForDraft(
          draft,
          'Legacy applyDraft request converted to a review-gated proposal; explicit review is required before durable wiki apply.',
        );
        await writeDraft(draft);
        await writeProposal(proposal);
        await appendAudit({
          type: 'apply_draft_review_gated',
          draftId: draft.id,
          proposalId: proposal.id,
          sourceIds,
        });
        return {
          success: true,
          changed: false,
          operation: 'review_required',
          reviewRequired: true,
          draft,
          proposal,
        };
      } catch (error) {
        return { success: false, error: sanitizeUiErrorText(error) };
      }
    },

    openVault: async () => {
      try {
        const status = await rpc<Record<string, unknown>>('wiki.status', {}, 12_000);
        const vaultPath = getString(status.vaultPath);
        if (!vaultPath) return { success: false, error: 'Vault path unavailable' };
        const error = await shell.openPath(vaultPath);
        return error ? { success: false, error, path: vaultPath } : { success: true, path: vaultPath };
      } catch (error) {
        return { success: false, error: sanitizeUiErrorText(error) };
      }
    },

    createInboxItem: async (payload) => withGovernanceWriteLock(async () => {
      const item = createInboxItemFromPayload(payload);
      if (!item) return { success: false, error: 'title and body are required' };
      // KS-01: captureKey dedupe check and insert stay in the same critical
      // section; concurrent calls with the same key can only create one record.
      const captureKey = knowledgeCaptureKey(item.metadata);
      if (captureKey) {
        const existing = await findInboxItemByCaptureKey(captureKey);
        if (existing) return { success: true, item: withInboxTriage(existing, await listInboxRecords()) };
      }
      const triagedItem = withInboxTriage(item, await listInboxRecords());
      await writeInboxItem(triagedItem);
      await appendAudit({ type: 'inbox_created', inboxId: triagedItem.id, kind: triagedItem.kind, createdBy: triagedItem.createdBy });
      return { success: true, item: triagedItem };
    }),

    listInboxItems: async (payload) => {
      const body: Record<string, unknown> = isRecord(payload) ? payload : {};
      const status = typeof body.status === 'string' ? body.status : 'pending';
      const kind = typeof body.kind === 'string' ? body.kind : 'all';
      const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : null;
      const limit = clampPositiveInt(body.limit, 50, 200);
      const records = await listInboxRecords();
      const triagedRecords = records.map((item) => withInboxTriage(item, records));
      await Promise.all(triagedRecords.map((item, index) => {
        const previous = records[index];
        const previousTriage = isRecord(previous.metadata) ? previous.metadata.triage : undefined;
        const nextTriage = isRecord(item.metadata) ? item.metadata.triage : undefined;
        return sameTriage(previousTriage, nextTriage) ? Promise.resolve() : writeInboxItem(item);
      })).catch(() => {
        // Triage persistence is best-effort; list still returns computed metadata.
      });
      const items = sortInboxByTriagePriority(triagedRecords)
        .filter((item) => status === 'all' || item.status === normalizeInboxStatus(status))
        .filter((item) => kind === 'all' || item.kind === normalizeInboxKind(kind))
        .filter((item) => !workspaceId || item.workspaceId === workspaceId)
        .slice(0, limit);
      return { success: true, items };
    },

    updateInboxItem: async (payload) => {
      const body: Record<string, unknown> = isRecord(payload) ? payload : {};
      const id = getString(body.id);
      const item = id ? await readInboxItem(id) : null;
      if (!item) return { success: false, error: 'inbox item not found' };
      if (item.status !== 'pending') return { success: false, error: 'only pending inbox items can be edited' };
      const sourceRefs = Array.isArray(body.sourceRefs) ? normalizeSourceRefs(body.sourceRefs) : item.sourceRefs;
      const sourceIds = Array.isArray(body.sourceIds)
        ? Array.from(new Set([...normalizeStringList(body.sourceIds), ...sourceRefs.map((ref) => ref.id)]))
        : item.sourceIds;
      // Area 5 §3.4 — roleTags update. Explicit array (even empty) replaces;
      // absent payload field preserves existing. Empty array drops the field.
      const roleTagsUpdate = Array.isArray(body.roleTags)
        ? normalizeStringList(body.roleTags)
        : undefined;
      const updatedBase: KnowledgeInboxItem = {
        ...item,
        ...(getString(body.title) ? { title: getString(body.title)! } : {}),
        ...(getString(body.body) ? { body: getString(body.body)! } : {}),
        ...(typeof body.kind === 'string' && KNOWLEDGE_INBOX_KINDS.has(body.kind as KnowledgeInboxKind) ? { kind: body.kind as KnowledgeInboxKind } : {}),
        ...(typeof body.type === 'string' && KNOWLEDGE_DRAFT_TYPES.has(body.type as KnowledgeDraftType) ? { type: body.type as KnowledgeDraftType } : {}),
        ...(Array.isArray(body.tags) ? { tags: normalizeStringList(body.tags) } : {}),
        ...(Array.isArray(body.warnings) ? { warnings: normalizeStringList(body.warnings) } : {}),
        ...(isRecord(body.metadata) ? { metadata: body.metadata } : {}),
        sourceRefs,
        sourceIds,
        workspaceId: typeof body.workspaceId === 'string' ? body.workspaceId : item.workspaceId,
        agentId: typeof body.agentId === 'string' ? body.agentId : item.agentId,
        ...(roleTagsUpdate !== undefined && roleTagsUpdate.length > 0 ? { roleTags: roleTagsUpdate } : {}),
        updatedAt: nowIso(),
      };
      const updated = withInboxTriage(updatedBase, (await listInboxRecords()).filter((candidate) => candidate.id !== item.id));
      if (roleTagsUpdate !== undefined && roleTagsUpdate.length === 0) {
        delete (updated as { roleTags?: string[] }).roleTags;
      }
      await writeInboxItem(updated);
      await appendAudit({ type: 'inbox_updated', inboxId: updated.id });
      return { success: true, item: updated };
    },

    dismissInboxItem: async (payload) => {
      const id = isRecord(payload) ? getString(payload.id) : undefined;
      const item = id ? await readInboxItem(id) : null;
      if (!item) return { success: false, error: 'inbox item not found' };
      if (item.status !== 'pending') return { success: false, error: 'only pending inbox items can be dismissed' };
      const timestamp = nowIso();
      const dismissed: KnowledgeInboxItem = { ...item, status: 'dismissed', dismissedAt: timestamp, updatedAt: timestamp };
      await writeInboxItem(dismissed);
      await appendAudit({ type: 'inbox_dismissed', inboxId: dismissed.id });
      return { success: true, item: dismissed };
    },

    promoteInboxItemToDraft: async (payload) => {
      const id = isRecord(payload) ? getString(payload.id) : undefined;
      const item = id ? await readInboxItem(id) : null;
      if (!item) return { success: false, error: 'inbox item not found' };
      if (item.status !== 'pending') return { success: false, error: 'only pending inbox items can be promoted' };
      const draft = draftFromInboxItem(item);
      const proposal = createProposalForDraft(draft, 'Knowledge Inbox item promoted to an editable draft for explicit review and apply.');
      const timestamp = nowIso();
      const promoted: KnowledgeInboxItem = {
        ...item,
        status: 'promoted',
        promotedAt: timestamp,
        promotedDraftId: draft.id,
        promotedProposalId: proposal.id,
        updatedAt: timestamp,
      };
      await writeDraft(draft);
      await writeProposal(proposal);
      await writeInboxItem(promoted);
      await writeProvenance({
        id: provenanceRecordId('draft', draft.id),
        targetId: draft.id,
        targetKind: 'draft',
        title: draft.title,
        sourceRefs: draft.sourceRefs,
        references: [{
          id: `kr_${randomUUID()}`,
          kind: 'manual',
          timestamp,
          note: `Promoted from Knowledge Inbox item ${item.id}`,
        }],
        metadata: {
          inboxId: item.id,
          inboxKind: item.kind,
        },
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      await appendAudit({ type: 'inbox_promoted', inboxId: promoted.id, draftId: draft.id, proposalId: proposal.id });
      return { success: true, item: promoted, draft, proposal };
    },

    createDraft: async (payload) => {
      const draft = createDraftFromPayload(payload);
      if (!draft) return { success: false, error: 'title and body are required' };
      await writeDraft(draft);
      await appendAudit({ type: 'draft_created', draftId: draft.id, createdBy: draft.createdBy });
      return { success: true, draft };
    },

    listSourceSets: async () => {
      const sourceSets = await listSourceSetRecords();
      return { success: true, sourceSets };
    },

    saveSourceSet: async (payload) => {
      const sourceSet = await normalizeSourceSetPayload(payload);
      if (!sourceSet) return { success: false, error: 'title is required' };
      await writeSourceSet(sourceSet);
      await appendAudit({ type: 'source_set_saved', sourceSetId: sourceSet.id, sourceCount: sourceSet.sourceRefs.length });
      return { success: true, sourceSet };
    },

    deleteSourceSet: async (payload) => {
      const body: Record<string, unknown> = isRecord(payload) ? payload : {};
      const id = getString(body.id);
      if (!id) return { success: false, error: 'id is required' };
      try {
        await unlink(getSourceSetPath(id));
        await appendAudit({ type: 'source_set_deleted', sourceSetId: id });
        return { success: true };
      } catch {
        return { success: false, error: 'source set not found' };
      }
    },

    answerFromSourceSet: async (payload) => {
      const body: Record<string, unknown> = isRecord(payload) ? payload : {};
      const question = getString(body.question);
      if (!question) {
        return {
          success: false,
          error: 'question is required',
          question: '',
          answer: '',
          sources: [],
          unknowns: ['Question is required.'],
          suggestedNextActions: ['Ask a question about the selected sources.'],
          groundingStatus: 'missing_sources',
          confidence: 0,
          retrievalDiagnostics: buildRetrievalDiagnostics({
            query: '',
            corpus: 'wiki',
            mode: 'source-set',
            rows: [],
            reason: 'missing question',
          }),
        };
      }
      return buildAnswerFromSourceSet({
        question,
        sourceRefs: normalizeSourceRefs(body.sourceRefs),
        artifactType: normalizeArtifactType(body.artifactType),
        sourceSetId: getString(body.sourceSetId),
        semantic: body.semantic === true,
      });
    },

    createArtifactDraft: async (payload: KnowledgeCreateArtifactDraftPayload) => {
      const body: Record<string, unknown> = isRecord(payload) ? payload : {};
      const artifactType = normalizeArtifactType(body.artifactType);
      const sourceRefs = normalizeSourceRefs(body.sourceRefs);
      const title = getString(body.title) ?? defaultArtifactTitle(artifactType);
      const question = getString(body.question) ?? `Create a ${artifactType} from the selected sources.`;
      const answer = await buildAnswerFromSourceSet({
        question,
        sourceRefs,
        artifactType,
        sourceSetId: getString(body.sourceSetId),
        semantic: body.semantic === true,
      });
      const draft = createDraftFromPayload({
        title,
        body: artifactDraftBody(answer, artifactType),
        type: draftTypeForArtifact(artifactType),
        sourceIds: sourceIdsFromRefs(sourceRefs),
        sourceRefs,
        tags: ['studio-artifact', artifactType],
        createdBy: 'agent',
        confidence: answer.confidence,
        metadata: {
          knowledgeKind: 'studio-artifact',
          artifactType,
          groundingStatus: answer.groundingStatus,
          retrievalDiagnostics: answer.retrievalDiagnostics,
          ...(isRecord(body.metadata) ? body.metadata : {}),
        },
      });
      if (!draft) return { success: false, error: 'artifact draft could not be created' };
      await writeDraft(draft);
      await appendAudit({
        type: 'studio_artifact_draft_created',
        draftId: draft.id,
        artifactType,
        groundingStatus: answer.groundingStatus,
      });
      return { success: true, draft };
    },

    listDrafts: async (payload) => {
      const body: Record<string, unknown> = isRecord(payload) ? payload : {};
      const status = typeof body.status === 'string' ? body.status : 'all';
      const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : null;
      const limit = clampPositiveInt(body.limit, 50, 200);
      const roleTag = typeof body.roleTag === 'string' ? body.roleTag.trim() : undefined;
      const drafts = rankByRoleTag(
        (await listDraftRecords())
          .filter((draft) => status === 'all' || draft.status === status)
          .filter((draft) => !workspaceId || draft.workspaceId === workspaceId),
        roleTag,
      ).slice(0, limit);
      return { success: true, drafts };
    },

    getDraft: async (payload) => {
      const id = isRecord(payload) ? getString(payload.id) : undefined;
      const draft = id ? await readDraft(id) : null;
      return draft ? { success: true, draft } : { success: false, error: 'draft not found' };
    },

    updateDraft: async (payload) => withGovernanceWriteLock(async () => {
      const body: Record<string, unknown> = isRecord(payload) ? payload : {};
      const id = getString(body.id);
      const draft = id ? await readDraft(id) : null;
      if (!draft) return { success: false, error: 'draft not found' };
      if (draft.status === 'applied') return { success: false, error: 'applied drafts cannot be edited' };
      const roleTagsUpdate = Array.isArray(body.roleTags)
        ? normalizeStringList(body.roleTags)
        : undefined;
      const nextRevision = Math.max(1, (draft.revision ?? 1) + 1);
      const updated: KnowledgeDraft = {
        ...draft,
        ...(getString(body.title) ? { title: getString(body.title)! } : {}),
        ...(getString(body.body) ? { body: getString(body.body)! } : {}),
        ...(typeof body.type === 'string' && KNOWLEDGE_DRAFT_TYPES.has(body.type as KnowledgeDraftType) ? { type: body.type as KnowledgeDraftType } : {}),
        ...(Array.isArray(body.sourceIds) ? { sourceIds: normalizeStringList(body.sourceIds) } : {}),
        ...(Array.isArray(body.sourceRefs) ? { sourceRefs: normalizeSourceRefs(body.sourceRefs) } : {}),
        ...(Array.isArray(body.tags) ? { tags: normalizeStringList(body.tags) } : {}),
        ...(normalizeConfidence(body.confidence) != null ? { confidence: normalizeConfidence(body.confidence) } : {}),
        ...(isRecord(body.metadata) ? { metadata: body.metadata } : {}),
        workspaceId: typeof body.workspaceId === 'string' ? body.workspaceId : draft.workspaceId,
        agentId: typeof body.agentId === 'string' ? body.agentId : draft.agentId,
        ...(roleTagsUpdate !== undefined
          ? (roleTagsUpdate.length > 0 ? { roleTags: roleTagsUpdate } : { roleTags: undefined })
          : {}),
        status: draft.status === 'approved' ? 'draft' : draft.status,
        revision: nextRevision,
        updatedAt: nowIso(),
      };
      if (roleTagsUpdate !== undefined && roleTagsUpdate.length === 0) {
        delete (updated as { roleTags?: string[] }).roleTags;
      }
      updated.contentDigest = draftDigest(updated);
      await writeDraft(updated);
      await appendAudit({ type: 'draft_updated', draftId: updated.id, revision: updated.revision });
      return { success: true, draft: updated };
    }),

    reviewDraft: async (payload) => withGovernanceWriteLock(async () => {
      const body: Record<string, unknown> = isRecord(payload) ? payload : {};
      const id = getString(body.id);
      const draft = id ? await readDraft(id) : null;
      if (!draft) return { success: false, error: 'draft not found' };
      if (draft.status === 'applied') return { success: false, error: 'applied drafts cannot be reviewed' };
      const action = body.action;
      const nextStatus: KnowledgeDraftStatus | null = action === 'approve'
        ? 'approved'
        : action === 'reject'
          ? 'rejected'
          : action === 'request_changes'
            ? 'steward_reviewed'
            : null;
      if (!nextStatus) return { success: false, error: 'invalid review action' };
      const nextRevision = Math.max(1, (draft.revision ?? 1) + 1);
      const updated: KnowledgeDraft = {
        ...draft,
        status: nextStatus,
        stewardNotes: getString(body.stewardNotes) ?? draft.stewardNotes,
        warnings: Array.isArray(body.warnings) ? normalizeStringList(body.warnings) : draft.warnings,
        revision: nextRevision,
        reviewedAt: nowIso(),
        updatedAt: nowIso(),
        contentDigest: draftDigest(draft),
      };
      if (nextStatus === 'approved') {
        updated.reviewedDigest = draftDigest(updated);
      }
      await writeDraft(updated);
      if (nextStatus === 'approved') {
        const proposals = await listProposalRecords();
        for (const proposal of proposals.filter((candidate) => candidate.draftId === updated.id && candidate.status === 'proposed')) {
          const approved: KnowledgeChangeProposal = {
            ...proposal,
            status: 'approved',
            reviewedDigest: draftDigest(updated),
            // create uses the draft revision; lifecycle operations keep the
            // target wiki page revision captured by proposeChange.
            expectedRevision: proposal.operation === 'create' ? updated.revision : proposal.expectedRevision,
            workspaceId: updated.workspaceId,
            updatedAt: nowIso(),
          };
          await writeProposal(approved);
        }
      }
      await appendAudit({ type: 'draft_reviewed', draftId: updated.id, action, revision: updated.revision });
      return { success: true, draft: updated };
    }),

    proposeChange: async (payload) => withGovernanceWriteLock(async () => {
      const body: Record<string, unknown> = isRecord(payload) ? payload : {};
      const operation = typeof body.operation === 'string' && KNOWLEDGE_CHANGE_OPERATIONS.has(body.operation as KnowledgeChangeOperation)
        ? body.operation as KnowledgeChangeOperation
        : null;
      const reason = getString(body.reason);
      if (!operation || !reason) return { success: false, error: 'operation and reason are required' };
      const targetPageIds = normalizeStringList(body.targetPageIds);
      if (operation !== 'create' && targetPageIds.length === 0) {
        return { success: false, error: 'targetPageIds are required for this operation' };
      }
      if (['update', 'merge'].includes(operation) && !getString(body.diff)) {
        return { success: false, error: 'diff is required for update or merge proposals' };
      }
      const draftId = getString(body.draftId);
      const draft = draftId ? await readDraft(draftId) : null;
      if (draftId && !draft) return { success: false, error: 'draft not found' };
      let expectedWikiRevision: number | undefined;
      if (operation !== 'create') {
        const targetLookup = targetPageIds[0]!;
        try {
          const wikiPage = await rpc<Record<string, unknown>>('wiki.get', {
            lookup: targetLookup,
            lineCount: 1,
            corpus: 'wiki',
          }, 10_000);
          const revision = wikiPage?.revision;
          if (typeof revision === 'number' && Number.isInteger(revision) && revision > 0) {
            expectedWikiRevision = revision;
          } else if (!wikiPage) {
            return { success: false, error: `target wiki page not found: ${targetLookup}` };
          } else {
            expectedWikiRevision = 1;
          }
        } catch (error) {
          return { success: false, error: sanitizeUiErrorText(error) };
        }
      }
      const timestamp = nowIso();
      const base: KnowledgeChangeProposal = {
        id: `kp_${randomUUID()}`,
        operation,
        status: 'proposed',
        ...(targetPageIds.length > 0 ? { targetPageIds } : {}),
        ...(draftId ? { draftId } : {}),
        ...(getString(body.diff) ? { diff: getString(body.diff) } : {}),
        reason,
        sources: normalizeSourceRefs(body.sources),
        requiresUserConfirmation: true,
        ...(draft ? { workspaceId: draft.workspaceId, contentDigest: draftDigest(draft) } : {}),
        ...(expectedWikiRevision !== undefined ? { expectedRevision: expectedWikiRevision } : {}),
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      const proposal: KnowledgeChangeProposal = {
        ...base,
        revision: 1,
        ...(getString(body.idempotencyKey) ?? (draft ? proposalIdempotencyKey(base, draft) : undefined)
          ? { idempotencyKey: getString(body.idempotencyKey) ?? proposalIdempotencyKey(base, draft!) }
          : {}),
      };
      if (proposal.idempotencyKey) {
        const existing = (await listProposalRecords()).find((candidate) => candidate.idempotencyKey === proposal.idempotencyKey);
        if (existing) {
          if (existing.contentDigest === proposal.contentDigest) return { success: true, proposal: existing };
          return { success: false, error: 'idempotency conflict: same key with different digest', proposal: existing };
        }
      }
      await writeProposal(proposal);
      await appendAudit({ type: 'proposal_created', proposalId: proposal.id, operation });
      return { success: true, proposal };
    }),

    listProposals: async (payload) => {
      const body: Record<string, unknown> = isRecord(payload) ? payload : {};
      const status = typeof body.status === 'string' ? body.status : 'all';
      const limit = clampPositiveInt(body.limit, 50, 200);
      const proposals = (await listProposalRecords())
        .filter((proposal) => status === 'all' || proposal.status === status)
        .slice(0, limit);
      return { success: true, proposals };
    },

    listReviewBundles: async (payload) => {
      const body: Record<string, unknown> = isRecord(payload) ? payload : {};
      const status = typeof body.status === 'string' ? body.status : 'all';
      const limit = clampPositiveInt(body.limit, 50, 200);
      const bundles = (await listReviewBundleRecords())
        .filter((bundle) => status === 'all' || bundle.status === status)
        .slice(0, limit);
      return { success: true, bundles };
    },

    previewChange: async (payload) => {
      const id = isRecord(payload) ? getString(payload.id) : undefined;
      const proposal = id ? await readProposal(id) : null;
      if (!proposal) return { success: false, error: 'proposal not found' };
      const draft = proposal.draftId ? await readDraft(proposal.draftId) : null;
      const preview = proposal.diff ?? draft?.body ?? proposal.reason;
      return { success: true, proposal, ...(draft ? { draft } : {}), preview };
    },

    applyReviewedChange: async (payload) => withGovernanceWriteLock(async () => {
      const body: Record<string, unknown> = isRecord(payload) ? payload : {};
      const bundleId = getString(body.reviewBundleId) ?? getString(body.id);
      const bundle = bundleId ? await readReviewBundle(bundleId) : null;
      const legacyProposal = !bundle && getString(body.id) ? await readProposal(getString(body.id)!) : null;
      const resolvedBundle = bundle
        ?? (legacyProposal?.draftId
          ? (await listReviewBundleRecords()).find((candidate) => candidate.proposalId === legacyProposal.id)
          : undefined);
      if (!resolvedBundle?.proposal || !resolvedBundle.draft) {
        return { success: false, error: 'review bundle not found' };
      }
      const proposal = resolvedBundle.proposal;
      const draft = resolvedBundle.draft;
      if (proposal.draftId !== draft.id) {
        return applyConflict('draft_proposal_mismatch', 'proposal.draftId does not match the selected draft', resolvedBundle);
      }
      const currentDigest = draftDigest(draft);
      const idempotencyKey = proposalIdempotencyKey(proposal, draft);
      const operationId = operationJournalId(proposal, draft);
      const journal = await readOperationJournal(operationId);
      if (proposal.status === 'applied') {
        if (proposal.contentDigest !== currentDigest) {
          return { success: false, error: 'idempotency conflict: applied proposal digest differs', proposal, draft, reviewBundle: resolvedBundle };
        }
        const existingReceipt = journal ? receiptFromOperationJournal(journal, proposal, draft) : undefined;
        return {
          success: true,
          changed: false,
          operation: 'duplicate',
          proposal,
          draft,
          reviewBundle: resolvedBundle,
          ...(existingReceipt ? { receipt: existingReceipt, compensation: existingReceipt.compensation } : {}),
        };
      }
      if (proposal.status !== 'approved') {
        return applyConflict('not_approved', 'proposal must be approved by the user before apply', resolvedBundle);
      }
      if (getString(proposal.reviewedDigest) && proposal.reviewedDigest !== currentDigest) {
        return applyConflict('stale_digest', 'draft content changed after review approval', resolvedBundle);
      }
      if (draft.status !== 'approved') {
        return applyConflict('draft_not_approved', 'approved draft is required before apply', resolvedBundle);
      }
      if (getString(proposal.workspaceId) !== undefined && proposal.workspaceId !== draft.workspaceId) {
        return applyConflict('workspace_mismatch', 'draft workspace changed after review approval', resolvedBundle);
      }

      let targetWikiRevision: number | undefined;
      if (proposal.operation === 'create') {
        if (typeof proposal.expectedRevision === 'number' && proposal.expectedRevision !== draft.revision) {
          return applyConflict('stale_revision', 'draft revision changed after review approval', resolvedBundle, draft.revision);
        }
        if (draft.sourceIds.length === 0) {
          return { success: false, error: 'draft sourceIds are required before apply', proposal, draft };
        }
      } else {
        const targetLookup = proposal.targetPageIds?.[0];
        if (!targetLookup) {
          return applyConflict('target_not_found', 'lifecycle proposal has no target wiki page', resolvedBundle);
        }
        let currentWikiPage: Record<string, unknown> | null;
        try {
          currentWikiPage = await rpc<Record<string, unknown>>('wiki.get', {
            lookup: targetLookup,
            lineCount: 1,
            corpus: 'wiki',
          }, 10_000) as Record<string, unknown> | null;
        } catch {
          currentWikiPage = null;
        }
        if (!currentWikiPage) {
          return applyConflict('target_not_found', `target wiki page not found: ${targetLookup}`, resolvedBundle);
        }
        targetWikiRevision = typeof currentWikiPage.revision === 'number' && currentWikiPage.revision > 0
          ? currentWikiPage.revision
          : 1;
        if (typeof proposal.expectedRevision === 'number' && proposal.expectedRevision !== targetWikiRevision) {
          return applyConflict('stale_revision', 'target wiki page revision changed after review approval', resolvedBundle, targetWikiRevision);
        }
      }

      const subjectId = proposal.operation === 'create'
        ? draft.sourceIds[0] ?? draft.title
        : proposal.targetPageIds?.[0] ?? draft.title;
      const subjectRevision = proposal.operation === 'create'
        ? String(draft.revision)
        : String(targetWikiRevision);
      const baseEntry: GovernanceOperationJournalEntry = journal ?? {
        schema: 'knowledge-governance-operation.v1',
        operationId,
        kind: 'review_apply',
        proposalId: proposal.id,
        draftId: draft.id,
        idempotencyKey,
        state: 'intent',
        contentDigest: currentDigest,
        operation: proposal.operation,
        owner: 'memory-wiki',
        subjectId,
        ...(subjectRevision ? { subjectRevision } : {}),
        receiptId: `kgr_${operationId}`,
        ...(getString(proposal.reviewedDigest) ? { reviewedDigest: getString(proposal.reviewedDigest) } : {}),
        ...(typeof proposal.expectedRevision === 'number' ? { expectedRevision: proposal.expectedRevision } : {}),
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      if (!journal) {
        await writeOperationJournal(baseEntry);
      }

      let wikiResult: Record<string, unknown>;
      if (journal?.state === 'wiki_committed' || journal?.state === 'json_committed') {
        wikiResult = {};
      } else {
        try {
          if (proposal.operation === 'create') {
            wikiResult = await rpc<Record<string, unknown>>('wiki.apply', {
              op: 'create_synthesis',
              title: draft.title,
              body: draft.body,
              sourceIds: draft.sourceIds,
              ...(typeof draft.confidence === 'number' ? { confidence: draft.confidence } : {}),
              status: 'draft',
            }, 120_000);
          } else {
            wikiResult = await rpc<Record<string, unknown>>(
              KNOWLEDGE_LIFECYCLE_WIKI_RPC[proposal.operation],
              wikiLifecycleRpcPayload({
                operation: proposal.operation,
                draft,
                proposal,
                idempotencyKey,
              }),
              120_000,
            );
          }
          await writeOperationJournal({
            ...baseEntry,
            state: 'wiki_committed',
            updatedAt: nowIso(),
            ...(typeof wikiResult.revision === 'number' ? { subjectRevision: String(wikiResult.revision) } : {}),
          });
        } catch (error) {
          await writeOperationJournal({
            ...baseEntry,
            state: 'failed',
            updatedAt: nowIso(),
            error: sanitizeUiErrorText(error),
            compensation: compensationForOperation(proposal.operation),
          }).catch(() => undefined);
          return {
            success: false,
            proposal,
            draft,
            reviewBundle: resolvedBundle,
            error: sanitizeUiErrorText(error),
            compensation: compensationForOperation(proposal.operation),
          };
        }
      }

      const timestamp = nowIso();
      const appliedDraft: KnowledgeDraft = {
        ...draft,
        status: 'applied',
        appliedAt: timestamp,
        updatedAt: timestamp,
        revision: (draft.revision ?? 1) + 1,
      };
      const appliedProposal: KnowledgeChangeProposal = {
        ...proposal,
        status: 'applied',
        appliedAt: timestamp,
        updatedAt: timestamp,
        idempotencyKey,
      };
      const finalEntry: GovernanceOperationJournalEntry = {
        ...baseEntry,
        state: 'json_committed',
        updatedAt: nowIso(),
        compensation: compensationForOperation(proposal.operation),
        ...(typeof wikiResult.revision === 'number' ? { subjectRevision: String(wikiResult.revision) } : {}),
      };
      await writeDraft(appliedDraft);
      await writeProposal(appliedProposal);
      await writeOperationJournal(finalEntry);
      await appendAudit({
        type: 'reviewed_change_applied',
        proposalId: proposal.id,
        draftId: draft.id,
        operation: proposal.operation,
        operationId,
      });
      const receipt = receiptFromOperationJournal(finalEntry, appliedProposal, appliedDraft);
      return {
        success: true,
        changed: true,
        proposal: appliedProposal,
        draft: appliedDraft,
        reviewBundle: buildReviewBundle(appliedProposal, appliedDraft),
        ...(receipt ? { receipt, compensation: receipt.compensation } : {}),
        ...wikiResult,
      };
    }),

    stewardReview: async (payload) => {
      const body: Record<string, unknown> = isRecord(payload) ? payload : {};
      const draft = getString(body.draftId) ? await readDraft(getString(body.draftId)!) : null;

      // Area 5 §3.1: resolve the active KB role player from the registry
      // instead of returning the hardcoded constant. Missing/corrupt registry
      // → DEFAULT_REGISTRY → byte-identical to today's DEFAULT_STEWARD_CONFIG.
      const activeRole = await resolveStewardRole(getString(body.roleId));

      // Pass 1: heuristic (instant, offline-safe, always runs)
      let review = stewardReviewDraft({
        title: draft?.title ?? getString(body.title),
        body: draft?.body ?? getString(body.body),
        sourceIds: draft?.sourceIds ?? normalizeStringList(body.sourceIds),
        tags: draft?.tags ?? normalizeStringList(body.tags),
      });

      // Area 5 §3.2: semantic pass (opt-in, default-off). Only runs when the
      // active role has classification: 'semantic' AND an LLM invoker is
      // registered. Failure/timeout → heuristic result stands, notes record
      // "semantic pass unavailable".
      if (activeRole.classification === 'semantic') {
        const invoker = getSemanticStewardInvoker();
        if (invoker) {
          try {
            // Gather top-5 wiki search results for context (best-effort).
            let searchResults: Array<{ title: string; snippet: string; pagePath?: string }> = [];
            try {
              const searchResponse = await rpc<Record<string, unknown>>('wiki.search', {
                query: draft?.title ?? getString(body.title) ?? '',
                maxResults: 5,
              }, 10_000);
              if (Array.isArray(searchResponse.results)) {
                searchResults = (searchResponse.results as Array<Record<string, unknown>>).map((r) => ({
                  title: String(r.title ?? r.pagePath ?? ''),
                  snippet: String(r.snippet ?? ''),
                  pagePath: typeof r.pagePath === 'string' ? r.pagePath : undefined,
                }));
              }
            } catch {
              // Search failure is non-fatal; semantic pass proceeds with empty context.
            }

            const semantic = await invoker({
              title: draft?.title ?? getString(body.title) ?? '',
              body: draft?.body ?? getString(body.body) ?? '',
              tags: draft?.tags ?? normalizeStringList(body.tags),
              sourceIds: draft?.sourceIds ?? normalizeStringList(body.sourceIds),
              searchResults,
            });

            if (semantic) {
              review = mergeSemanticReview(review, semantic);
            } else {
              review = { ...review, notes: `${review.notes}\nSemantic steward pass unavailable: invoker returned null.` };
            }
          } catch (error) {
            const reason = sanitizeUiErrorText(error);
            review = { ...review, notes: `${review.notes}\nSemantic steward pass unavailable: ${reason}.` };
          }
        } else {
          review = { ...review, notes: `${review.notes}\nSemantic steward pass unavailable: no LLM invoker configured.` };
        }
      }

      if (draft) {
        const updated: KnowledgeDraft = {
          ...draft,
          type: review.type,
          tags: review.tags,
          warnings: review.warnings,
          stewardNotes: review.notes,
          status: 'steward_reviewed',
          reviewedAt: nowIso(),
          updatedAt: nowIso(),
        };
        await writeDraft(updated);
        await appendAudit({ type: 'steward_reviewed', draftId: updated.id });
      }
      return { success: true, config: activeRole, ...review };
    },

    stewardConfigGet: async (): Promise<KnowledgeStewardConfigGetResult> => {
      const registry = await loadRoleRegistry();
      const activeRole = registry.roles.find((role) => role.roleId === registry.defaultRoleId && role.enabled)
        ?? registry.roles[0];
      return { success: true, registry, ...(activeRole ? { activeRole } : {}) };
    },

    stewardConfigUpdate: async (payload: KnowledgeStewardConfigUpdatePayload): Promise<KnowledgeStewardConfigUpdateResult> => {
      const body: Record<string, unknown> = isRecord(payload) ? payload : {};
      // Update path: caller provides a full new registry (validated through
      // normalizeRoleRegistry — issues returned to caller, never thrown) and/or
      // a new defaultRoleId. The default steward is never removed silently:
      // if the new registry has zero accepted roles, the call refuses to
      // write and returns today's registry unchanged.
      const newRegistryRaw = body.registry;
      const newDefaultRoleId = getString(body.defaultRoleId);
      const currentRegistry = await loadRoleRegistry();
      let nextRegistry: KnowledgeRoleRegistryFile = currentRegistry;
      const issues: Array<{ path: string; message: string }> = [];
      if (newRegistryRaw !== undefined) {
        const { registry, issues: parseIssues } = normalizeRoleRegistry(newRegistryRaw);
        if (registry === DEFAULT_REGISTRY && parseIssues.length > 0) {
          // Refuse to persist a no-op default; surface issues to the caller.
          return { success: false, registry: currentRegistry, issues: parseIssues, error: 'registry validation failed; no changes written' };
        }
        nextRegistry = registry;
        issues.push(...parseIssues);
      }
      if (newDefaultRoleId) {
        const hasRole = nextRegistry.roles.some((role) => role.roleId === newDefaultRoleId);
        if (!hasRole) {
          return {
            success: false,
            registry: currentRegistry,
            issues: [...issues, { path: 'defaultRoleId', message: `defaultRoleId ${newDefaultRoleId} not present in registry; no changes written` }],
            error: 'defaultRoleId not present in registry',
          };
        }
        nextRegistry = { ...nextRegistry, defaultRoleId: newDefaultRoleId };
      }
      try {
        await writeRoleRegistry(nextRegistry);
        return { success: true, registry: nextRegistry, ...(issues.length > 0 ? { issues } : {}) };
      } catch (error) {
        return { success: false, registry: currentRegistry, error: sanitizeUiErrorText(error) };
      }
    },

    routeContext: async (payload: KnowledgeRouteContextPayload): Promise<KnowledgeRouteContextResult> => {
      const body: Record<string, unknown> = isRecord(payload) ? payload : {};
      const message = getString(body.message) ?? '';
      const scope = normalizeRouteScope(body.scope);
      const mode = normalizeRouteMode(body.mode);
      const selectedReferences = Array.isArray(body.selectedReferences)
        ? body.selectedReferences.filter(isRecord) as ChatKnowledgeReference[]
        : [];
      const sourcePolicy = isRecord(body.sourcePolicy) ? body.sourcePolicy : {};
      const runtimeLessonsRequested = sourcePolicy.runtimeLessons === true;
      const decision = shouldRouteKnowledge(message, scope, mode, selectedReferences.length);
      if (!decision.route || !decision.query || mode === 'manual') {
        return {
          success: true,
          decision: 'skip',
          reason: decision.reason,
          candidates: [],
          candidateGroups: [],
          groupedCandidates: {},
          retrievalDiagnostics: buildRetrievalDiagnostics({
            query: decision.query ?? message,
            corpus: scope === 'memory' ? 'memory' : scope === 'all' ? 'all' : 'wiki',
            mode,
            rows: [],
            reason: decision.reason,
          }),
          budget: ROUTER_BUDGET,
          runtimeLessons: {
            requested: runtimeLessonsRequested,
            included: false,
            available: false,
            principleCount: 0,
            reason: runtimeLessonsRequested ? 'not-routed' : 'not-requested',
          },
        };
      }

      try {
        const corpus = scope === 'memory' ? 'memory' : scope === 'all' ? 'all' : 'wiki';
        const result = await rpc<Record<string, unknown>>('wiki.search', {
          query: decision.query,
          maxResults: ROUTER_BUDGET.maxReferences,
          corpus,
        }, 30_000);
        const rows = getRouteSearchRows(result);
        const wikiCandidates = routeCandidatesFromSearch(result, corpus, mode, decision.reason);
        const runtimeLessonResult = runtimeLessonsRequested
          ? await retrieveRuntimeLessonsForRoute(decision.query, mode, decision.reason)
          : undefined;
        const candidates = runtimeLessonResult
          ? [...wikiCandidates, ...runtimeLessonResult.candidates]
              .sort((left, right) => right.confidence - left.confidence)
              .slice(0, ROUTER_BUDGET.maxReferences)
          : wikiCandidates;
        const candidateGroups = groupedRouteCandidates(candidates);
        const routeDecision = mode === 'auto-read' && candidates.length > 0
          ? 'auto_attach'
          : candidates.length > 0
            ? 'suggest'
            : 'skip';
        await appendAudit({
          type: 'knowledge_route_context',
          mode,
          scope,
          decision: routeDecision,
          query: decision.query,
          candidates: candidates.length,
          sessionKey: getString(body.sessionKey),
          workspaceId: typeof body.workspaceId === 'string' ? body.workspaceId : null,
          runtimeLessonsRequested,
          runtimeLessonsIncluded: runtimeLessonResult?.runtimeLessons.included ?? false,
        });
        return {
          success: true,
          decision: routeDecision,
          reason: candidates.length > 0 ? decision.reason : 'no relevant knowledge candidates found',
          query: decision.query,
          candidates,
          candidateGroups,
          groupedCandidates: routeCandidateGroupRecord(candidates),
          retrievalDiagnostics: buildRetrievalDiagnostics({
            query: decision.query,
            corpus,
            mode,
            rows,
            selectedLookups: new Set(candidates.map((candidate) => candidate.lookup)),
            reason: candidates.length > 0 ? decision.reason : 'no relevant knowledge candidates found',
          }),
          budget: ROUTER_BUDGET,
          runtimeLessons: runtimeLessonResult?.runtimeLessons ?? {
            requested: runtimeLessonsRequested,
            included: false,
            available: false,
            principleCount: 0,
            reason: runtimeLessonsRequested ? 'not-routed' : 'not-requested',
          },
        };
      } catch (error) {
        return {
          success: false,
          error: sanitizeUiErrorText(error),
          decision: 'skip',
          reason: 'knowledge routing search failed',
          candidates: [],
          candidateGroups: [],
          groupedCandidates: {},
          retrievalDiagnostics: buildRetrievalDiagnostics({
            query: decision.query,
            corpus: scope === 'memory' ? 'memory' : scope === 'all' ? 'all' : 'wiki',
            mode,
            rows: [],
            reason: 'knowledge routing search failed',
          }),
          budget: ROUTER_BUDGET,
          runtimeLessons: {
            requested: runtimeLessonsRequested,
            included: false,
            available: false,
            principleCount: 0,
            reason: runtimeLessonsRequested ? 'routingFailed' : 'not-requested',
          },
        };
      }
    },

    runtimeLessonsReport: async (): Promise<KnowledgeRuntimeLessonsReportResult> => (
      runtimeLessonsReporter()
    ),

    sekbShadowEvaluationExport: async (
      payload: KnowledgeSekbShadowEvaluationExportPayload,
    ): Promise<KnowledgeSekbShadowEvaluationExportResult> => {
      const body: Record<string, unknown> = isRecord(payload) ? payload : {};
      const key = typeof body.pseudonymizationKey === 'string' ? body.pseudonymizationKey.trim() : '';
      if (!key) {
        return {
          success: false,
          available: false,
          reason: 'missingKey',
          authority: 'offline_evaluation_evidence_not_runtime_source_of_truth',
        };
      }
      const sekb = await loadSekbRuntimeModule();
      if (!sekb) {
        return {
          success: true,
          available: false,
          reason: 'runtimeUnavailable',
          authority: 'offline_evaluation_evidence_not_runtime_source_of_truth',
        };
      }
      try {
        const store = createHostSekbStore(sekb);
        const trajectories = store.query_trajectories({});
        const workspaceRoot = typeof body.workspaceRoot === 'string' && body.workspaceRoot.trim()
          ? body.workspaceRoot.trim()
          : resolveHostSekbWorkspaceRoot();
        const writeArtifact = body.writeArtifact !== false;
        if (writeArtifact) {
          const written = sekb.writeSekbShadowEvaluationExportArtifact({
            trajectories,
            pseudonymizationKey: key,
            workspaceRoot,
          });
          return {
            success: true,
            available: true,
            authority: 'offline_evaluation_evidence_not_runtime_source_of_truth',
            artifactPath: written.artifactPath,
            recordCount: written.artifact.records.length,
            export: written.artifact,
          };
        }
        const artifact = sekb.buildSekbShadowEvaluationExport({
          trajectories,
          pseudonymizationKey: key,
        });
        return {
          success: true,
          available: true,
          authority: 'offline_evaluation_evidence_not_runtime_source_of_truth',
          recordCount: Array.isArray((artifact as { records?: unknown[] }).records)
            ? (artifact as { records: unknown[] }).records.length
            : 0,
          export: artifact,
        };
      } catch (error) {
        return {
          success: false,
          available: false,
          reason: 'exportFailed',
          authority: 'offline_evaluation_evidence_not_runtime_source_of_truth',
          error: sanitizeUiErrorText(error),
        };
      }
    },

    sekbShadowEvaluationProtocol: async (
      payload: KnowledgeSekbShadowEvaluationProtocolPayload,
    ): Promise<KnowledgeSekbShadowEvaluationProtocolResult> => {
      const body: Record<string, unknown> = isRecord(payload) ? payload : {};
      const key = typeof body.pseudonymizationKey === 'string' ? body.pseudonymizationKey.trim() : '';
      if (!key) {
        return {
          success: false,
          available: false,
          reason: 'missingKey',
          authority: 'offline_evaluation_evidence_not_runtime_source_of_truth',
        };
      }
      const sekb = await loadSekbRuntimeModule();
      if (!sekb) {
        return {
          success: true,
          available: false,
          reason: 'runtimeUnavailable',
          authority: 'offline_evaluation_evidence_not_runtime_source_of_truth',
        };
      }
      try {
        const store = createHostSekbStore(sekb);
        const trajectories = store.query_trajectories({});
        const artifact = sekb.buildSekbShadowEvaluationExport({
          trajectories,
          pseudonymizationKey: key,
        }) as Record<string, unknown>;
        const protocol = sekb.createSekbShadowEvaluationReviewProtocol(artifact, {
          sampleSize: typeof body.sampleSize === 'number' ? body.sampleSize : undefined,
          holdoutFraction: typeof body.holdoutFraction === 'number' ? body.holdoutFraction : undefined,
        });
        const workspaceRoot = typeof body.workspaceRoot === 'string' && body.workspaceRoot.trim()
          ? body.workspaceRoot.trim()
          : resolveHostSekbWorkspaceRoot();
        let artifactPath: string | undefined;
        let reviewsTemplatePath: string | undefined;
        if (body.writeArtifact !== false) {
          sekb.writeSekbShadowEvaluationExportArtifact({
            trajectories,
            pseudonymizationKey: key,
            workspaceRoot,
          });
          const dir = join(workspaceRoot, 'artifacts', 'sekb-hermes-phase-a5');
          await mkdir(dir, { recursive: true });
          const protocolPath = join(dir, 'shadow-evaluation-review-protocol.v1.json');
          reviewsTemplatePath = join(dir, 'shadow-evaluation-reviews.template.v1.json');
          await writeFile(protocolPath, `${JSON.stringify(protocol, null, 2)}\n`, 'utf8');
          const template = {
            schema: 'sekb-shadow-evaluation-reviews.v1',
            authority: 'offline_evaluation_evidence_not_runtime_source_of_truth',
            labels: ['valuable', 'not_valuable', 'uncertain'],
            reviewers: ['reviewerA', 'reviewerB'],
            notes: [
              'Fill label for each reviewer/trajectory pair.',
              'Do not tune score weights or thresholds on holdout.',
              'Kit readiness is not promotion; need >=200 dual reviews before evaluable_for_promotion.',
            ],
            reviews: protocol.sample.flatMap((sample) => ([
              { trajectoryId: sample.trajectoryId, reviewerId: 'reviewerA', split: sample.split, label: null },
              { trajectoryId: sample.trajectoryId, reviewerId: 'reviewerB', split: sample.split, label: null },
            ])),
          };
          await writeFile(reviewsTemplatePath, `${JSON.stringify(template, null, 2)}\n`, 'utf8');
          artifactPath = protocolPath;
        }
        return {
          success: true,
          available: true,
          authority: 'offline_evaluation_evidence_not_runtime_source_of_truth',
          artifactPath,
          protocol: protocol as unknown as Record<string, unknown>,
          reviewsTemplatePath,
        };
      } catch (error) {
        return {
          success: false,
          available: false,
          reason: 'protocolFailed',
          authority: 'offline_evaluation_evidence_not_runtime_source_of_truth',
          error: sanitizeUiErrorText(error),
        };
      }
    },

    sekbShadowEvaluationReport: async (
      payload: KnowledgeSekbShadowEvaluationReportPayload,
    ): Promise<KnowledgeSekbShadowEvaluationReportResult> => {
      const body: Record<string, unknown> = isRecord(payload) ? payload : {};
      const reviews = Array.isArray(body.reviews) ? body.reviews : null;
      const reviewers = Array.isArray(body.reviewers) ? body.reviewers : null;
      if (!reviews || !reviewers || reviewers.length !== 2 || !body.export || !body.protocol) {
        return {
          success: false,
          available: false,
          reason: 'invalidInput',
          authority: 'offline_evaluation_evidence_not_runtime_source_of_truth',
        };
      }
      const sekb = await loadSekbRuntimeModule();
      if (!sekb) {
        return {
          success: true,
          available: false,
          reason: 'runtimeUnavailable',
          authority: 'offline_evaluation_evidence_not_runtime_source_of_truth',
        };
      }
      try {
        const report = sekb.buildSekbOfflineEvaluationReport({
          artifact: body.export,
          protocol: body.protocol,
          reviews,
          reviewers: [String(reviewers[0]), String(reviewers[1])],
        });
        let artifactPath: string | undefined;
        if (body.writeArtifact !== false) {
          const workspaceRoot = typeof body.workspaceRoot === 'string' && body.workspaceRoot.trim()
            ? body.workspaceRoot.trim()
            : resolveHostSekbWorkspaceRoot();
          artifactPath = sekb.writeSekbOfflineEvaluationReportArtifact({
            report,
            workspaceRoot,
          }).artifactPath;
        }
        return {
          success: true,
          available: true,
          authority: 'offline_evaluation_evidence_not_runtime_source_of_truth',
          artifactPath,
          report,
        };
      } catch (error) {
        return {
          success: false,
          available: false,
          reason: 'reportFailed',
          authority: 'offline_evaluation_evidence_not_runtime_source_of_truth',
          error: sanitizeUiErrorText(error),
        };
      }
    },

    sekbSuggestPrinciples: async (
      payload?: KnowledgeSekbSuggestPrinciplesPayload,
    ): Promise<KnowledgeSekbSuggestPrinciplesResult> => {
      const sekb = await loadSekbRuntimeModule();
      if (!sekb) {
        return {
          success: true,
          available: false,
          reason: 'runtimeUnavailable',
          mode: 'deterministic',
          suggestions: [],
        };
      }
      try {
        const body: Record<string, unknown> = isRecord(payload) ? payload : {};
        const store = createHostSekbStore(sekb);
        const distiller = new sekb.DistillationTool({ store });
        const suggestions = distiller.suggest_principles_from_trajectories(
          Array.isArray(body.trajectoryIds) ? body.trajectoryIds as string[] : null,
          typeof body.minClusterSize === 'number' ? body.minClusterSize : undefined,
        ) as KnowledgeSekbSuggestPrinciplesResult['suggestions'];
        return {
          success: true,
          available: true,
          mode: 'deterministic',
          suggestions,
        };
      } catch (error) {
        return {
          success: false,
          available: false,
          reason: 'suggestFailed',
          mode: 'deterministic',
          suggestions: [],
          error: sanitizeUiErrorText(error),
        };
      }
    },

    sekbBatchDistillSuggest: async (
      payload?: KnowledgeSekbBatchDistillSuggestPayload,
    ): Promise<KnowledgeSekbBatchDistillSuggestResult> => {
      const sekb = await loadSekbRuntimeModule();
      if (!sekb) {
        return {
          success: true,
          available: false,
          reason: 'runtimeUnavailable',
          mode: 'deterministic_fallback',
          userVisibleStatus: 'runtimeUnavailable',
          suggestions: [],
        };
      }
      try {
        const body: Record<string, unknown> = isRecord(payload) ? payload : {};
        const store = createHostSekbStore(sekb);
        const distiller = new sekb.DistillationTool({ store });
        const enabled = sekb.isSekbBatchDistillationAssistantEnabled(
          readHostSekbFlagConfig(),
          process.env,
        );
        if (!enabled) {
          return {
            success: true,
            available: true,
            reason: 'featureDisabled',
            mode: 'feature_disabled',
            userVisibleStatus: 'feature_disabled',
            suggestions: [],
          };
        }
        const provider = typeof sekb.createDeepSeekSekbBatchDistillationProvider === 'function'
          ? sekb.createDeepSeekSekbBatchDistillationProvider()
          : undefined;
        const assistant = new sekb.SekbBatchDistillationAssistant({
          store,
          enabled,
          ...(provider ? { provider } : {}),
          fallback: (ids: string[] | null | undefined, min?: number) =>
            distiller.suggest_principles_from_trajectories(ids, min),
        });
        const result = await assistant.suggest({
          trajectoryIds: Array.isArray(body.trajectoryIds) ? body.trajectoryIds : null,
          minClusterSize: typeof body.minClusterSize === 'number' ? body.minClusterSize : undefined,
        });
        return {
          success: true,
          available: true,
          mode: 'batch',
          userVisibleStatus: result.userVisibleStatus,
          suggestions: result.suggestions as KnowledgeSekbBatchDistillSuggestResult['suggestions'],
          operatorEvidence: result.operatorEvidence,
        };
      } catch (error) {
        return {
          success: false,
          available: false,
          reason: 'suggestFailed',
          mode: 'deterministic_fallback',
          userVisibleStatus: 'suggestFailed',
          suggestions: [],
          error: sanitizeUiErrorText(error),
        };
      }
    },

    sekbConfirmPrinciple: async (
      payload: KnowledgeSekbConfirmPrinciplePayload,
    ): Promise<KnowledgeSekbConfirmPrincipleResult> => {
      const sekb = await loadSekbRuntimeModule();
      if (!sekb) {
        return {
          success: true,
          available: false,
          reason: 'runtimeUnavailable',
        };
      }
      try {
        const body: Record<string, unknown> = isRecord(payload) ? payload : {};
        const sessionId =
          typeof body.sessionId === 'string'
            ? body.sessionId.trim()
            : typeof payload?.sessionId === 'string'
              ? payload.sessionId.trim()
              : '';
        if (!sessionId) {
          return {
            success: false,
            available: true,
            reason: 'missingSession',
            error: 'sessionId is required to confirm a principle with DCS provenance (P3-002).',
            dcsWrite: 'not_attempted',
            principleOnly: true,
          };
        }
        const store = createHostSekbStore(sekb);
        const distiller = new sekb.DistillationTool({ store });
        const stateDir = resolveHostOpenClawStateDir();
        // Prefer a real DCS BlockStore sink so confirmed experience Blocks are
        // visible to runtime context_search / context_read. Fall back to the
        // journal sink when the shared state DB cannot be opened, and label it
        // journaled_degraded instead of pretending the write persisted.
        const projection = createHostExperienceProjectionSink(stateDir);
        const experienceShadow = resolveHostExperienceShadowOptions(
          body.experienceShadow ?? payload?.experienceShadow,
        );
        const lineage =
          typeof distiller.confirm_and_save_with_lineage === 'function'
            ? await distiller.confirm_and_save_with_lineage(body.suggestion, body.edits ?? null, {
                sessionId,
                requireSession: true,
                sourceSystem: body.sourceSystem ?? payload.sourceSystem ?? 'ui-confirm',
                integrityClaim: body.integrityClaim ?? payload.integrityClaim ?? 'confirmed',
                summaryOnly: body.summaryOnly === true || payload.summaryOnly === true,
                contextBlockSink: projection.sink,
                contextBlockSinkKind: projection.kind,
                ...(experienceShadow ? { experienceShadow } : {}),
              })
            : {
                principleId: distiller.confirm_and_save(body.suggestion, body.edits ?? null, {
                  sessionId,
                  requireSession: true,
                  sourceSystem: body.sourceSystem ?? 'ui-confirm',
                  contextBlockSink: projection.sink,
                  ...(experienceShadow ? { experienceShadow } : {}),
                }),
                provenance: undefined,
                dcsWrite: 'skipped' as const,
                projectionBlockId: undefined,
                highTrustEligible: false,
              };
        let dcsWrite: KnowledgeSekbConfirmPrincipleResult['dcsWrite'] = lineage.dcsWrite;
        // KS-02 persisted requires a real BlockStore read-back. If verification
        // fails, degrade the status instead of reporting a false persisted write.
        if (dcsWrite === 'persisted' && lineage.projectionBlockId && projection.verifyBlock) {
          const verified = await projection.verifyBlock(lineage.projectionBlockId, sessionId);
          if (!verified) dcsWrite = 'journaled_degraded';
        }
        if (dcsWrite === 'written') dcsWrite = projection.kind === 'blockstore' ? 'persisted' : 'journaled_degraded';
        const persisted = dcsWrite === 'persisted';
        return {
          success: true,
          available: true,
          principleId: lineage.principleId,
          provenance: lineage.provenance,
          dcsWrite,
          highTrustEligible: lineage.highTrustEligible,
          principleOnly: !persisted,
        };
      } catch (error) {
        const message = sanitizeUiErrorText(error);
        const errorCode =
          error && typeof error === 'object' ? (error as { code?: string }).code : undefined;
        const missingSession =
          errorCode === 'missing_session' ||
          /sessionId is required|session(?:Id)? is required/i.test(message);
        return {
          success: false,
          available: missingSession ? true : false,
          reason: missingSession ? 'missingSession' : 'confirmFailed',
          error: message,
          dcsWrite: 'not_attempted',
          principleOnly: true,
        };
      }
    },

    sekbRejectSuggestion: async (
      payload: KnowledgeSekbRejectSuggestionPayload,
    ): Promise<KnowledgeSekbRejectSuggestionResult> => {
      const sekb = await loadSekbRuntimeModule();
      if (!sekb) {
        return {
          success: true,
          available: false,
          reason: 'runtimeUnavailable',
        };
      }
      try {
        const body: Record<string, unknown> = isRecord(payload) ? payload : {};
        const store = createHostSekbStore(sekb);
        const distiller = new sekb.DistillationTool({ store });
        distiller.reject_suggestion(
          body.suggestion,
          typeof body.reason === 'string' ? body.reason : undefined,
        );
        return {
          success: true,
          available: true,
        };
      } catch (error) {
        return {
          success: false,
          available: false,
          reason: 'rejectFailed',
          error: sanitizeUiErrorText(error),
        };
      }
    },

    sekbCaptureTrajectory: async (
      payload: KnowledgeSekbCaptureTrajectoryPayload,
    ): Promise<KnowledgeSekbCaptureTrajectoryResult> => {
      const sekb = await loadSekbRuntimeModule();
      if (!sekb || typeof sekb.TrajectoryCapture !== 'function') {
        return {
          success: true,
          available: false,
          reason: 'runtimeUnavailable',
        };
      }
      try {
        const body: Record<string, unknown> = isRecord(payload) ? payload : {};
        const taskIntent = typeof body.taskIntent === 'string' ? body.taskIntent.trim() : '';
        const taskType = typeof body.taskType === 'string' ? body.taskType.trim() : '';
        const outcome = body.outcome;
        if (!taskIntent || !taskType || (outcome !== 'success' && outcome !== 'failure' && outcome !== 'partial')) {
          return {
            success: false,
            available: true,
            reason: 'invalidInput',
            error: 'taskIntent, taskType, and outcome are required',
          };
        }
        if (outcome === 'failure' && !(typeof body.rawError === 'string' && body.rawError.trim())) {
          return {
            success: false,
            available: true,
            reason: 'invalidInput',
            error: 'rawError is required when outcome is failure',
          };
        }
        const runtimeLineage =
          body.runtimeLineage === undefined
            ? undefined
            : isRuntimeLineage(body.runtimeLineage)
              ? body.runtimeLineage
              : null;
        if (runtimeLineage === null) {
          return {
            success: false,
            available: true,
            reason: 'invalidInput',
            error: 'runtimeLineage must be a valid runtime-lineage.v1 object',
          };
        }
        const contextTags = Array.isArray(body.contextTags)
          ? body.contextTags.filter((tag): tag is string => typeof tag === 'string')
          : [];
        const steps = Array.isArray(body.steps) ? body.steps : [];
        const store = createHostSekbStore(sekb);
        const capture = new sekb.TrajectoryCapture({ store });
        const trajectoryId = capture.start_trajectory(
          taskIntent,
          taskType,
          contextTags,
          runtimeLineage ? { runtimeLineage } : undefined,
        );
        for (const step of steps) {
          if (!isRecord(step) || typeof step.action !== 'string') continue;
          capture.log_step(trajectoryId, step.action, step.input ?? null, step.output ?? null);
        }
        const finished = capture.finish_trajectory(
          trajectoryId,
          outcome,
          typeof body.rawError === 'string' ? body.rawError : null,
        );
        return {
          success: true,
          available: true,
          trajectoryId: finished.trajectory_id,
          stepCount: Array.isArray(finished.steps) ? finished.steps.length : 0,
          compressed: true,
        };
      } catch (error) {
        return {
          success: false,
          available: false,
          reason: 'captureFailed',
          error: sanitizeUiErrorText(error),
        };
      }
    },

    sekbRetrieveForTask: async (
      payload: KnowledgeSekbRetrieveForTaskPayload,
    ): Promise<KnowledgeSekbRetrieveForTaskResult> => {
      const sekb = await loadSekbRuntimeModule();
      if (!sekb || typeof sekb.RetrievalEngine !== 'function') {
        return {
          success: true,
          available: false,
          reason: 'runtimeUnavailable',
          principles: [],
          injection: '',
        };
      }
      try {
        const body: Record<string, unknown> = isRecord(payload) ? payload : {};
        const taskIntent = typeof body.taskIntent === 'string' ? body.taskIntent : '';
        const taskType = typeof body.taskType === 'string' ? body.taskType : '';
        const contextTags = Array.isArray(body.contextTags)
          ? body.contextTags.filter((tag): tag is string => typeof tag === 'string')
          : [];
        const topK = typeof body.topK === 'number' ? body.topK : 5;
        const store = createHostSekbStore(sekb);
        const engine = new sekb.RetrievalEngine({ store });
        const principles = engine.retrieve_for_task(taskIntent, taskType, contextTags, topK).map((p) => ({
          principle_id: p.principle_id,
          title: p.title,
          condition: p.condition,
          action: p.action,
          reason: p.reason,
          retrieval_count: p.retrieval_count,
        }));
        return {
          success: true,
          available: true,
          principles,
          injection: engine.format_for_injection(principles),
        };
      } catch (error) {
        return {
          success: false,
          available: false,
          reason: 'retrieveFailed',
          principles: [],
          injection: '',
          error: sanitizeUiErrorText(error),
        };
      }
    },

    matchErrorExperience: async (payload) => {
      try {
        const body: Record<string, unknown> = isRecord(payload) ? payload : {};
        const rawSignal = isRecord(body.signal) ? body.signal : {};
        const text = getString(rawSignal.text);
        if (!text) return { success: true, advisories: [] };
        const signal: KnowledgeErrorGuardSignal = {
          text,
          ...(rawSignal.kind === 'command-failure'
            || rawSignal.kind === 'test-failure'
            || rawSignal.kind === 'lint-failure'
            || rawSignal.kind === 'build-failure'
            || rawSignal.kind === 'runtime-error'
            || rawSignal.kind === 'user-correction'
            ? { kind: rawSignal.kind }
            : {}),
          ...(getString(rawSignal.command) ? { command: getString(rawSignal.command) } : {}),
          ...(getString(rawSignal.stackTrace) ? { stackTrace: getString(rawSignal.stackTrace) } : {}),
          ...(Array.isArray(rawSignal.filePaths) ? { filePaths: normalizeStringList(rawSignal.filePaths) } : {}),
          ...(getString(rawSignal.sessionKey) ? { sessionKey: getString(rawSignal.sessionKey) } : {}),
          ...(typeof rawSignal.workspaceId === 'string' ? { workspaceId: rawSignal.workspaceId } : rawSignal.workspaceId === null ? { workspaceId: null } : {}),
        };
        const limit = clampPositiveInt(body.limit, 3, 10);
        const advisories = matchErrorExperienceCards(await listErrorExperienceTargets(), signal, limit);
        await Promise.all(advisories.map((advisory) => (
          updateStoredErrorExperienceCard(advisory.targetKind, advisory.targetId, 'hit').catch(() => null)
        )));
        if (advisories.length > 0) {
          await appendAudit({
            type: 'error_experience_advisory_matched',
            count: advisories.length,
            topTargetId: advisories[0].targetId,
            sessionKey: signal.sessionKey,
            workspaceId: signal.workspaceId ?? null,
          });
        }
        return { success: true, advisories };
      } catch (error) {
        return { success: false, error: sanitizeUiErrorText(error), advisories: [] };
      }
    },

    updateErrorExperienceEffectiveness: async (payload) => {
      try {
        const body: Record<string, unknown> = isRecord(payload) ? payload : {};
        const targetKind = body.targetKind === 'draft' ? 'draft' : body.targetKind === 'inbox' ? 'inbox' : null;
        const targetId = getString(body.targetId);
        const action = body.action === 'hit'
          || body.action === 'accepted'
          || body.action === 'dismissed'
          || body.action === 'prevented-failure'
          || body.action === 'stale'
          ? body.action
          : null;
        if (!targetKind || !targetId || !action) return { success: false, error: 'targetKind, targetId, and action are required' };
        const effectiveness = await updateStoredErrorExperienceCard(targetKind, targetId, action);
        if (!effectiveness) return { success: false, error: 'error-experience card not found' };
        await appendAudit({
          type: 'error_experience_effectiveness_updated',
          targetKind,
          targetId,
          action,
          note: getString(body.note),
        });
        return { success: true, effectiveness };
      } catch (error) {
        return { success: false, error: sanitizeUiErrorText(error) };
      }
    },

    recordKnowledgeReference: async (payload) => {
      const body: Record<string, unknown> = isRecord(payload) ? payload : {};
      const targetId = getString(body.targetId);
      if (!targetId) return { success: false, error: 'targetId is required' };
      const targetKind = normalizeProvenanceTargetKind(body.targetKind);
      const timestamp = nowIso();
      const existing = await readProvenance(targetKind, targetId);
      const incomingSourceRefs = normalizeSourceRefs(body.sourceRefs);
      const sourceRefMap = new Map<string, KnowledgeSourceRef>();
      for (const ref of existing?.sourceRefs ?? []) sourceRefMap.set(ref.id, ref);
      for (const ref of incomingSourceRefs) sourceRefMap.set(ref.id, { ...sourceRefMap.get(ref.id), ...ref });
      const referenceInput = isRecord(body.reference) ? body.reference : {};
      const reference: KnowledgeReferenceEvent = {
        id: `kr_${randomUUID()}`,
        kind: normalizeReferenceKind(referenceInput.kind),
        timestamp,
        ...(getString(referenceInput.sessionKey) ? { sessionKey: getString(referenceInput.sessionKey) } : {}),
        ...(typeof referenceInput.workspaceId === 'string' ? { workspaceId: referenceInput.workspaceId } : referenceInput.workspaceId === null ? { workspaceId: null } : {}),
        ...(typeof referenceInput.agentId === 'string' ? { agentId: referenceInput.agentId } : referenceInput.agentId === null ? { agentId: null } : {}),
        ...(getString(referenceInput.lookup) ? { lookup: getString(referenceInput.lookup) } : {}),
        ...(getString(referenceInput.query) ? { query: getString(referenceInput.query) } : {}),
        ...(getString(referenceInput.note) ? { note: getString(referenceInput.note) } : {}),
      };
      const record: KnowledgeProvenanceRecord = {
        id: existing?.id ?? provenanceRecordId(targetKind, targetId),
        targetId,
        targetKind,
        title: getString(body.title) ?? existing?.title,
        sourceRefs: Array.from(sourceRefMap.values()),
        references: [...(existing?.references ?? []), reference].slice(-100),
        ...(isRecord(body.metadata) || existing?.metadata ? { metadata: { ...(existing?.metadata ?? {}), ...(isRecord(body.metadata) ? body.metadata : {}) } } : {}),
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      await writeProvenance(record);
      await appendAudit({ type: 'knowledge_referenced', targetId, targetKind, referenceKind: reference.kind });
      return { success: true, record };
    },

    getProvenance: async (payload) => {
      const body: Record<string, unknown> = isRecord(payload) ? payload : {};
      const targetId = getString(body.targetId);
      if (!targetId) return { success: false, error: 'targetId is required' };
      const targetKind = normalizeProvenanceTargetKind(body.targetKind);
      const record = await readProvenance(targetKind, targetId);
      return { success: true, ...(record ? { record } : {}) };
    },


    listGovernanceReceipts: async (): Promise<KnowledgeListGovernanceReceiptsResult> => {
      return { success: true, receipts: await listOperationReceipts() };
    },

    governanceAudit: async (): Promise<KnowledgeGovernanceResult> => {
      let compileResult: KnowledgeCompileResult | null = null;
      let lintResult: KnowledgeLintResult | null = null;
      try {
        compileResult = await rpc<any>('wiki.compile', {}, 120_000);
      } catch { /* ignore */ }
      try {
        lintResult = await rpc<any>('wiki.lint', {}, 60_000);
      } catch { /* ignore */ }

      const issues: KnowledgeGovernanceIssue[] = [];
      const summaries = { contradictions: 0, stale: 0, dangling: 0, duplicates: 0, provenanceGaps: 0 };
      const now = nowIso();

      // Extract contradictions from compile result
      if (compileResult?.contradictionClusters) {
        const clusters = Array.isArray(compileResult.contradictionClusters) ? compileResult.contradictionClusters as unknown[] : [];
        for (const cluster of clusters) {
          const ids = (Array.isArray((cluster as any).claimIds) ? (cluster as any).claimIds : []).filter(Boolean);
          summaries.contradictions++;
          issues.push({
            id: `gov_contradiction_${summaries.contradictions}`,
            category: 'contradiction',
            severity: 'error',
            title: typeof (cluster as any).topic === 'string' ? (cluster as any).topic : 'Contradictory claims',
            description: typeof (cluster as any).description === 'string' ? (cluster as any).description : `${ids.length} contradictory claim(s) detected`,
            affectedPageIds: ids as string[],
            affectedPagePaths: ids as string[],
            detectedAt: now,
          });
        }
      }

      // Extract stale/outdated signals from compile result
      if (compileResult?.freshnessReports) {
        const freshReports = Array.isArray(compileResult.freshnessReports) ? compileResult.freshnessReports as unknown[] : [];
        for (const report of freshReports) {
          summaries.stale++;
          issues.push({
            id: `gov_stale_${summaries.stale}`,
            category: 'stale',
            severity: 'warning',
            title: getString((report as any).pageTitle) ?? 'Stale knowledge',
            description: getString((report as any).reason) ?? `Last updated ${getString((report as any).lastUpdated) ?? 'unknown'}`,
            affectedPageIds: [getString((report as any).pageId) ?? ''].filter(Boolean),
            affectedPagePaths: [getString((report as any).pagePath) ?? ''].filter(Boolean),
            detectedAt: now,
          });
        }
      }

      // Extract provenance gaps from lint result
      if (lintResult?.provenanceGaps) {
        const gaps = Array.isArray(lintResult.provenanceGaps) ? lintResult.provenanceGaps as unknown[] : [];
        for (const gap of gaps) {
          summaries.provenanceGaps++;
          issues.push({
            id: `gov_provenance_${summaries.provenanceGaps}`,
            category: 'provenance_gap',
            severity: 'warning',
            title: getString((gap as any).pageTitle) ?? 'Missing provenance',
            description: getString((gap as any).description) ?? 'No evidence chain found',
            affectedPageIds: [getString((gap as any).pageId) ?? ''].filter(Boolean),
            affectedPagePaths: [getString((gap as any).pagePath) ?? ''].filter(Boolean),
            detectedAt: now,
          });
        }
      }

      // Extract dangling/duplicate from lint result
      if (lintResult?.danglingPages) {
        const dangling = Array.isArray(lintResult.danglingPages) ? lintResult.danglingPages as unknown[] : [];
        for (const d of dangling) {
          summaries.dangling++;
          issues.push({
            id: `gov_dangling_${summaries.dangling}`,
            category: 'dangling',
            severity: 'info',
            title: getString((d as any).pageTitle) ?? 'Isolated page',
            description: getString((d as any).description) ?? 'No incoming or outgoing links',
            affectedPageIds: [getString((d as any).pageId) ?? ''].filter(Boolean),
            affectedPagePaths: [getString((d as any).pagePath) ?? ''].filter(Boolean),
            detectedAt: now,
          });
        }
      }

      if (lintResult?.duplicates) {
        const dups = Array.isArray(lintResult.duplicates) ? lintResult.duplicates as unknown[] : [];
        for (const dup of dups) {
          summaries.duplicates++;
          issues.push({
            id: `gov_duplicate_${summaries.duplicates}`,
            category: 'duplicate',
            severity: 'warning',
            title: getString((dup as any).topic) ?? 'Duplicate content',
            description: getString((dup as any).description) ?? `${(Array.isArray((dup as any).pageIds) ? (dup as any).pageIds : []).length} pages with overlapping content`,
            affectedPageIds: (Array.isArray((dup as any).pageIds) ? (dup as any).pageIds : []) as string[],
            affectedPagePaths: (Array.isArray((dup as any).pageIds) ? (dup as any).pageIds : []) as string[],
            detectedAt: now,
          });
        }
      }

      // Sort: errors first, then warnings, then info
      const severityOrder: Record<string, number> = { error: 0, warning: 1, info: 2 };
      issues.sort((a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9));
      const qualityMetrics = aggregateKnowledgeQualityMetrics({
        summaries,
        issues,
        errorExperienceCards: (await listErrorExperienceTargets()).map((target) => ({
          id: `${target.targetKind}:${target.targetId}`,
          card: target.card,
        })),
      });

      await appendAudit({ type: 'governance_audit', issues: issues.length, contradictions: summaries.contradictions, stale: summaries.stale, dangling: summaries.dangling, duplicates: summaries.duplicates, provenanceGaps: summaries.provenanceGaps, qualityMetrics: qualityMetrics.metrics.length });
      return { success: true, runAt: now, issues, summaries, qualityMetrics };
    },

    listWatchedDirectories: async (): Promise<KnowledgeWatchedDirectoryConfig[]> => {
      try {
        const configs = await readWatchedDirConfigs();
        return configs;
      } catch {
        return [];
      }
    },

    addWatchedDirectory: async (config: KnowledgeWatchedDirectoryConfig): Promise<HostSuccess> => {
      const rawPath = getString(config.path);
      if (!rawPath) return { success: false, error: 'path is required' };
      const path = resolve(expandPath(rawPath));
      if (!existsSync(path)) return { success: false, error: `path does not exist: ${path}` };

      const configs = await readWatchedDirConfigs();
      if (configs.length >= 10) return { success: false, error: 'maximum 10 watched directories allowed' };
      if (configs.some(c => c.path === path)) return { success: false, error: `directory already watched: ${path}` };

      const newConfig: KnowledgeWatchedDirectoryConfig = {
        id: `wd_${randomUUID()}`,
        path,
        patterns: Array.isArray(config.patterns) && config.patterns.length > 0 ? config.patterns : ['**/*.md'],
        enabled: config.enabled !== false,
        ingestNewFiles: config.ingestNewFiles !== false,
        autoCompile: config.autoCompile !== false,
        requiresReview: true,
      };

      configs.push(newConfig);
      await writeWatchedDirConfigs(configs);
      startWatching(newConfig);
      await appendAudit({ type: 'watched_directory_added', configId: newConfig.id, path });
      return { success: true };
    },

    updateWatchedDirectory: async ({ id, config: updates }: { id: string; config: Partial<KnowledgeWatchedDirectoryConfig> }): Promise<HostSuccess> => {
      const configs = await readWatchedDirConfigs();
      const idx = configs.findIndex(c => c.id === id);
      if (idx === -1) return { success: false, error: 'watched directory not found: ' + id };

      const normalizedPath = updates.path ? resolve(expandPath(updates.path)) : undefined;
      const updated = { ...configs[idx], ...updates, ...(normalizedPath ? { path: normalizedPath } : {}), id, requiresReview: true };
      if (normalizedPath && !existsSync(normalizedPath)) return { success: false, error: `path does not exist: ${normalizedPath}` };
      
      configs[idx] = updated;
      await writeWatchedDirConfigs(configs);

      // Restart watcher if path, patterns, or enabled changed
      if (updates.path !== undefined || updates.enabled !== undefined || updates.patterns !== undefined) {
        stopWatching(id);
        if (updated.enabled) startWatching(updated);
      }

      await appendAudit({ type: 'watched_directory_updated', configId: id });
      return { success: true };
    },

    removeWatchedDirectory: async ({ id }: { id: string }): Promise<HostSuccess> => {
      const configs = await readWatchedDirConfigs();
      const idx = configs.findIndex(c => c.id === id);
      if (idx === -1) return { success: false, error: `watched directory not found: ${id}` };

      configs.splice(idx, 1);
      await writeWatchedDirConfigs(configs);
      stopWatching(id);
      await appendAudit({ type: 'watched_directory_removed', configId: id });
      return { success: true };
    },

    listWatchedDirectoryEvents: async (payload: KnowledgeListWatchedDirectoryEventsPayload): Promise<KnowledgeWatchedDirectoryEvent[]> => {
      const body: Record<string, unknown> = isRecord(payload) ? payload : {};
      const configId = getString(body.configId);
      const limit = typeof body.limit === 'number' ? body.limit : 50;
      try {
        const events = await readWatchedDirEvents(configId ?? '');
        const sliced = events.slice(-Math.max(1, Math.min(limit, 500)));
        return sliced;
      } catch {
        return [];
      }
    },
  };
}
