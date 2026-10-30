import { createHash, randomUUID } from 'node:crypto';
import type {
  ChangeContextErrorCode,
  ChangeContextErrorEnvelope,
  ChangeContextProjection,
  ChangeContextProjectionResult,
  ChangeContextReviewCommentMutationResult,
  ChangeContextReviewCommentProjection,
  ChangeContextReviewCommentStorePolicy,
  ChangeContextReviewAnchorResolver,
  ChangeContextState,
} from '@shared/types/change-context';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import type { GatewayManager } from '../gateway/manager';
import { projectReviewAnchorRangeFreshness } from './change-context-anchor';
import { resolveWorkspaceReviewAnchor } from './change-context-anchor-workspace';
import { createChangeContextReviewActions, reviewDigest } from './change-context-review';
import { createTaskLedgerApi } from './task-ledger-api';
import { createGitApi } from './git-api';
import { getActiveWorkspaceProfile } from './workspaces-api';
import { createChangeContextVgEvidenceReader } from './change-context-vg-evidence';
import {
  createChangeContextReviewCommentStore,
  type ChangeContextReviewCommentStore,
  type ChangeContextReviewCommentStoreFailure,
} from './change-context-review-store';
import {
  createDefaultChangeContextSourceReader,
  type ChangeContextComparisonFacts,
  type ChangeContextSourceReader,
} from './change-context-projection';

export type ChangeContextApiContext = {
  store?: ChangeContextReviewCommentStore;
  sourceReader?: ChangeContextSourceReader;
  gatewayManager?: Pick<GatewayManager, 'rpc'>;
  checkpointDiff?: CompleteHostServiceRegistry['sessions']['checkpointDiff'];
  resolveReviewAnchor?: ChangeContextReviewAnchorResolver;
  createRequestId?: () => string;
  now?: () => string;
  taskLedger?: Pick<CompleteHostServiceRegistry['taskLedger'], 'snapshot' | 'appendEvents'>;
  applyPatch?: CompleteHostServiceRegistry['git']['applyPatch'];
  readEvidence?: ReturnType<typeof createChangeContextVgEvidenceReader>;
};

const STATE_SEVERITY: Record<ChangeContextState, number> = {
  available: 0,
  partial: 1,
  truncated: 2,
  stale: 3,
  removed: 4,
  unavailable: 5,
};

function errorEnvelope(
  requestId: string,
  code: ChangeContextErrorCode,
  safeMessage: string,
  details?: Record<string, unknown>,
): ChangeContextErrorEnvelope {
  return {
    schema: 'ChangeContextError/v1',
    code,
    retryable: code === 'unavailable' || code === 'internal',
    requestId,
    safeMessage,
    ...(details ? { details } : {}),
  };
}

function failureEnvelope(
  requestId: string,
  failure: ChangeContextReviewCommentStoreFailure,
): ChangeContextErrorEnvelope {
  return errorEnvelope(requestId, failure.code, failure.message, failure.details);
}

async function projectStoredComment(
  comment: ChangeContextReviewCommentProjection['comment'],
  resolveReviewAnchor?: ChangeContextReviewAnchorResolver,
): Promise<ChangeContextReviewCommentProjection> {
  if (!resolveReviewAnchor) {
    return {
      comment,
      anchorState: 'unavailable',
      anchorIssues: [{
        code: 'digest_missing',
        message: 'The anchored source resolver is unavailable; the comment was not moved.',
        source: 'review-store',
      }],
    };
  }
  const freshness = await projectReviewAnchorRangeFreshness(comment.anchor, resolveReviewAnchor);
  return {
    comment,
    anchorState: freshness.state,
    anchorIssues: freshness.issues,
  };
}

function mutationResult(
  requestId: string,
  result: Awaited<ReturnType<ChangeContextReviewCommentStore['create']>>,
): ChangeContextReviewCommentMutationResult {
  if (!result.ok) {
    return { success: false, error: failureEnvelope(requestId, result.failure) };
  }
  return { success: true, comment: result.value };
}

function combineStates(...states: ChangeContextState[]): ChangeContextState {
  return states.reduce<ChangeContextState>(
    (worst, state) => (STATE_SEVERITY[state] > STATE_SEVERITY[worst] ? state : worst),
    'available',
  );
}

function errorCodeForState(state: ChangeContextState): ChangeContextErrorCode {
  switch (state) {
    case 'available':
      return 'unavailable';
    case 'partial':
      return 'partial';
    case 'truncated':
      return 'truncated';
    case 'stale':
      return 'stale';
    case 'removed':
      return 'removed';
    case 'unavailable':
      return 'unavailable';
  }
}

function contextIdFor(input: {
  workspaceId: string | null;
  sessionKey: string;
  comparison: unknown;
}): string {
  const digest = createHash('sha256')
    .update(JSON.stringify([input.workspaceId, input.sessionKey, input.comparison]))
    .digest('hex')
    .slice(0, 24);
  return `change-context:${digest}`;
}

