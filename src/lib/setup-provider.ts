/**
 * FP-P1-01: Setup provider/model verification helpers.
 *
 * Pure logic only (unit-testable): failure classification, readiness
 * derivation, and the sanitized verification record shape. No key material
 * ever enters these structures — they may end up in settings storage and the
 * FP-P1-06 support bundle.
 */
import type { ProviderAccount, ProviderWithKeyInfo } from '@/lib/providers';

/** Sanitized verification state persisted in app settings (no secrets). */
export type SetupProviderVerification = {
  status: 'unverified' | 'verified' | 'skipped';
  accountId?: string;
  vendorId?: string;
  model?: string;
  checkedAt?: string;
};

export const DEFAULT_SETUP_PROVIDER_VERIFICATION: SetupProviderVerification = {
  status: 'unverified',
};

export type ProviderValidationFailureClass =
  | 'not-filled'
  | 'credentials'
  | 'network'
  | 'service';

/**
 * Map a raw validation outcome to an operator-actionable failure class.
 * The UI translates each class into "what to change, where" copy instead of
 * surfacing the raw error string (AC: 校验失败给出可操作文案).
 */
export function classifyProviderValidationError(input: {
  apiKeyPresent: boolean;
  requiresApiKey: boolean;
  error?: string;
}): ProviderValidationFailureClass {
  if (input.requiresApiKey && !input.apiKeyPresent) return 'not-filled';
  const error = (input.error ?? '').toLowerCase();
  if (
    /(^|\D)(401|403)(\D|$)/.test(error) ||
    /invalid[ _-]?(api[ _-]?key|token|credential)|unauthorized|forbidden|incorrect api key|authentication|api key not valid/.test(
      error,
    )
  ) {
    return 'credentials';
  }
  if (
    /enotfound|econnrefused|etimedout|econnreset|eai_again|econnaborted|fetch failed|network|timed? ?out|socket|dns|abort/.test(
      error,
    )
  ) {
    return 'network';
  }
  return 'service';
}

/**
 * Whether the app has a provider that can actually serve a chat turn:
 * a default (or any enabled) account whose auth is satisfied — stored API key
 * for api_key mode, or a non-key auth mode (oauth/local).
 *
 * Used by the ChatInput first-send gate: when this is false, sending is
 * intercepted with guidance instead of failing downstream (AC: 主界面首次
 * 发消息前拦截并引导).
 */
export function isProviderRuntimeReady(input: {
  accounts: ProviderAccount[];
  statuses: ProviderWithKeyInfo[];
  defaultAccountId: string | null;
}): boolean {
  const { accounts, statuses, defaultAccountId } = input;
  const keyByAccount = new Map(statuses.map((status) => [status.id, status.hasKey === true]));
  const satisfies = (account: ProviderAccount): boolean => {
    if (account.enabled === false) return false;
    if (account.authMode && account.authMode !== 'api_key') return true;
    return keyByAccount.get(account.id) === true;
  };
  const defaultAccount = accounts.find((account) => account.id === defaultAccountId);
  if (defaultAccount) return satisfies(defaultAccount);
  return accounts.some(satisfies);
}

/**
 * Whether Setup may declare Complete as fully verified. Anything else that
 * finishes Setup must carry status 'skipped' and show the limited-mode notice.
 */
export function isSetupVerificationComplete(
  verification: SetupProviderVerification | undefined,
): boolean {
  return (
    verification?.status === 'verified' &&
    typeof verification.accountId === 'string' &&
    verification.accountId.length > 0 &&
    typeof verification.model === 'string' &&
    verification.model.length > 0
  );
}
