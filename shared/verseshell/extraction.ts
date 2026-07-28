import { VerseShellContractError } from './errors';
import type { JsonObject, JsonValue, Observation } from './types';

export const VERSESHELL_ARTIFACT_HANDLE_PATTERN = /^result:\/\/sha256\/[0-9a-f]{64}$/u;
export const VERSESHELL_APPROVAL_TOKEN_PATTERN = /^apv_[0-9a-f]{16}$/u;

export interface ApprovalRequest {
  approval_token: string;
  what: string;
  builtin: string;
  reversible: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isArtifactHandle(value: unknown): value is string {
  return typeof value === 'string' && VERSESHELL_ARTIFACT_HANDLE_PATTERN.test(value);
}

export function parseArtifactHandle(value: unknown): string {
  if (!isArtifactHandle(value)) {
    throw new VerseShellContractError(
      'invalid_shape',
      'artifact handle must match result://sha256/<64 lowercase hex characters>',
      { path: '$artifact', actual: value },
    );
  }
  return value;
}

/** Walk only validated observation JSON and return unique handles in encounter order. */
export function extractArtifactHandles(observation: Observation): string[] {
  const handles: string[] = [];
  const seen = new Set<string>();
  const visit = (value: JsonValue | undefined): void => {
    if (value === undefined || value === null) return;
    if (typeof value === 'string') {
      if (value.startsWith('result://') && !isArtifactHandle(value)) {
        throw new VerseShellContractError('invalid_shape', 'malformed result artifact handle', {
          path: '$observation.data',
          actual: value,
        });
      }
      if (isArtifactHandle(value) && !seen.has(value)) {
        seen.add(value);
        handles.push(value);
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value === 'object') Object.values(value).forEach(visit);
  };
  visit(observation.data);
  observation.suggested_next?.forEach((action) => visit(action.args));
  return handles;
}

export function extractApprovalRequest(observation: Observation): ApprovalRequest | undefined {
  if (observation.ok || observation.error?.code !== 'E_NEEDS_APPROVAL') return undefined;
  if (!isRecord(observation.data)) {
    throw new VerseShellContractError('invalid_shape', 'approval observation data must be an object', {
      path: '$observation.data',
      actual: observation.data,
    });
  }
  const data = observation.data;
  const token = data.approval_token;
  if (typeof token !== 'string' || !VERSESHELL_APPROVAL_TOKEN_PATTERN.test(token)) {
    throw new VerseShellContractError('invalid_shape', 'approval_token is malformed', {
      path: '$observation.data.approval_token',
      actual: token,
    });
  }
  if (typeof data.what !== 'string' || typeof data.builtin !== 'string' || typeof data.reversible !== 'boolean') {
    throw new VerseShellContractError('invalid_shape', 'approval descriptor fields are malformed', {
      path: '$observation.data',
      actual: data,
    });
  }
  return {
    approval_token: token,
    what: data.what,
    builtin: data.builtin,
    reversible: data.reversible,
  };
}

/** Produce a logging-safe clone without mutating the observation used for retry. */
export function redactApprovalSecrets(observation: Observation): Observation {
  const redact = (value: JsonValue | undefined): JsonValue | undefined => {
    if (value === undefined || value === null || typeof value === 'boolean' || typeof value === 'number') {
      return value;
    }
    if (typeof value === 'string') {
      return VERSESHELL_APPROVAL_TOKEN_PATTERN.test(value) ? '[REDACTED_APPROVAL_TOKEN]' : value;
    }
    if (Array.isArray(value)) return value.map((entry) => redact(entry) as JsonValue);
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        key === 'approval_token' || key === 'token'
          ? '[REDACTED_APPROVAL_TOKEN]'
          : (redact(entry) as JsonValue),
      ]),
    ) as JsonObject;
  };

  return {
    ...observation,
    data: redact(observation.data),
    error: observation.error
      ? {
          ...observation.error,
          hint: observation.error.hint?.replace(/apv_[0-9a-f]{16}/gu, '[REDACTED_APPROVAL_TOKEN]'),
          fix: observation.error.fix
            ? { ...observation.error.fix, args: redact(observation.error.fix.args) }
            : undefined,
        }
      : undefined,
    suggested_next: observation.suggested_next?.map((action) => ({
      ...action,
      args: redact(action.args) as JsonValue,
    })),
  };
}
