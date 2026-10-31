import { randomUUID } from 'node:crypto';
import {
  CHANGE_CONTEXT_REVIEW_COMMENT_STORE_POLICY,
  type ChangeContextActor,
  type ChangeContextErrorCode,
  type ChangeContextReviewComment,
  type ChangeContextReviewCommentAnchor,
  type ChangeContextReviewCommentCreatePayload,
  type ChangeContextReviewCommentDeletePayload,
  type ChangeContextReviewCommentReanchorPayload,
  type ChangeContextReviewCommentResolvePayload,
  type ChangeContextRevisionRef,
  type ChangeContextState,
} from '@shared/types/change-context';

export type ChangeContextReviewCommentStoreDocument = {
  schemaVersion: 1;
  comments: ChangeContextReviewComment[];
};

export type ChangeContextReviewCommentStoreBackend = {
  read(): Promise<unknown>;
  write(document: ChangeContextReviewCommentStoreDocument): Promise<void>;
};

export type ChangeContextReviewCommentStoreFailure = {
  code: ChangeContextErrorCode;
  message: string;
  details?: Record<string, unknown>;
};

export type ChangeContextReviewCommentStoreResult<T> =
  | { ok: true; value: T }
  | { ok: false; failure: ChangeContextReviewCommentStoreFailure };

export type ChangeContextReviewCommentList = {
  state: ChangeContextState;
  comments: ChangeContextReviewComment[];
  issues: string[];
};

export type ChangeContextReviewCommentStore = {
  list(input: {
    workspaceId?: string | null;
    sessionKey: string;
    contextId?: string;
    includeDeleted?: boolean;
  }): Promise<ChangeContextReviewCommentStoreResult<ChangeContextReviewCommentList>>;
  create(
    input: ChangeContextReviewCommentCreatePayload,
  ): Promise<ChangeContextReviewCommentStoreResult<ChangeContextReviewComment>>;
  resolve(
    input: ChangeContextReviewCommentResolvePayload,
  ): Promise<ChangeContextReviewCommentStoreResult<ChangeContextReviewComment>>;
  reanchor(
    input: ChangeContextReviewCommentReanchorPayload,
  ): Promise<ChangeContextReviewCommentStoreResult<ChangeContextReviewComment>>;
  delete(
    input: ChangeContextReviewCommentDeletePayload,
  ): Promise<ChangeContextReviewCommentStoreResult<ChangeContextReviewComment>>;
};

export type CreateChangeContextReviewCommentStoreOptions = {
  backend?: ChangeContextReviewCommentStoreBackend;
  now?: () => string;
  createId?: () => string;
};

let defaultBackend: ChangeContextReviewCommentStoreBackend | null = null;
let defaultStoreInstance: {
  get(key: 'document'): unknown;
  set(key: 'document', value: ChangeContextReviewCommentStoreDocument): void;
} | null = null;

function createDefaultBackend(): ChangeContextReviewCommentStoreBackend {
  return {
    read: async () => {
      if (!defaultStoreInstance) {
        const Store = (await import('electron-store')).default;
        defaultStoreInstance = new Store<{ document: ChangeContextReviewCommentStoreDocument }>({
          name: CHANGE_CONTEXT_REVIEW_COMMENT_STORE_POLICY.storeName,
          defaults: {
            document: {
              schemaVersion: 1,
              comments: [],
            },
          },
        });
      }
      return defaultStoreInstance.get('document');
    },
    write: async (document) => {
      if (!defaultStoreInstance) {
        const Store = (await import('electron-store')).default;
        defaultStoreInstance = new Store<{ document: ChangeContextReviewCommentStoreDocument }>({
          name: CHANGE_CONTEXT_REVIEW_COMMENT_STORE_POLICY.storeName,
          defaults: {
            document: {
              schemaVersion: 1,
              comments: [],
            },
          },
        });
      }
      defaultStoreInstance.set('document', document);
    },
  };
}

