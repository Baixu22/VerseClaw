import {
  REMOTE_FORGE_ERROR_SCHEMA,
  REMOTE_FORGE_SAFE_MESSAGES,
  decodeRemoteForgeErrorV1,
  isRemoteForgeRequestId,
  remoteForgeErrorIsRetryable,
  remoteForgeHttpStatusMatches,
  type RemoteForgeErrorCode,
  type RemoteForgeErrorV1,
} from '../types/remote-forge.js';

const FALLBACK_REQUEST_ID = 'remote-forge-unattributed';

function validHttpStatus(code: RemoteForgeErrorCode, value: unknown): number | undefined {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= 100
    && value <= 599
    && remoteForgeHttpStatusMatches(code, value)
    ? value
    : undefined;
}

export function createRemoteForgeErrorV1(input: {
  code: RemoteForgeErrorCode;
  requestId?: unknown;
  httpStatus?: unknown;
}): RemoteForgeErrorV1 {
  const httpStatus = validHttpStatus(input.code, input.httpStatus);
  return {
    schema: REMOTE_FORGE_ERROR_SCHEMA,
    code: input.code,
    retryable: remoteForgeErrorIsRetryable(input.code),
    requestId: isRemoteForgeRequestId(input.requestId) ? input.requestId : FALLBACK_REQUEST_ID,
    ...(httpStatus === undefined ? {} : { httpStatus }),
    safeMessage: REMOTE_FORGE_SAFE_MESSAGES[input.code],
  };
}

/**
 * Rebuilds an error from trusted enum/status metadata. Producer text is never
 * forwarded, even when the input otherwise satisfies the v1 decoder.
 */
export function normalizeRemoteForgeErrorV1(
  value: unknown,
  fallback: { requestId?: unknown; code?: RemoteForgeErrorCode } = {},
): RemoteForgeErrorV1 {
  const decoded = decodeRemoteForgeErrorV1(value);
  if (!decoded.ok) {
    return createRemoteForgeErrorV1({
      code: fallback.code ?? 'unknown',
      requestId: fallback.requestId,
    });
  }
  return createRemoteForgeErrorV1({
    code: decoded.value.code,
    requestId: decoded.value.requestId,
    httpStatus: decoded.value.httpStatus,
  });
}

export function remoteForgeErrorMessage(value: unknown): string {
  return normalizeRemoteForgeErrorV1(value).safeMessage;
}
