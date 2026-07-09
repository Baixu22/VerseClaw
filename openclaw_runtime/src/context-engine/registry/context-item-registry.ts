import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  normalizeContextItem,
  normalizeContextItemId,
  normalizeArchiveHandle,
  normalizeLifecycleEvent,
  normalizeLifecycleEventId,
  normalizeStatusSnapshot,
  stableStringifyContextFamily,
  type ContextFamilyValidationError,
  type ContextItem,
  type ContextItemId,
  type ContextItemKind,
  type ContextStatusSnapshot,
  type ArchiveHandle,
  type LifecycleEvent,
  type LifecycleEventId,
  type LifecycleState,
  type SourceRef,
} from '../../../../shared/types/context-family';
import {
  InMemoryContextItemStore,
  type ContextItemQuery,
  type ContextItemStore,
} from './context-item-store';

export type { ContextItemQuery, ContextItemStore } from './context-item-store';
export { InMemoryContextItemStore } from './context-item-store';

type RegistryDiagnostic = {
  code: string;
  message: string;
};

export type RegistryResult<T> =
  | {
      ok: true;
      item: T;
      diagnostics: RegistryDiagnostic[];
    }
  | {
      ok: false;
      diagnostics: RegistryDiagnostic[];
    };

type ContextItemRegistryOptions = {
  store?: ContextItemStore;
  shadowMode?: boolean;
};

const MAX_REGISTRY_METADATA_BYTES = 4096;
const PAYLOAD_FIELD_NAMES = new Set(['content', 'payload', 'rawPayload', 'rawContent', 'text']);
const CONTEXT_ARCHIVE_FILE_SUFFIX = '.context-archive.json';

type ContextFamilyLifecycleAuditState = {
  events: LifecycleEvent[];
};

const contextFamilyLifecycleAuditState: ContextFamilyLifecycleAuditState = {
  events: [],
};

export class ContextItemRegistry {
  readonly #store: ContextItemStore;
  readonly #shadowMode: boolean;

  constructor(options: ContextItemRegistryOptions = {}) {
    this.#store = options.store ?? new InMemoryContextItemStore();
    this.#shadowMode = options.shadowMode ?? true;
  }

  async register(value: unknown): Promise<RegistryResult<ContextItem>> {
    try {
      rejectLargePayloadFields(value);
      const item = normalizeContextItem(value);
      await this.#store.upsertItem(item);
      return { ok: true, item, diagnostics: [] };
    } catch (error) {
      return this.#diagnosticResult(error);
    }
  }

  async recordLifecycleEvent(value: unknown): Promise<RegistryResult<LifecycleEvent>> {
    try {
      rejectLargePayloadFields(value);
      const event = normalizeLifecycleEvent(value);
      await this.#store.appendLifecycleEvent(event);
      recordContextFamilyLifecycleEvents([event]);
      return { ok: true, item: event, diagnostics: [] };
    } catch (error) {
      return this.#diagnosticResult(error);
    }
  }

  async query(query: ContextItemQuery = {}): Promise<ContextItem[]> {
    try {
      return await this.#store.queryItems(query);
    } catch {
      return [];
    }
  }

  async snapshot(query: ContextItemQuery = {}): Promise<ContextStatusSnapshot> {
    const items = await this.query(query);
    return normalizeStatusSnapshot({
      schemaVersion: 1,
      totalItems: items.length,
      countsByKind: countBy(items, (item) => item.kind),
      countsByLifecycleState: countBy(items, (item) => item.lifecycleState),
      archiveAvailable: items.some((item) => Boolean(item.archiveHandle)),
      recoveryAvailable: false,
      warnings: [],
    });
  }

  async get(id: string): Promise<ContextItem | undefined> {
    try {
      return await this.#store.getItem(normalizeContextItemId(id));
    } catch {
      return undefined;
    }
  }

  #diagnosticResult(error: unknown): RegistryResult<never> {
    const diagnostic = diagnosticFromError(error);
    if (!this.#shadowMode && diagnostic.code === 'registry_shadow_failure') {
      throw error;
    }
    return {
      ok: false,
      diagnostics: [diagnostic],
    };
  }
}

export function createShadowContextItemRegistry(options: Omit<ContextItemRegistryOptions, 'shadowMode'> = {}): ContextItemRegistry {
  return new ContextItemRegistry({ ...options, shadowMode: true });
}