function getDefaultBackend(): ChangeContextReviewCommentStoreBackend {
  defaultBackend ??= createDefaultBackend();
  return defaultBackend;
}

export function createInMemoryChangeContextReviewCommentBackend(
  initial?: ChangeContextReviewCommentStoreDocument,
): ChangeContextReviewCommentStoreBackend & {
  snapshot(): ChangeContextReviewCommentStoreDocument;
} {
  let document: ChangeContextReviewCommentStoreDocument = initial
    ? structuredClone(initial)
    : { schemaVersion: 1, comments: [] };
  return {
    read: async () => structuredClone(document),
    write: async (next) => {
      document = structuredClone(next);
    },
    snapshot: () => structuredClone(document),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function normalizeActor(value: unknown): ChangeContextActor | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || !value.id.trim()) return null;
  if (value.kind !== 'agent' && value.kind !== 'user' && value.kind !== 'system') return null;
  if (value.drivenBy !== undefined && value.drivenBy !== 'agent' && value.drivenBy !== 'human') {
    return null;
  }
  return {
    id: value.id.trim(),
    kind: value.kind,
    ...(value.drivenBy ? { drivenBy: value.drivenBy } : {}),
  };
}

function normalizeRevision(value: unknown): ChangeContextRevisionRef | null {
  if (value === null) return null;
  if (!isRecord(value) || typeof value.kind !== 'string') return null;
  if (value.kind === 'git-commit' && typeof value.commit === 'string') {
    return {
      kind: 'git-commit',
      commit: value.commit,
      treeDigest: isNullableString(value.treeDigest) ? value.treeDigest : null,
    };
  }
  if (value.kind === 'git-worktree' && (typeof value.workspaceId === 'string' || value.workspaceId === null)) {
    return {
      kind: 'git-worktree',
      workspaceId: value.workspaceId,
      headCommit: isNullableString(value.headCommit) ? value.headCommit : null,
      worktreeDigest: isNullableString(value.worktreeDigest) ? value.worktreeDigest : null,
    };
  }
  if (value.kind === 'turn') {
    const turn = isRecord(value.turn) ? value.turn : null;
    const transcriptSeq = isRecord(value.transcriptSeq)
      ? value.transcriptSeq
      : null;
    const normalizedTurn = turn
      && typeof turn.sessionKey === 'string'
      && typeof turn.runId === 'string'
      && Number.isInteger(turn.attemptIndex)
      && Number.isInteger(turn.modelCallIndex)
      ? {
          sessionKey: turn.sessionKey,
          runId: turn.runId,
          attemptIndex: Number(turn.attemptIndex),
          modelCallIndex: Number(turn.modelCallIndex),
        }
      : null;
    const normalizedSeq = transcriptSeq
      && Number.isInteger(transcriptSeq.start)
      && Number.isInteger(transcriptSeq.end)
      && Number(transcriptSeq.start) >= 1
      && Number(transcriptSeq.end) >= Number(transcriptSeq.start)
      ? { start: Number(transcriptSeq.start), end: Number(transcriptSeq.end) }
      : null;
    if (!normalizedTurn && !normalizedSeq && typeof value.runtimeTurnId !== 'string') return null;
    return {
      kind: 'turn',
      turn: normalizedTurn,
      runtimeTurnId: typeof value.runtimeTurnId === 'string' ? value.runtimeTurnId : null,
      transcriptSeq: normalizedSeq,
      transcriptDigest: isNullableString(value.transcriptDigest) ? value.transcriptDigest : null,
    };
  }
  if (value.kind === 'checkpoint' && typeof value.checkpointId === 'string') {
    return {
      kind: 'checkpoint',
      checkpointId: value.checkpointId,
      checkpointDigest: isNullableString(value.checkpointDigest) ? value.checkpointDigest : null,
    };
  }
  return null;
}

