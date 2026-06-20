import { shell } from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { mkdir, readFile, readdir, writeFile, appendFile, stat } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import type { GatewayManager } from '../gateway/manager';
import { expandPath, getOpenClawConfigDir } from '../utils/paths';
import { isRecord } from './payload-utils';
import type {
  KnowledgeChangeOperation,
  KnowledgeChangeProposal,
  KnowledgeCreateDraftPayload,
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
  KnowledgeStewardConfig,
} from '../../shared/host-api/contract';

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
const KNOWLEDGE_CHANGE_OPERATIONS = new Set<KnowledgeChangeOperation>([
  'create',
  'update',
  'merge',
  'archive',
  'delete',
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

function getOkfBundleMappingPath(bundleId: string): string {
  return join(getOkfBundlesDir(), `${bundleId}.json`);
}

async function ensureKnowledgeDirs(): Promise<void> {
  await mkdir(getDraftsDir(), { recursive: true });
  await mkdir(getInboxDir(), { recursive: true });
  await mkdir(getProposalsDir(), { recursive: true });
  await mkdir(getProvenanceDir(), { recursive: true });
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
      || entry.kind === 'manual'
      || entry.kind === 'search_result'
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

async function appendAudit(event: Record<string, unknown>): Promise<void> {
  await mkdir(getKnowledgeDir(), { recursive: true });
  await appendFile(getAuditPath(), `${JSON.stringify({ ...event, timestamp: nowIso() })}\n`, 'utf8');
}

async function readJsonFile<T>(path: string, guard: (value: unknown) => value is T): Promise<T | null> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
    return guard(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function readDraft(id: string): Promise<KnowledgeDraft | null> {
  if (!id.trim()) return null;
  return readJsonFile(getDraftPath(id.trim()), hasDraftShape);
}

async function readInboxItem(id: string): Promise<KnowledgeInboxItem | null> {
  if (!id.trim()) return null;
  return readJsonFile(getInboxPath(id.trim()), hasInboxShape);
}

async function writeDraft(draft: KnowledgeDraft): Promise<void> {
  await ensureKnowledgeDirs();
  await writeJsonFile(getDraftPath(draft.id), draft);
}

async function writeInboxItem(item: KnowledgeInboxItem): Promise<void> {
  await ensureKnowledgeDirs();
  await writeJsonFile(getInboxPath(item.id), item);
}

async function listDraftRecords(): Promise<KnowledgeDraft[]> {
  await ensureKnowledgeDirs();
  const names = await readdir(getDraftsDir()).catch(() => []);
  const drafts = await Promise.all(names
    .filter((name) => name.endsWith('.json'))
    .map((name) => readJsonFile(join(getDraftsDir(), name), hasDraftShape)));
  return drafts
    .filter((draft): draft is KnowledgeDraft => Boolean(draft))
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

async function listInboxRecords(): Promise<KnowledgeInboxItem[]> {
  await ensureKnowledgeDirs();
  const names = await readdir(getInboxDir()).catch(() => []);
  const items = await Promise.all(names
    .filter((name) => name.endsWith('.json'))
    .map((name) => readJsonFile(join(getInboxDir(), name), hasInboxShape)));
  return items
    .filter((item): item is KnowledgeInboxItem => Boolean(item))
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

async function readProposal(id: string): Promise<KnowledgeChangeProposal | null> {
  if (!id.trim()) return null;
  return readJsonFile(getProposalPath(id.trim()), hasProposalShape);
}

async function writeProposal(proposal: KnowledgeChangeProposal): Promise<void> {
  await ensureKnowledgeDirs();
  await writeJsonFile(getProposalPath(proposal.id), proposal);
}

async function listProposalRecords(): Promise<KnowledgeChangeProposal[]> {
  await ensureKnowledgeDirs();
  const names = await readdir(getProposalsDir()).catch(() => []);
  const proposals = await Promise.all(names
    .filter((name) => name.endsWith('.json'))
    .map((name) => readJsonFile(join(getProposalsDir(), name), hasProposalShape)));
  return proposals
    .filter((proposal): proposal is KnowledgeChangeProposal => Boolean(proposal))
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

async function readProvenance(targetKind: KnowledgeProvenanceTargetKind, targetId: string): Promise<KnowledgeProvenanceRecord | null> {
  if (!targetId.trim()) return null;
  return readJsonFile(getProvenancePath(targetKind, targetId.trim()), hasProvenanceShape);
}

async function writeProvenance(record: KnowledgeProvenanceRecord): Promise<void> {
  await ensureKnowledgeDirs();
  await writeJsonFile(getProvenancePath(record.targetKind, record.targetId), record);
}

function createDraftFromPayload(payload: KnowledgeCreateDraftPayload): KnowledgeDraft | null {
  const title = getString(payload.title);
  const body = getString(payload.body);
  if (!title || !body) return null;
  const timestamp = nowIso();
  return {
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
    createdBy: normalizeDraftActor(payload.createdBy),
    ...(normalizeConfidence(payload.confidence) != null ? { confidence: normalizeConfidence(payload.confidence) } : {}),
    warnings: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
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
  return {
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
    createdBy: normalizeDraftActor(payload.createdBy),
    warnings: normalizeStringList(payload.warnings),
    ...(isRecord(payload.metadata) ? { metadata: payload.metadata } : {}),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function draftFromInboxItem(item: KnowledgeInboxItem): KnowledgeDraft {
  const timestamp = nowIso();
  return {
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
    createdBy: item.createdBy,
    warnings: item.warnings ?? [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function createProposalForDraft(draft: KnowledgeDraft, reason: string): KnowledgeChangeProposal {
  const timestamp = nowIso();
  return {
    id: `kp_${randomUUID()}`,
    operation: 'create',
    status: 'proposed',
    draftId: draft.id,
    reason,
    sources: draft.sourceRefs.length > 0
      ? draft.sourceRefs
      : draft.sourceIds.map((id) => ({ id, kind: 'manual' as const })),
    requiresUserConfirmation: true,
    createdAt: timestamp,
    updatedAt: timestamp,
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
      errors.push({ inputPath: expanded, error: error instanceof Error ? error.message : String(error) });
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
      errors.push(okfIssue('readDirectoryFailed', error instanceof Error ? error.message : String(error), { filePath: dirPath }));
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
        errors.push(okfIssue('statFailed', error instanceof Error ? error.message : String(error), { filePath: nextPath }));
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
    warnings.push(okfIssue('indexReadFailed', error instanceof Error ? error.message : String(error), { filePath: rootIndexPath }));
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
    return emptyOkfValidationResult(error instanceof Error ? error.message : String(error), bundlePath);
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
    let content = '';
    try {
      content = await readFile(file.filePath, 'utf8');
    } catch (error) {
      errors.push(okfIssue('readConceptFailed', error instanceof Error ? error.message : String(error), { conceptId, filePath: file.filePath }));
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
      errors.push(okfIssue('invalidFrontmatter', error instanceof Error ? error.message : String(error), { conceptId, filePath: file.filePath }));
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

export function createKnowledgeApi({ gatewayManager }: { gatewayManager: GatewayManager }): CompleteHostServiceRegistry['knowledge'] {
  const rpc = <T>(method: string, params: unknown = {}, timeoutMs = 30_000) =>
    gatewayManager.rpc(method, params, timeoutMs) as Promise<T>;

  return {
    status: async () => {
      try {
        return { success: true, status: await rpc('wiki.status', {}, 12_000) };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },

    init: async () => {
      try {
        const result = await rpc<Record<string, unknown>>('wiki.init', {}, 30_000);
        return { success: true, ...result };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },

    configure: async (payload) => {
      try {
        const snapshot = await rpc<ConfigSnapshot>('config.get', {}, 12_000);
        const patch = buildMemoryWikiPatch(snapshot, payload);
        await rpc('config.patch', {
          raw: JSON.stringify(patch),
          ...(snapshot.hash ? { baseHash: snapshot.hash } : {}),
          note: 'Enable and configure ClawX Knowledge Hub memory-wiki defaults.',
        }, 30_000);
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
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
            error: error instanceof Error ? error.message : String(error),
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
            error: error instanceof Error ? error.message : String(error),
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
        const result = await rpc<Record<string, unknown>>('wiki.search', {
          query,
          maxResults: clampPositiveInt(body.maxResults, 10, 50),
          ...(body.corpus === 'memory' || body.corpus === 'all' || body.corpus === 'wiki' ? { corpus: body.corpus } : {}),
          ...(typeof body.mode === 'string' && body.mode ? { mode: body.mode } : {}),
        }, 30_000);
        return { success: true, ...result };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error), results: [] };
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
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },

    compile: async () => {
      try {
        return { success: true, ...(await rpc<Record<string, unknown>>('wiki.compile', {}, 120_000)) };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },

    lint: async () => {
      try {
        return { success: true, ...(await rpc<Record<string, unknown>>('wiki.lint', {}, 120_000)) };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
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
        const result = await rpc<Record<string, unknown>>('wiki.apply', {
          op: 'create_synthesis',
          title,
          body: draftBody,
          sourceIds,
          ...(Array.isArray(body.claims) ? { claims: body.claims } : {}),
          ...(Array.isArray(body.contradictions) ? { contradictions: body.contradictions } : {}),
          ...(Array.isArray(body.questions) ? { questions: body.questions } : {}),
          ...(typeof body.confidence === 'number' ? { confidence: body.confidence } : {}),
          ...(typeof body.status === 'string' ? { status: body.status } : {}),
        }, 120_000);
        await appendAudit({ type: 'wiki_apply_direct', title, sourceIds, actor: 'user_confirmed' });
        return { success: true, ...result };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
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
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },

    createInboxItem: async (payload) => {
      const item = createInboxItemFromPayload(payload);
      if (!item) return { success: false, error: 'title and body are required' };
      await writeInboxItem(item);
      await appendAudit({ type: 'inbox_created', inboxId: item.id, kind: item.kind, createdBy: item.createdBy });
      return { success: true, item };
    },

    listInboxItems: async (payload) => {
      const body: Record<string, unknown> = isRecord(payload) ? payload : {};
      const status = typeof body.status === 'string' ? body.status : 'pending';
      const kind = typeof body.kind === 'string' ? body.kind : 'all';
      const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : null;
      const limit = clampPositiveInt(body.limit, 50, 200);
      const items = (await listInboxRecords())
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
      const updated: KnowledgeInboxItem = {
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
        updatedAt: nowIso(),
      };
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

    listDrafts: async (payload) => {
      const body: Record<string, unknown> = isRecord(payload) ? payload : {};
      const status = typeof body.status === 'string' ? body.status : 'all';
      const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : null;
      const limit = clampPositiveInt(body.limit, 50, 200);
      const drafts = (await listDraftRecords())
        .filter((draft) => status === 'all' || draft.status === status)
        .filter((draft) => !workspaceId || draft.workspaceId === workspaceId)
        .slice(0, limit);
      return { success: true, drafts };
    },

    getDraft: async (payload) => {
      const id = isRecord(payload) ? getString(payload.id) : undefined;
      const draft = id ? await readDraft(id) : null;
      return draft ? { success: true, draft } : { success: false, error: 'draft not found' };
    },

    updateDraft: async (payload) => {
      const body: Record<string, unknown> = isRecord(payload) ? payload : {};
      const id = getString(body.id);
      const draft = id ? await readDraft(id) : null;
      if (!draft) return { success: false, error: 'draft not found' };
      if (draft.status === 'applied') return { success: false, error: 'applied drafts cannot be edited' };
      const updated: KnowledgeDraft = {
        ...draft,
        ...(getString(body.title) ? { title: getString(body.title)! } : {}),
        ...(getString(body.body) ? { body: getString(body.body)! } : {}),
        ...(typeof body.type === 'string' && KNOWLEDGE_DRAFT_TYPES.has(body.type as KnowledgeDraftType) ? { type: body.type as KnowledgeDraftType } : {}),
        ...(Array.isArray(body.sourceIds) ? { sourceIds: normalizeStringList(body.sourceIds) } : {}),
        ...(Array.isArray(body.sourceRefs) ? { sourceRefs: normalizeSourceRefs(body.sourceRefs) } : {}),
        ...(Array.isArray(body.tags) ? { tags: normalizeStringList(body.tags) } : {}),
        ...(normalizeConfidence(body.confidence) != null ? { confidence: normalizeConfidence(body.confidence) } : {}),
        workspaceId: typeof body.workspaceId === 'string' ? body.workspaceId : draft.workspaceId,
        agentId: typeof body.agentId === 'string' ? body.agentId : draft.agentId,
        status: draft.status === 'approved' ? 'draft' : draft.status,
        updatedAt: nowIso(),
      };
      await writeDraft(updated);
      await appendAudit({ type: 'draft_updated', draftId: updated.id });
      return { success: true, draft: updated };
    },

    reviewDraft: async (payload) => {
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
      const updated: KnowledgeDraft = {
        ...draft,
        status: nextStatus,
        stewardNotes: getString(body.stewardNotes) ?? draft.stewardNotes,
        warnings: Array.isArray(body.warnings) ? normalizeStringList(body.warnings) : draft.warnings,
        reviewedAt: nowIso(),
        updatedAt: nowIso(),
      };
      await writeDraft(updated);
      if (nextStatus === 'approved') {
        const proposals = await listProposalRecords();
        await Promise.all(proposals
          .filter((proposal) => proposal.draftId === updated.id && proposal.status === 'proposed')
          .map(async (proposal) => {
            const approved: KnowledgeChangeProposal = { ...proposal, status: 'approved', updatedAt: nowIso() };
            await writeProposal(approved);
          }));
      }
      await appendAudit({ type: 'draft_reviewed', draftId: updated.id, action });
      return { success: true, draft: updated };
    },

    proposeChange: async (payload) => {
      const body: Record<string, unknown> = isRecord(payload) ? payload : {};
      const operation = typeof body.operation === 'string' && KNOWLEDGE_CHANGE_OPERATIONS.has(body.operation as KnowledgeChangeOperation)
        ? body.operation as KnowledgeChangeOperation
        : null;
      const reason = getString(body.reason);
      if (!operation || !reason) return { success: false, error: 'operation and reason are required' };
      const targetPageIds = normalizeStringList(body.targetPageIds);
      if (['update', 'merge', 'archive', 'delete'].includes(operation) && targetPageIds.length === 0) {
        return { success: false, error: 'targetPageIds are required for this operation' };
      }
      if (['update', 'merge'].includes(operation) && !getString(body.diff)) {
        return { success: false, error: 'diff is required for update or merge proposals' };
      }
      const timestamp = nowIso();
      const proposal: KnowledgeChangeProposal = {
        id: `kp_${randomUUID()}`,
        operation,
        status: 'proposed',
        ...(targetPageIds.length > 0 ? { targetPageIds } : {}),
        ...(getString(body.draftId) ? { draftId: getString(body.draftId) } : {}),
        ...(getString(body.diff) ? { diff: getString(body.diff) } : {}),
        reason,
        sources: normalizeSourceRefs(body.sources),
        requiresUserConfirmation: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      await writeProposal(proposal);
      await appendAudit({ type: 'proposal_created', proposalId: proposal.id, operation });
      return { success: true, proposal };
    },

    listProposals: async (payload) => {
      const body: Record<string, unknown> = isRecord(payload) ? payload : {};
      const status = typeof body.status === 'string' ? body.status : 'all';
      const limit = clampPositiveInt(body.limit, 50, 200);
      const proposals = (await listProposalRecords())
        .filter((proposal) => status === 'all' || proposal.status === status)
        .slice(0, limit);
      return { success: true, proposals };
    },

    previewChange: async (payload) => {
      const id = isRecord(payload) ? getString(payload.id) : undefined;
      const proposal = id ? await readProposal(id) : null;
      if (!proposal) return { success: false, error: 'proposal not found' };
      const draft = proposal.draftId ? await readDraft(proposal.draftId) : null;
      const preview = proposal.diff ?? draft?.body ?? proposal.reason;
      return { success: true, proposal, ...(draft ? { draft } : {}), preview };
    },

    applyReviewedChange: async (payload) => {
      const id = isRecord(payload) ? getString(payload.id) : undefined;
      const proposal = id ? await readProposal(id) : null;
      if (!proposal) return { success: false, error: 'proposal not found' };
      if (proposal.status !== 'approved') {
        return { success: false, error: 'proposal must be approved by the user before apply' };
      }
      const draft = proposal.draftId ? await readDraft(proposal.draftId) : null;
      if (proposal.operation !== 'create') {
        return { success: false, error: 'Only create proposals can be applied to memory-wiki in this MVP' };
      }
      if (!draft || draft.status !== 'approved') {
        return { success: false, error: 'approved draft is required before apply' };
      }
      if (draft.sourceIds.length === 0) {
        return { success: false, error: 'draft sourceIds are required before apply' };
      }
      try {
        const result = await rpc<Record<string, unknown>>('wiki.apply', {
          op: 'create_synthesis',
          title: draft.title,
          body: draft.body,
          sourceIds: draft.sourceIds,
          ...(typeof draft.confidence === 'number' ? { confidence: draft.confidence } : {}),
          status: 'draft',
        }, 120_000);
        const timestamp = nowIso();
        const appliedDraft: KnowledgeDraft = { ...draft, status: 'applied', appliedAt: timestamp, updatedAt: timestamp };
        const appliedProposal: KnowledgeChangeProposal = { ...proposal, status: 'applied', appliedAt: timestamp, updatedAt: timestamp };
        await writeDraft(appliedDraft);
        await writeProposal(appliedProposal);
        await appendAudit({ type: 'reviewed_change_applied', proposalId: proposal.id, draftId: draft.id, operation: proposal.operation });
        return { success: true, proposal: appliedProposal, draft: appliedDraft, ...result };
      } catch (error) {
        return { success: false, proposal, draft, error: error instanceof Error ? error.message : String(error) };
      }
    },

    stewardReview: async (payload) => {
      const body: Record<string, unknown> = isRecord(payload) ? payload : {};
      const draft = getString(body.draftId) ? await readDraft(getString(body.draftId)!) : null;
      const review = stewardReviewDraft({
        title: draft?.title ?? getString(body.title),
        body: draft?.body ?? getString(body.body),
        sourceIds: draft?.sourceIds ?? normalizeStringList(body.sourceIds),
        tags: draft?.tags ?? normalizeStringList(body.tags),
      });
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
      return { success: true, config: DEFAULT_STEWARD_CONFIG, ...review };
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
  };
}
