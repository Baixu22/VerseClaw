import i18n from '@/i18n';
import { sanitizeUiErrorText } from '@shared/privacy/ui-error-sanitize';
import { AppError, normalizeAppError, type AppErrorCode } from './error-model';

export { AppError } from './error-model';

/**
 * Recovery affordance offered next to the message.
 *
 * `retry_now` is deliberately rare: a timeout may already have produced an
 * upstream side effect (`verify_then_retry`), a rate limit or overloaded
 * provider needs waiting first (`wait_then_retry`), and refusal/balance classes
 * never recover by retrying at all — they need an account or credential change.
 */
export type ErrorActionKind =
  | 'retry_now'
  | 'wait_then_retry'
  | 'verify_then_retry'
  | 'fix_credentials'
  | 'top_up_balance'
  | 'choose_another_model'
  | 'start_new_session'
  | 'review_settings'
  | 'restart_service'
  | 'none';

export type AppErrorCopy = {
  /** `common` namespace key for "what happened". */
  messageKey: string;
  /** `common` namespace key for "whose problem". */
  responsibilityKey: string;
  /** `common` namespace key for "what to do next". */
  nextStepKey: string;
  action: ErrorActionKind;
  /** True only when retrying the same action can succeed with no other change. */
  retryable: boolean;
};

/**
 * Stable key scheme for every class: `common:errors.<slug>.{what,responsibility,nextStep}`.
 * Slugs are the lower-case class name; all four locales must carry all three keys.
 */
function errorCopyKeys(slug: string): Pick<AppErrorCopy, 'messageKey' | 'responsibilityKey' | 'nextStepKey'> {
  return {
    messageKey: `common:errors.${slug}.what`,
    responsibilityKey: `common:errors.${slug}.responsibility`,
    nextStepKey: `common:errors.${slug}.nextStep`,
  };
}

const ERROR_COPY: Record<AppErrorCode, AppErrorCopy> = {
  AUTH_INVALID: { ...errorCopyKeys('auth_invalid'), action: 'fix_credentials', retryable: false },
  AUTH_PERMANENT: { ...errorCopyKeys('auth_permanent'), action: 'fix_credentials', retryable: false },
  TIMEOUT: { ...errorCopyKeys('timeout'), action: 'verify_then_retry', retryable: true },
  RATE_LIMIT: { ...errorCopyKeys('rate_limit'), action: 'wait_then_retry', retryable: true },
  PERMISSION: { ...errorCopyKeys('permission'), action: 'review_settings', retryable: false },
  CHANNEL_UNAVAILABLE: { ...errorCopyKeys('channel_unavailable'), action: 'restart_service', retryable: true },
  CONVERSATION_STATE: { ...errorCopyKeys('conversation_state'), action: 'start_new_session', retryable: false },
  NETWORK: { ...errorCopyKeys('network'), action: 'retry_now', retryable: true },
  CONFIG: { ...errorCopyKeys('config'), action: 'review_settings', retryable: false },
  GATEWAY: { ...errorCopyKeys('gateway'), action: 'restart_service', retryable: true },
  BILLING: { ...errorCopyKeys('billing'), action: 'top_up_balance', retryable: false },
  OVERLOADED: { ...errorCopyKeys('overloaded'), action: 'wait_then_retry', retryable: true },
  MODEL_NOT_FOUND: { ...errorCopyKeys('model_not_found'), action: 'choose_another_model', retryable: false },
  UNKNOWN: { ...errorCopyKeys('unknown'), action: 'none', retryable: false },
};

export function getErrorCopy(code: AppErrorCode): AppErrorCopy {
  return ERROR_COPY[code];
}

/**
 * Localized "what happened" line. Resolved through the existing renderer
 * i18next instance so it follows the active language (issue #120).
 */
export function toUserMessage(error: unknown): string {
  const appError = error instanceof AppError ? error : normalizeAppError(error);

  if (appError.code !== 'UNKNOWN') {
    return i18n.t(getErrorCopy(appError.code).messageKey);
  }

  // R2: the UNKNOWN branch must stay inside the sanitize boundary —
  // raw backend messages may carry paths, stack frames or secret shapes.
  const redacted = appError.message ? sanitizeUiErrorText(appError.message) : '';
  return redacted || i18n.t(getErrorCopy('UNKNOWN').messageKey);
}