function normalizeAnchor(value: unknown): ChangeContextReviewCommentAnchor | null {
  if (!isRecord(value) || !isRecord(value.range)) return null;
  const range = value.range;
  if (
    typeof value.path !== 'string'
    || !value.path.trim()
    || !Number.isInteger(range.startLine)
    || !Number.isInteger(range.endLine)
    || Number(range.startLine) < 1
    || Number(range.endLine) < Number(range.startLine)
  ) {
    return null;
  }
  const baseRevision = normalizeRevision(value.baseRevision);
  const candidateRevision = normalizeRevision(value.candidateRevision);
  if (baseRevision === null && value.baseRevision !== null) return null;
  if (candidateRevision === null && value.candidateRevision !== null) return null;
  return {
    path: value.path.trim(),
    range: {
      startLine: Number(range.startLine),
      endLine: Number(range.endLine),
      ...(Number.isInteger(range.startColumn) ? { startColumn: Number(range.startColumn) } : {}),
      ...(Number.isInteger(range.endColumn) ? { endColumn: Number(range.endColumn) } : {}),
    },
    fileDigest: typeof value.fileDigest === 'string' ? value.fileDigest : null,
    rangeDigest: typeof value.rangeDigest === 'string' ? value.rangeDigest : null,
    baseRevision,
    candidateRevision,
    originalExcerpt: typeof value.originalExcerpt === 'string' ? value.originalExcerpt : '',
  };
}

function normalizeComment(value: unknown): ChangeContextReviewComment | null {
  if (!isRecord(value) || value.schemaVersion !== 1) return null;
  const author = normalizeActor(value.author);
  const anchor = normalizeAnchor(value.anchor);
  if (!author || !anchor) return null;
  if (
    typeof value.id !== 'string'
    || !value.id
    || !isNullableString(value.workspaceId)
    || typeof value.sessionKey !== 'string'
    || !value.sessionKey
    || typeof value.contextId !== 'string'
    || !value.contextId
    || typeof value.body !== 'string'
    || !value.body
    || typeof value.createdAt !== 'string'
    || typeof value.updatedAt !== 'string'
    || !isNullableString(value.resolvedAt)
    || !isNullableString(value.deletedAt)
    || !isNullableString(value.deletionReason)
    || !Number.isInteger(value.reanchorCount)
  ) {
    return null;
  }
  return {
    id: value.id,
    schemaVersion: 1,
    workspaceId: value.workspaceId,
    sessionKey: value.sessionKey,
    contextId: value.contextId,
    body: value.body,
    author,
    anchor,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    resolvedAt: value.resolvedAt,
    deletedAt: value.deletedAt,
    deletionReason: value.deletionReason,
    reanchorCount: Number(value.reanchorCount),
  };
}

function normalizeDocument(value: unknown): {
  document: ChangeContextReviewCommentStoreDocument;
  issues: string[];
} {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.comments)) {
    return { document: { schemaVersion: 1, comments: [] }, issues: ['invalid_store_document'] };
  }
  const comments: ChangeContextReviewComment[] = [];
  let skipped = 0;
  for (const entry of value.comments) {
    const comment = normalizeComment(entry);
    if (comment) comments.push(comment);
    else skipped += 1;
  }
  return {
    document: { schemaVersion: 1, comments },
    issues: skipped > 0 ? [`skipped_invalid_comments:${skipped}`] : [],
  };
}

function cloneComment(comment: ChangeContextReviewComment): ChangeContextReviewComment {
  return structuredClone(comment);
}

