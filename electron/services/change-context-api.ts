import { randomUUID } from 'node:crypto';
import type {
  ChangeContextErrorCode,
  ChangeContextErrorEnvelope,
  ChangeContextReviewCommentMutationResult,
  ChangeContextReviewCommentProjection,
  ChangeContextReviewCommentStorePolicy,
} from '@shared/types/change-context';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import {
  createChangeContextReviewCommentStore,
  type ChangeContextReviewCommentStore,
  type ChangeContextReviewCommentStoreFailure,
} from './change-context-review-store';

export type ChangeContextApiContext = {
  store?: ChangeContextReviewCommentStore;
  createRequestId?: () => string;
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

function projectStoredComment(
  comment: ChangeContextReviewCommentProjection['comment'],
): ChangeContextReviewCommentProjection {
  return {
    comment,
    anchorState: 'unavailable',
    anchorIssues: [{
      code: 'not_implemented',
      message: 'Anchor freshness projection is implemented by TF-0615; the stored anchor is unchanged.',
      source: 'review-store',
    }],
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

export function createChangeContextApi(
  context: ChangeContextApiContext = {},
): CompleteHostServiceRegistry['changeContext'] {
  const store = context.store ?? createChangeContextReviewCommentStore();
  const createRequestId = context.createRequestId ?? (() => randomUUID());

  return {
    getProjection: async (payload) => {
      const requestId = createRequestId();
      void payload;
      return {
        success: false,
        error: errorEnvelope(
          requestId,
          'not_implemented',
          'Change Context projection is contract-only in TF-0613; TF-0614 owns the read-only projection.',
        ),
      };
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
      const comments = result.value.comments.map(projectStoredComment);
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

    submitVerdict: async (payload) => {
      const requestId = createRequestId();
      void payload;
      return {
        success: false,
        error: errorEnvelope(
          requestId,
          'not_implemented',
          'Review verdict is contract-only in TF-0613; TF-0616 owns verdict and Task Ledger linkage.',
        ),
      };
    },

    pullChanges: async (payload) => {
      const requestId = createRequestId();
      void payload;
      return {
        success: false,
        state: 'unavailable',
        destinationMutated: false,
        error: errorEnvelope(
          requestId,
          'not_implemented',
          'Pull Changes is contract-only in TF-0613; TF-0616 owns the controlled apply path.',
        ),
      };
    },
  };
}

export type ChangeContextReviewCommentStoreOwner = Pick<
  ChangeContextReviewCommentStorePolicy,
  'owner' | 'authority'
>;