export function stableContentHash(content: unknown): `sha256:${string}` {
  const serialized = typeof content === 'string' ? content : stableStringifyContextFamily(content);
  return `sha256:${createHash('sha256').update(serialized).digest('hex')}`;
}

export type ContextArchiveCreateInput = {
  sessionId: string;
  itemId: ContextItemId;
  payload: unknown;
  source?: ContextItem['source'];
  archiveRoot?: string;
  createdAt?: string;
};

export type ContextArchiveVerifyResult =
  | {
      ok: true;
      payload: unknown;
    }
  | {
      ok: false;
      reason: 'invalid_uri' | 'missing' | 'checksum_mismatch' | 'read_error';
      error?: string;
    };

export type ContextArchiveCleanupResult = {
  removed: string[];
  errors: Array<{ path: string; error: string }>;
};

export type ContextFamilyLifecycleAuditSnapshot = {
  events: LifecycleEvent[];
  status: ContextStatusSnapshot;
};

type ContextArchiveArtifact = {
  schemaVersion: 1;
  handle: ArchiveHandle;
  payload: unknown;
};

export async function createContextArchiveHandleForPayload(
  input: ContextArchiveCreateInput,
): Promise<ArchiveHandle> {
  return createContextArchiveHandleForPayloadSync(input);
}

export function createContextArchiveHandleForPayloadSync(input: ContextArchiveCreateInput): ArchiveHandle {
  const artifact = buildContextArchiveArtifact(input);
  const filePath = resolveContextArchiveFilePath(artifact.handle);
  if (!filePath) {
    throw new Error(`Invalid context archive uri: ${artifact.handle.uri}`);
  }
  fsSync.mkdirSync(path.dirname(filePath), { recursive: true });
  fsSync.writeFileSync(filePath, `${stableStringifyContextFamily(artifact)}\n`, 'utf8');
  return artifact.handle;
}

export async function verifyContextArchiveHandle(
  handle: ArchiveHandle,
): Promise<ContextArchiveVerifyResult> {
  const filePath = resolveContextArchiveFilePath(handle);
  if (!filePath) {
    return { ok: false, reason: 'invalid_uri' };
  }
  let parsed: ContextArchiveArtifact;
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    parsed = JSON.parse(raw) as ContextArchiveArtifact;
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    return code === 'ENOENT'
      ? { ok: false, reason: 'missing' }
      : {
          ok: false,
          reason: 'read_error',
          error: error instanceof Error ? error.message : String(error),
        };
  }
  const payloadChecksum = stableContentHash(parsed.payload);
  if (payloadChecksum !== handle.checksum || parsed.handle.checksum !== handle.checksum) {
    return { ok: false, reason: 'checksum_mismatch' };
  }
  return { ok: true, payload: parsed.payload };
}