function projectionFromFacts(input: {
  payload: {
    workspaceId?: string | null;
    sessionKey: string;
    comparison: unknown;
  };
  requestId: string;
  resolvedAt: string;
  facts: ChangeContextComparisonFacts;
}): ChangeContextProjectionResult {
  const state = combineStates(input.facts.comparison.state, input.facts.diff.state);
  const issues = [...input.facts.comparison.issues, ...input.facts.diff.issues];
  const projection: ChangeContextProjection = {
    schemaVersion: 1,
    contextId: contextIdFor({
      workspaceId: input.payload.workspaceId ?? null,
      sessionKey: input.payload.sessionKey,
      comparison: input.payload.comparison,
    }),
    identity: {
      workspaceId: input.payload.workspaceId ?? null,
      sessionKey: input.payload.sessionKey,
      runId: input.facts.identity?.runId ?? null,
      turn: input.facts.identity?.turn ?? null,
    },
    comparison: {
      ...input.facts.comparison,
      state,
      issues,
    },
    diff: {
      ...input.facts.diff,
      state: combineStates(input.facts.diff.state, state),
      issues,
    },
    comments: [],
    evidence: [],
    issues,
    generatedAt: input.resolvedAt,
  };
  projection.reviewedDigest = reviewDigest(projection);
  projection.contextId = contextIdFor({ workspaceId: projection.identity.workspaceId,
    sessionKey: projection.identity.sessionKey, comparison: [input.payload.comparison, projection.reviewedDigest] });

  if (state === 'available') {
    return { success: true, projection };
  }
  return {
    success: false,
    error: errorEnvelope(
      input.requestId,
      errorCodeForState(state),
      issues[0]?.message ?? `Change Context comparison is ${state}.`,
      { state, issues },
    ),
    projection,
  };
}

export function createChangeContextApi(
  context: ChangeContextApiContext = {},
): CompleteHostServiceRegistry['changeContext'] {
  const store = context.store ?? createChangeContextReviewCommentStore();
  const resolveReviewAnchor = context.resolveReviewAnchor;
  const sourceReader = context.sourceReader ?? createDefaultChangeContextSourceReader({
    gatewayManager: context.gatewayManager,
    checkpointDiff: context.checkpointDiff,
  });
  const createRequestId = context.createRequestId ?? (() => randomUUID());
  const now = context.now ?? (() => new Date().toISOString());
  const readEvidence = context.readEvidence ?? createChangeContextVgEvidenceReader();
  const loaded: Parameters<typeof createChangeContextReviewActions>[0]['loaded'] = new Map();
  const actions = createChangeContextReviewActions({ loaded,
    refresh: (payload) => api.getProjection(payload), listComments: (payload) => api.listComments(payload),
    taskLedger: context.taskLedger ?? createTaskLedgerApi(), applyPatch: context.applyPatch ?? createGitApi().applyPatch });
  const api: CompleteHostServiceRegistry['changeContext'] = {
    getProjection: async (payload) => {
      const requestId = createRequestId();
      const sessionKey = typeof payload?.sessionKey === 'string' ? payload.sessionKey.trim() : '';
      if (!sessionKey || !payload?.comparison?.mode) {
        return {
          success: false,
          error: errorEnvelope(requestId, 'validation', 'sessionKey and comparison are required.'),
        };
      }
      if (!context.sourceReader && payload.workspaceId && (await getActiveWorkspaceProfile())?.id !== payload.workspaceId) {
        return { success: false, error: errorEnvelope(requestId, 'unavailable', 'The selected workspace is not active.') };
      }
      const resolvedAt = now();
      const facts = await sourceReader.read({
        workspaceId: payload.workspaceId ?? null,
        sessionKey,
        comparison: payload.comparison,
        resolvedAt,
        requestId,
      });
      const result = projectionFromFacts({
        payload: {
          workspaceId: payload.workspaceId ?? null,
          sessionKey,
          comparison: payload.comparison,
        },
        requestId,
        resolvedAt,
        facts,
      });
      if (result.success && result.projection) {
        result.projection.evidence = await readEvidence(result.projection);
        loaded.set(result.projection.contextId, { projection: result.projection, payload, loadedAt: Date.now() });
        if (loaded.size > 100) loaded.delete(loaded.keys().next().value!);
      }
      return result;
    },

    listComments: async (payload) => {
      const requestId = createRequestId();
      const result = await store.list(payload);
      if (!result.ok) {
        return {
          success: false,
          error: failureEnvelope(requestId, result.failure),
          storeState: 'unavailable',
          comments: [],
        };
      }
      const comments = await Promise.all(result.value.comments.map((comment) => (
        projectStoredComment(comment, resolveReviewAnchor ?? (async (anchor) => {
          if (comment.workspaceId !== (await getActiveWorkspaceProfile())?.id) throw new Error('The anchored workspace is not active.');
          return resolveWorkspaceReviewAnchor(anchor);
        }))
      )));
      if (result.value.state !== 'available') {
        return {
          success: false,
          error: errorEnvelope(
            requestId,
            result.value.state === 'partial' ? 'partial' : 'unavailable',
            'Review comment store was readable but incomplete.',
            { issues: result.value.issues },
          ),
          storeState: result.value.state,
          comments,
        };
      }
      return {
        success: true,
        storeState: result.value.state,
        comments,
      };
    },

    createComment: async (payload) => (
      mutationResult(createRequestId(), await store.create(payload))
    ),

    resolveComment: async (payload) => (
      mutationResult(createRequestId(), await store.resolve(payload))
    ),

    reanchorComment: async (payload) => (
      mutationResult(createRequestId(), await store.reanchor(payload))
    ),

    deleteComment: async (payload) => (
      mutationResult(createRequestId(), await store.delete(payload))
    ),

    ...actions,
  };
  return api;
}

export type ChangeContextReviewCommentStoreOwner = Pick<
  ChangeContextReviewCommentStorePolicy,
  'owner' | 'authority'
>;
