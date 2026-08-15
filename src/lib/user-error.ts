/**
 * R2: unified renderer error exit.
 *
 * Three-layer separation (maturity report §错误反馈与隐私):
 *  1. user copy   — sanitized message, never stack frames or secret shapes;
 *  2. errorId     — short reference the user can copy into a report;
 *  3. dev log     — the raw AppError goes to the console keyed by errorId.
 */
import { toast } from 'sonner';
import i18n from '@/i18n';
import { normalizeAppError, type AppErrorCode } from './error-model';
import { toUserMessage } from './error-message';
import { sanitizeUiErrorText } from '@shared/privacy/ui-error-sanitize';

let errorIdSeq = 0;

export function makeErrorId(): string {
  errorIdSeq += 1;
  return `err-${Date.now().toString(36)}-${errorIdSeq.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export type UserErrorDetails = {
  /** Safe user-facing message. */
  message: string;
  /** Copyable reference for reports; keys the raw error in the dev console. */
  errorId: string;
  code: AppErrorCode;
  /** True when retrying the same action is meaningful. */
  retryable: boolean;
};

const RETRYABLE_CODES = new Set<AppErrorCode>([
  'NETWORK',
  'GATEWAY',
  'TIMEOUT',
  'CHANNEL_UNAVAILABLE',
]);

export function describeUserError(error: unknown, options: { log?: boolean } = {}): UserErrorDetails {
  const appError = normalizeAppError(error);
  const message = sanitizeUiErrorText(toUserMessage(appError));
  const errorId = makeErrorId();
  if (options.log !== false) {
    // Dev log keeps the full classified error; the UI only ever sees message + id.
    console.error(`[user-error ${errorId}]`, appError);
  }
  return {
    message,
    errorId,
    code: appError.code,
    retryable: RETRYABLE_CODES.has(appError.code),
  };
}

/** One-liner safe message for i18n interpolation sites. */
export function errorMessageFrom(error: unknown): string {
  return describeUserError(error, { log: false }).message;
}

/** Toast a safe message plus the error reference; returns the details for UI state. */
export function toastUserError(error: unknown, options: { fallback?: string } = {}): UserErrorDetails {
  const details = describeUserError(error);
  const message = options.fallback && details.code === 'UNKNOWN'
    ? `${options.fallback} — ${details.message}`
    : details.message;
  toast.error(message, {
    description: `${i18n.t('common:errorBoundary.errorReference')} ${details.errorId}`,
  });
  return details;
}