export async function cleanupContextArchiveArtifacts(params: {
  sessionIds: string[];
  archiveRoot?: string;
}): Promise<ContextArchiveCleanupResult> {
  const root = resolveContextArchiveRoot(params.archiveRoot);
  const removed: string[] = [];
  const errors: Array<{ path: string; error: string }> = [];
  for (const sessionId of params.sessionIds.map((id) => sanitizeArchivePathSegment(id))) {
    if (!sessionId) {
      continue;
    }
    const sessionDir = path.join(root, sessionId);
    try {
      const entries = await fs.readdir(sessionDir);
      await Promise.all(entries.map(async (entry) => {
        if (!entry.endsWith(CONTEXT_ARCHIVE_FILE_SUFFIX)) {
          return;
        }
        const filePath = path.join(sessionDir, entry);
        try {
          await fs.unlink(filePath);
          removed.push(filePath);
        } catch (error) {
          errors.push({
            path: filePath,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }));
      await fs.rmdir(sessionDir).catch(() => undefined);
    } catch (error) {
      if ((error as { code?: unknown }).code !== 'ENOENT') {
        errors.push({
          path: sessionDir,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  return { removed: removed.sort(), errors: errors.sort((a, b) => a.path.localeCompare(b.path)) };
}

export function createContextItemId(...parts: string[]): ContextItemId {
  const slug = parts
    .map((part) => part.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, ''))
    .filter(Boolean)
    .join('/')
    .trim()
    .replace(/\/+/g, '/');
  return normalizeContextItemId(`ctx:${slug}`);
}

export function createLifecycleEventId(...parts: string[]): LifecycleEventId {
  const slug = slugifyContextFamilyParts(parts);
  return normalizeLifecycleEventId(`evt:${slug}`);
}

export type TransformationLifecycleEventInput = {
  sessionId: string;
  itemId: ContextItemId;
  from?: LifecycleState;
  to: LifecycleState;
  reason: string;
  actor: string;
  source?: SourceRef;
  metadata?: Record<string, unknown>;
  derivedItemIds?: ContextItemId[];
  occurredAt?: string;
};

export function createTransformationLifecycleEvents(
  input: TransformationLifecycleEventInput,
): LifecycleEvent[] {
  const eventBase = {
    from: input.from,
    to: input.to,
    reason: input.reason,
    actor: input.actor,
    occurredAt: input.occurredAt ?? new Date(0).toISOString(),
    source: input.source,
    metadata: sanitizeLifecycleMetadata(input.metadata ?? {}),
  };
  const primary = normalizeLifecycleEvent({
    id: createLifecycleEventId(input.sessionId, input.itemId, input.reason),
    itemId: input.itemId,
    ...eventBase,
  });
  const derived = (input.derivedItemIds ?? []).map((itemId) =>
    normalizeLifecycleEvent({
      id: createLifecycleEventId(input.sessionId, itemId, input.reason),
      itemId,
      to: 'active',
      reason: `${input.reason}_derived_item`,
      actor: input.actor,
      occurredAt: eventBase.occurredAt,
      source: input.source,
      metadata: sanitizeLifecycleMetadata({
        parentItemId: input.itemId,
        transformationReason: input.reason,
      }),
    }),
  );
  return [primary, ...derived];
}

type RuntimeInput = {
  sessionId: string;
  content?: unknown;
  byteLength?: number;
};

type ToolResultInput = RuntimeInput & {
  toolCallId: string;
  turnId?: string;
};

type InstructionInput = RuntimeInput & {
  path: string;
};

type TranscriptInput = RuntimeInput & {
  entryId: string;
};

type CompactionInput = RuntimeInput & {
  checkpointId: string;
};

type CompressionArtifactInput = RuntimeInput & {
  artifactId: string;
};

export function createShadowIngestion(registry: ContextItemRegistry) {
  return {
    registerToolResult(input: ToolResultInput) {
      return registry.register(createRuntimeItem({
        id: createContextItemId(input.sessionId, 'observation', input.toolCallId),
        kind: 'observation',
        source: {
          type: 'tool_call',
          sessionId: input.sessionId,
          turnId: input.turnId,
          toolCallId: input.toolCallId,
        },
        content: input.content,
        metadata: {
          byteLength: input.byteLength,
        },
      }));
    },
    registerInstructionFile(input: InstructionInput) {
      return registry.register(createRuntimeItem({
        id: createContextItemId(input.sessionId, 'instruction', input.path),
        kind: 'instruction',
        source: {
          type: 'bootstrap_file',
          sessionId: input.sessionId,
          path: input.path,
        },
        content: input.content,
      }));
    },
    registerUserMessage(input: TranscriptInput) {
      return registry.register(createRuntimeItem({
        id: createContextItemId(input.sessionId, 'user-intent', input.entryId),
        kind: 'user_intent',
        source: {
          type: 'transcript',
          sessionId: input.sessionId,
          entryId: input.entryId,
        },
        content: input.content,
      }));
    },
    registerAssistantMessage(input: TranscriptInput) {
      return registry.register(createRuntimeItem({
        id: createContextItemId(input.sessionId, 'reasoning', input.entryId),
        kind: 'reasoning',
        source: {
          type: 'transcript',
          sessionId: input.sessionId,
          entryId: input.entryId,
        },
        content: input.content,
      }));
    },
    registerCompactionSummary(input: CompactionInput) {
      return registry.register(createRuntimeItem({
        id: createContextItemId(input.sessionId, 'derived', input.checkpointId),
        kind: 'derived',
        source: {
          type: 'compaction',
          sessionId: input.sessionId,
          ownerId: input.checkpointId,
        },
        content: input.content,
      }));
    },
    registerCompressionArtifact(input: CompressionArtifactInput) {
      return registry.register(createRuntimeItem({
        id: createContextItemId(input.sessionId, 'ledger', input.artifactId),
        kind: 'ledger',
        source: {
          type: 'compression_artifact',
          sessionId: input.sessionId,
          ownerId: input.artifactId,
        },
        content: input.content,
      }));
    },
  };
}

export function resetContextFamilyLifecycleAudit(): void {
  contextFamilyLifecycleAuditState.events = [];
}

export function recordContextFamilyLifecycleEvents(events: readonly LifecycleEvent[]): void {
  for (const event of events) {
    try {
      contextFamilyLifecycleAuditState.events.push(normalizeLifecycleEvent(event));
    } catch {
      // Shadow audit failures must not affect the runtime transformation path.
    }
  }
}

export function getContextFamilyLifecycleAuditSnapshot(params: {
  sessionId?: string;
  limit?: number;
} = {}): ContextFamilyLifecycleAuditSnapshot {
  const sessionId = params.sessionId?.trim();
  const limit = Math.max(1, Math.floor(params.limit ?? 200));
  const events = contextFamilyLifecycleAuditState.events
    .filter((event) => !sessionId || event.source?.sessionId === sessionId || event.itemId.includes(sessionId))
    .slice(-limit);
  const countsByKind: Partial<Record<ContextItemKind, number>> = {};
  const countsByLifecycleState: Partial<Record<LifecycleState, number>> = {};
  let archiveAvailable = false;
  let recoveryAvailable = false;

  for (const event of events) {
    const kind = parseContextItemKindFromId(event.itemId);
    if (kind) {
      countsByKind[kind] = (countsByKind[kind] ?? 0) + 1;
    }
    countsByLifecycleState[event.to] = (countsByLifecycleState[event.to] ?? 0) + 1;
    if (event.metadata && typeof event.metadata === 'object') {
      if ('archiveHandle' in event.metadata) {
        archiveAvailable = true;
      }
      if (
        event.metadata.checkpointRole === 'recovery_index' ||
        event.metadata.losslessArchive === true ||
        event.metadata.recoveryAvailable === true
      ) {
        recoveryAvailable = true;
      }
    }
  }

  return {
    events: events.map((event) => structuredClone(event)),
    status: normalizeStatusSnapshot({
      schemaVersion: 1,
      totalItems: events.length,
      countsByKind,
      countsByLifecycleState,
      archiveAvailable,
      recoveryAvailable,
      warnings: events.length === 0
        ? ['No Context Family lifecycle audit events recorded for this scope.']
        : [],
    }),
  };
}

function createRuntimeItem(input: {
  id: ContextItemId;
  kind: ContextItemKind;
  source: ContextItem['source'];
  content?: unknown;
  metadata?: Record<string, unknown>;
}): ContextItem {
  const contentHash = input.content === undefined ? undefined : stableContentHash(input.content);
  const hashMetadata = contentHash ? {} : { hashUnavailableReason: 'content_not_available' };
  return normalizeContextItem({
    id: input.id,
    schemaVersion: 1,
    kind: input.kind,
    lifecycleState: 'active',
    source: input.source,
    projection: {
      mode: input.kind === 'instruction' || input.kind === 'user_intent' || input.kind === 'reasoning'
        ? 'verbatim'
        : 'index_only',
    },
    provenance: {
      producer: 'context-family-shadow-ingestion',
    },
    ...(contentHash ? { contentHash } : {}),
    metadata: sanitizeMetadata({
      ...hashMetadata,
      ...input.metadata,
    }),
  });
}

function countBy<T extends string>(items: ContextItem[], select: (item: ContextItem) => T): Partial<Record<T, number>> {
  return items.reduce<Partial<Record<T, number>>>((counts, item) => {
    const key = select(item);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function parseContextItemKindFromId(itemId: ContextItemId): ContextItemKind | undefined {
  const kind = itemId.split('/')[1];
  switch (kind) {
    case 'instruction':
    case 'observation':
    case 'reasoning':
    case 'user_intent':
    case 'ledger':
    case 'derived':
      return kind;
    default:
      return undefined;
  }
}

function sanitizeMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => value !== undefined),
  );
}

function slugifyContextFamilyParts(parts: string[]): string {
  return parts
    .map((part) => part.trim().replace(/^ctx:/, '').replace(/^evt:/, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, ''))
    .filter(Boolean)
    .join('/')
    .trim()
    .replace(/\/+/g, '/');
}

function buildContextArchiveArtifact(input: ContextArchiveCreateInput): ContextArchiveArtifact {
  const sessionId = nonEmptyArchiveSegment(input.sessionId, 'sessionId');
  const itemId = nonEmptyArchiveSegment(input.itemId, 'itemId');
  const checksum = stableContentHash(input.payload);
  const payloadBytes =
    typeof input.payload === 'string' ? input.payload : stableStringifyContextFamily(input.payload);
  const byteLength = Buffer.byteLength(payloadBytes, 'utf8');
  const fileName = `${sanitizeArchivePathSegment(itemId)}-${checksum.slice('sha256:'.length, 'sha256:'.length + 16)}${CONTEXT_ARCHIVE_FILE_SUFFIX}`;
  const handle = normalizeArchiveHandle({
    uri: `context-archive://${encodeURIComponent(sessionId)}/${encodeURIComponent(fileName)}`,
    checksum,
    byteLength,
    ...(input.source ? { source: input.source } : {}),
    createdAt: input.createdAt ?? new Date(0).toISOString(),
  });
  return {
    schemaVersion: 1,
    handle,
    payload: input.payload,
  };
}

function resolveContextArchiveRoot(archiveRoot?: string): string {
  return path.resolve(
    archiveRoot ??
      process.env.OPENCLAW_CONTEXT_ARCHIVE_DIR ??
      path.join(os.tmpdir(), 'openclaw-context-archive'),
  );
}

function resolveContextArchiveFilePath(handle: Pick<ArchiveHandle, 'uri'>): string | null {
  const match = /^context-archive:\/\/([^/]+)\/([^/]+)$/.exec(handle.uri);
  if (!match?.[1] || !match[2]) {
    return null;
  }
  const sessionId = sanitizeArchivePathSegment(decodeURIComponent(match[1]));
  const fileName = sanitizeArchivePathSegment(decodeURIComponent(match[2]));
  if (!sessionId || !fileName || !fileName.endsWith(CONTEXT_ARCHIVE_FILE_SUFFIX)) {
    return null;
  }
  return path.join(resolveContextArchiveRoot(), sessionId, fileName);
}

function nonEmptyArchiveSegment(value: string, label: string): string {
  const text = String(value).trim();
  if (!text) {
    throw new Error(`Context archive ${label} is required`);
  }
  return text;
}

function sanitizeArchivePathSegment(value: string): string {
  return value
    .trim()
    .replace(/^ctx:/, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function sanitizeLifecycleMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const payloadFieldNames = new Set([
    'content',
    'payload',
    'rawPayload',
    'rawContent',
    'text',
    'message',
    'messages',
    'summary',
  ]);
  return Object.fromEntries(
    Object.entries(metadata)
      .filter(([key, value]) => value !== undefined && !payloadFieldNames.has(key))
      .map(([key, value]) => [key, sanitizeLifecycleMetadataValue(value)]),
  );
}

function sanitizeLifecycleMetadataValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeLifecycleMetadataValue(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  return sanitizeLifecycleMetadata(value as Record<string, unknown>);
}

function rejectLargePayloadFields(value: unknown): void {
  if (!value || typeof value !== 'object') {
    return;
  }
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      continue;
    }
    for (const [key, child] of Object.entries(current)) {
      if (PAYLOAD_FIELD_NAMES.has(key) && typeof child === 'string' && child.length > MAX_REGISTRY_METADATA_BYTES) {
        throw new Error('registry_large_payload');
      }
      if (child && typeof child === 'object') {
        stack.push(child);
      }
    }
  }
}

function diagnosticFromError(error: unknown): RegistryDiagnostic {
  if (error instanceof Error && error.message === 'registry_large_payload') {
    return {
      code: 'registry_large_payload',
      message: 'Registry records must not store large raw payload fields.',
    };
  }
  const validation = error as ContextFamilyValidationError;
  if (validation?.issues?.[0]) {
    return {
      code: validation.issues[0].code,
      message: validation.issues[0].message,
    };
  }
  return {
    code: 'registry_shadow_failure',
    message: error instanceof Error ? error.message : 'ContextItemRegistry shadow registration failed.',
  };
}
