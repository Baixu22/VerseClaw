/**
 * R2: unified renderer error exit.
 *
 * Three-layer separation (maturity report §错误反馈与隐私):
 *  1. user copy   — localized "what happened / whose problem / what next",
 *                   never stack frames or secret shapes;
 *  2. errorId     — short reference the user can copy into a report;
 *  3. dev log     — the raw AppError goes to the console keyed by errorId.
 *
 * All copy comes from the shared `common` i18n catalogue; nothing here is a
 * hardcoded display string (issue #120).
 */
import { toast } from 'sonner';
import i18n from '@/i18n';
import { normalizeAppError, type AppErrorCode } from './error-model';
import { getErrorCopy, toUserMessage, type ErrorActionKind } from './error-message';
import { sanitizeUiErrorText } from '@shared/privacy/ui-error-sanitize';

let errorIdSeq = 0;

export function makeErrorId(): string {
  errorIdSeq += 1;
  return `err-${Date.now().toString(36)}-${errorIdSeq.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export type UserErrorDetails = {
  /** Safe, localized user-facing message ("what happened"). */
  message: string;
  /** Copyable reference for reports; keys the raw error in the dev console. */
  errorId: string;
  code: AppErrorCode;
  /** True when retrying the same action is meaningful with no other change. */
  retryable: boolean;
  /** Which recovery affordance the UI should offer for this class. */
  action: ErrorActionKind;
  /** i18n keys, so callers and tests can assert without pinning prose. */
  messageKey: string;
  /** Localized "whose problem". */
  responsibility: string;
  responsibilityKey: string;
  /** Localized "what to do next". */
  nextStep: string;
  nextStepKey: string;
};

export function describeUserError(error: unknown, options: { log?: boolean } = {}): UserErrorDetails {
  const appError = normalizeAppError(error);
  const copy = getErrorCopy(appError.code);
  const message = sanitizeUiErrorText(toUserMessage(appError));
  const errorId = appError.requestId ?? makeErrorId();
  if (options.log !== false) {
    // Dev log keeps the full classified error; the UI only ever sees message + id.
    console.error(`[user-error ${errorId}]`, appError);
  }
  return {
    message,
    errorId,
    code: appError.code,
    retryable: copy.retryable,
    action: copy.action,
    messageKey: copy.messageKey,
    responsibility: i18n.t(copy.responsibilityKey),
    responsibilityKey: copy.responsibilityKey,
    nextStep: i18n.t(copy.nextStepKey),
    nextStepKey: copy.nextStepKey,
  };
}

/** One-liner safe message for i18n interpolation sites. */
export function errorMessageFrom(error: unknown): string {
  return describeUserError(error, { log: false }).message;
}

/** Toast the message plus responsibility/next step and the error reference. */
export function toastUserError(error: unknown, options: { fallback?: string } = {}): UserErrorDetails {
  const details = describeUserError(error);
  const message = options.fallback && details.code === 'UNKNOWN'
    ? `${options.fallback} — ${details.message}`
    : details.message;
  toast.error(message, {
    description: `${details.responsibility} — ${details.nextStep} — `
      + `${i18n.t('common:errorBoundary.errorReference')} ${details.errorId}`,
  });
  return details;
}