function normalizeOptionalWorkspaceId(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function createChangeContextReviewCommentStore(
  options: CreateChangeContextReviewCommentStoreOptions = {},
): ChangeContextReviewCommentStore {
  const backend = options.backend ?? getDefaultBackend();
  const now = options.now ?? (() => new Date().toISOString());
  const createId = options.createId ?? (() => randomUUID());
  let writeTail: Promise<void> = Promise.resolve();

  async function readUnlocked(): Promise<
    ChangeContextReviewCommentStoreResult<{
      document: ChangeContextReviewCommentStoreDocument;
      issues: string[];
    }>
  > {
    try {
      const normalized = normalizeDocument(await backend.read());
      return { ok: true, value: normalized };
    } catch (error) {
      return {
        ok: false,
        failure: {
          code: 'unavailable',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  async function write(
    document: ChangeContextReviewCommentStoreDocument,
  ): Promise<ChangeContextReviewCommentStoreResult<void>> {
    try {
      await backend.write(document);
      return { ok: true, value: undefined };
    } catch (error) {
      return {
        ok: false,
        failure: {
          code: 'internal',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  function withWriteLock<T>(
    operation: () => Promise<ChangeContextReviewCommentStoreResult<T>>,
  ): Promise<ChangeContextReviewCommentStoreResult<T>> {
    const run = writeTail.then(operation, operation);
    writeTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  return {
    list: async (input) => {
      await writeTail;
      const readResult = await readUnlocked();
      if (!readResult.ok) return readResult;
      const { document, issues } = readResult.value;
      const comments = document.comments
        .filter((comment) => (input.includeDeleted ? true : comment.deletedAt === null))
        .filter((comment) => comment.sessionKey === input.sessionKey)
        .filter((comment) => !input.contextId || comment.contextId === input.contextId)
        .filter((comment) => (
          input.workspaceId === undefined || comment.workspaceId === normalizeOptionalWorkspaceId(input.workspaceId)
        ))
        .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
        .map(cloneComment);
      return {
        ok: true,
        value: {
          state: issues.length > 0 ? 'partial' : 'available',
          comments,
          issues,
        },
      };
    },

    create: (input) => withWriteLock(async () => {
      const body = input.body.trim();
      if (!body) {
        return { ok: false, failure: { code: 'validation', message: 'Comment body is required' } };
      }
      if (body.length > CHANGE_CONTEXT_REVIEW_COMMENT_STORE_POLICY.maxBodyChars) {
        return {
          ok: false,
          failure: {
            code: 'validation',
            message: `Comment body exceeds ${CHANGE_CONTEXT_REVIEW_COMMENT_STORE_POLICY.maxBodyChars} characters`,
          },
        };
      }
      const sessionKey = input.sessionKey.trim();
      const contextId = input.contextId.trim();
      const author = normalizeActor(input.author);
      const normalizedAnchor = normalizeAnchor(input.anchor);
      if (!sessionKey || !contextId) {
        return { ok: false, failure: { code: 'validation', message: 'Session and context are required' } };
      }
      if (!author) {
        return { ok: false, failure: { code: 'validation', message: 'A valid comment author is required' } };
      }
      if (!normalizedAnchor) {
        return { ok: false, failure: { code: 'validation', message: 'A valid digest anchor is required' } };
      }
      const readResult = await readUnlocked();
      if (!readResult.ok) return readResult;
      const { document } = readResult.value;
      if (document.comments.length >= CHANGE_CONTEXT_REVIEW_COMMENT_STORE_POLICY.maxRecords) {
        return {
          ok: false,
          failure: {
            code: 'capacity_exceeded',
            message: 'Review comment store is full; delete old comments explicitly before adding more',
            details: { maxRecords: CHANGE_CONTEXT_REVIEW_COMMENT_STORE_POLICY.maxRecords },
          },
        };
      }
      const timestamp = now();
      const comment: ChangeContextReviewComment = {
        id: createId(),
        schemaVersion: 1,
        workspaceId: normalizeOptionalWorkspaceId(input.workspaceId),
        sessionKey,
        contextId,
        body,
        author,
        anchor: normalizedAnchor,
        createdAt: timestamp,
        updatedAt: timestamp,
        resolvedAt: null,
        deletedAt: null,
        deletionReason: null,
        reanchorCount: 0,
      };
      const writeResult = await write({
        schemaVersion: 1,
        comments: [comment, ...document.comments],
      });
      if (!writeResult.ok) return writeResult;
      return { ok: true, value: comment };
    }),

    resolve: (input) => withWriteLock(async () => {
      const readResult = await readUnlocked();
      if (!readResult.ok) return readResult;
      const { document } = readResult.value;
      const index = document.comments.findIndex((comment) => comment.id === input.commentId);
      if (index < 0 || document.comments[index].deletedAt) {
        return { ok: false, failure: { code: 'not_found', message: 'Review comment was not found' } };
      }
      const timestamp = now();
      const next = structuredClone(document.comments[index]);
      next.resolvedAt = input.resolved ? timestamp : null;
      next.updatedAt = timestamp;
      const comments = [...document.comments];
      comments[index] = next;
      const writeResult = await write({ schemaVersion: 1, comments });
      if (!writeResult.ok) return writeResult;
      return { ok: true, value: next };
    }),

    reanchor: (input) => withWriteLock(async () => {
      if (!input.reason.trim()) {
        return { ok: false, failure: { code: 'validation', message: 'Re-anchor reason is required' } };
      }
      const normalizedAnchor = normalizeAnchor(input.anchor);
      if (!normalizedAnchor) {
        return { ok: false, failure: { code: 'validation', message: 'A valid digest anchor is required' } };
      }
      const readResult = await readUnlocked();
      if (!readResult.ok) return readResult;
      const { document } = readResult.value;
      const index = document.comments.findIndex((comment) => comment.id === input.commentId);
      if (index < 0 || document.comments[index].deletedAt) {
        return { ok: false, failure: { code: 'not_found', message: 'Review comment was not found' } };
      }
      const current = document.comments[index];
      if (current.updatedAt !== input.expectedUpdatedAt) {
        return {
          ok: false,
          failure: {
            code: 'conflict',
            message: 'Review comment changed before re-anchor',
            details: { expectedUpdatedAt: input.expectedUpdatedAt, actualUpdatedAt: current.updatedAt },
          },
        };
      }
      const timestamp = now();
      const next: ChangeContextReviewComment = {
        ...structuredClone(current),
        anchor: normalizedAnchor,
        reanchorCount: current.reanchorCount + 1,
        updatedAt: timestamp,
      };
      const comments = [...document.comments];
      comments[index] = next;
      const writeResult = await write({ schemaVersion: 1, comments });
      if (!writeResult.ok) return writeResult;
      return { ok: true, value: next };
    }),

    delete: (input) => withWriteLock(async () => {
      if (!input.reason.trim()) {
        return { ok: false, failure: { code: 'validation', message: 'Delete reason is required' } };
      }
      const readResult = await readUnlocked();
      if (!readResult.ok) return readResult;
      const { document } = readResult.value;
      const index = document.comments.findIndex((comment) => comment.id === input.commentId);
      if (index < 0 || document.comments[index].deletedAt) {
        return { ok: false, failure: { code: 'not_found', message: 'Review comment was not found' } };
      }
      const current = document.comments[index];
      if (current.updatedAt !== input.expectedUpdatedAt) {
        return {
          ok: false,
          failure: {
            code: 'conflict',
            message: 'Review comment changed before delete',
            details: { expectedUpdatedAt: input.expectedUpdatedAt, actualUpdatedAt: current.updatedAt },
          },
        };
      }
      const timestamp = now();
      const next: ChangeContextReviewComment = {
        ...structuredClone(current),
        deletedAt: timestamp,
        deletionReason: input.reason.trim(),
        updatedAt: timestamp,
      };
      const comments = [...document.comments];
      comments[index] = next;
      const writeResult = await write({ schemaVersion: 1, comments });
      if (!writeResult.ok) return writeResult;
      return { ok: true, value: next };
    }),
  };
}
