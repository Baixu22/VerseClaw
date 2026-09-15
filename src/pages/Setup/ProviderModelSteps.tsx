/**
 * FP-P1-01: Setup wizard Provider + Model verification steps.
 *
 * Reuses the Settings provider stack (useProviderStore actions →
 * electron providers-api → provider-validation real network probes) instead of
 * reimplementing validation. Setup only declares a provider "verified" after
 * (a) a live credential validation and (b) the chosen model appearing in the
 * provider's live model listing. The sanitized outcome (never key material)
 * is persisted via settings.setupProviderVerification and on the provider
 * account's metadata.validation.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, ChevronDown, ExternalLink, Loader2, RefreshCw, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useProviderStore } from '@/stores/providers';
import { useSettingsStore } from '@/stores/settings';
import {
  PROVIDER_TYPE_INFO,
  resolveProviderApiKeyForSave,
  type ProviderAccount,
  type ProviderType,
} from '@/lib/providers';
import { buildProviderAccountId } from '@/lib/provider-accounts';
import { providerIcons } from '@/assets/providers';
import {
  classifyProviderValidationError,
  type ProviderValidationFailureClass,
} from '@/lib/setup-provider';

/** Vendors offered during first-run setup (all support key or local auth). */
const SETUP_VENDOR_IDS: ProviderType[] = [
  'anthropic',
  'openai',
  'google',
  'deepseek',
  'moonshot',
  'openrouter',
  'siliconflow',
  'ark',
  'ollama',
  'custom',
];

export type PendingProviderSetup = {
  accountId: string;
  vendorId: ProviderType;
  label: string;
  baseUrl?: string;
  apiProtocol?: ProviderAccount['apiProtocol'];
};

type ValidationState =
  | { phase: 'idle' }
  | { phase: 'validating' }
  | { phase: 'valid'; durationMs?: number }
  | { phase: 'failed'; failure: ProviderValidationFailureClass; rawError?: string };

interface ProviderStepContentProps {
  pending: PendingProviderSetup | null;
  onValidated: (pending: PendingProviderSetup | null) => void;
}

/**
 * Vendor brand mark.
 *
 * src/assets/providers/ already ships real brand SVGs, but nothing consumed
 * them — PROVIDER_TYPE_INFO carries emoji (🤖 / 💚 / 🔷) and that is what the
 * picker rendered. This resolves the SVG per vendor and keeps the emoji as a
 * fallback for any vendor without one.
 *
 * The lookup lives here rather than in src/lib/providers.ts on purpose: that
 * module's `icon` field is also read by Settings (ProvidersSettings.tsx:1550),
 * so retyping it would push this change well past the setup wizard.
 */
function ProviderMark({
  vendorId,
  name,
  fallback,
}: {
  vendorId: string;
  name: string;
  fallback?: unknown;
}) {
  const src = providerIcons[vendorId];
  if (!src) {
    return <span className="text-base">{typeof fallback === 'string' ? fallback : '∙'}</span>;
  }
  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      data-testid={`setup-provider-mark-${vendorId}`}
      title={name}
      className="h-4 w-4 shrink-0 object-contain"
    />
  );
}

export function ProviderStepContent({ pending, onValidated }: ProviderStepContentProps) {
  const { t } = useTranslation('setup');
  const accounts = useProviderStore((s) => s.accounts);
  const statuses = useProviderStore((s) => s.statuses);
  const refreshProviderSnapshot = useProviderStore((s) => s.refreshProviderSnapshot);
  const validateAccountApiKey = useProviderStore((s) => s.validateAccountApiKey);
  const createAccount = useProviderStore((s) => s.createAccount);

  const [selectedType, setSelectedType] = useState<ProviderType | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [validation, setValidation] = useState<ValidationState>({ phase: 'idle' });
  const [useExistingId, setUseExistingId] = useState<string | null>(null);
  const validationGeneration = useRef(0);
  useEffect(() => () => { validationGeneration.current += 1; }, []);

  useEffect(() => {
    void refreshProviderSnapshot();
  }, [refreshProviderSnapshot]);

  const typeInfo = useMemo(
    () => PROVIDER_TYPE_INFO.find((info) => info.id === selectedType),
    [selectedType],
  );

  const keyedAccounts = useMemo(() => {
    const hasKey = new Set(statuses.filter((s) => s.hasKey).map((s) => s.id));
    return accounts.filter(
      (account) =>
        account.enabled !== false &&
        (hasKey.has(account.id) || (account.authMode && account.authMode !== 'api_key')),
    );
  }, [accounts, statuses]);

  const setupVendors = useMemo(
    () => SETUP_VENDOR_IDS
      .map((id) => PROVIDER_TYPE_INFO.find((info) => info.id === id))
      .filter((info): info is NonNullable<typeof info> => Boolean(info)),
    [],
  );

  const resetValidation = useCallback(() => {
    validationGeneration.current += 1;
    setValidation({ phase: 'idle' });
    onValidated(null);
  }, [onValidated]);

  const requiresApiKey = typeInfo?.requiresApiKey ?? true;

  const handleValidateNew = async () => {
    if (!selectedType || !typeInfo) return;
    const generation = ++validationGeneration.current;
    const effectiveBaseUrl = baseUrl.trim() || typeInfo.defaultBaseUrl;
    const failureFromEmpty = classifyProviderValidationError({
      apiKeyPresent: apiKey.trim().length > 0,
      requiresApiKey,
    });
    if (requiresApiKey && failureFromEmpty === 'not-filled') {
      setValidation({ phase: 'failed', failure: 'not-filled' });
      onValidated(null);
      return;
    }
    if (selectedType === 'custom' && !effectiveBaseUrl) {
      setValidation({ phase: 'failed', failure: 'not-filled' });
      onValidated(null);
      return;
    }
    setValidation({ phase: 'validating' });
    onValidated(null);
    const result = await validateAccountApiKey(selectedType, apiKey.trim() || undefined, {
      baseUrl: effectiveBaseUrl,
    });
    if (generation !== validationGeneration.current) return;
    if (!result.valid) {
      setValidation({
        phase: 'failed',
        failure: classifyProviderValidationError({
          apiKeyPresent: apiKey.trim().length > 0,
          requiresApiKey,
          error: result.error,
        }),
        rawError: result.error,
      });
      return;
    }
    // Credential is live-verified — create the account now so the Model step
    // can list models against the stored key.
    const vendors = useProviderStore.getState().vendors;
    const id = buildProviderAccountId(selectedType, null, vendors);
    const effectiveApiKey = resolveProviderApiKeyForSave(selectedType, apiKey.trim());
    try {
      await createAccount(
        {
          id,
          vendorId: selectedType,
          label: typeInfo.name,
          authMode: selectedType === 'ollama' ? 'local' : 'api_key',
          baseUrl: effectiveBaseUrl,
          model: typeInfo.defaultModelId,
          enabled: true,
          isDefault: false,
          metadata: {
            validation: {
              status: 'valid',
              checkedAt: new Date().toISOString(),
              source: 'setup',
            },
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        effectiveApiKey,
      );
    } catch (error) {
      if (generation !== validationGeneration.current) return;
      setValidation({ phase: 'failed', failure: 'service', rawError: String(error) });
      return;
    }
    if (generation !== validationGeneration.current) return;
    setValidation({ phase: 'valid', durationMs: result.durationMs });
    onValidated({
      accountId: id,
      vendorId: selectedType,
      label: typeInfo.name,
      baseUrl: effectiveBaseUrl,
    });
  };

  const handleValidateExisting = async (account: ProviderAccount) => {
    const generation = ++validationGeneration.current;
    setUseExistingId(account.id);
    setValidation({ phase: 'validating' });
    onValidated(null);
    const result = await validateAccountApiKey(account.id, undefined, {
      baseUrl: account.baseUrl,
      apiProtocol: account.apiProtocol,
    });
    if (generation !== validationGeneration.current) return;
    if (!result.valid) {
      setValidation({
        phase: 'failed',
        failure: classifyProviderValidationError({
          apiKeyPresent: true,
          requiresApiKey: true,
          error: result.error,
        }),
        rawError: result.error,
      });
      return;
    }
    setValidation({ phase: 'valid', durationMs: result.durationMs });
    onValidated({
      accountId: account.id,
      vendorId: account.vendorId,
      label: account.label,
      baseUrl: account.baseUrl,
      apiProtocol: account.apiProtocol,
    });
  };

  const failureCopy = (failure: ProviderValidationFailureClass, rawError?: string) => (
    <div
      data-testid={`setup-provider-error-${failure}`}
      className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm"
    >
      <p className="font-medium text-red-700 dark:text-red-300">
        {t(`provider.errors.${failure}.title`)}
      </p>
      <p className="mt-1 text-muted-foreground">{t(`provider.errors.${failure}.action`)}</p>
      {rawError && failure !== 'not-filled' && (
        <p className="mt-1 break-all font-mono text-xs text-muted-foreground/70">{rawError}</p>
      )}
    </div>
  );

  return (
    <div data-testid="setup-provider-step" className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('provider.stepIntro')}</p>

      {keyedAccounts.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">{t('provider.existing.title')}</p>
          {keyedAccounts.map((account) => (
            <div
              key={account.id}
              className="flex items-center justify-between rounded-lg bg-surface-input/50 p-3"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{account.label}</p>
                <p className="text-xs text-muted-foreground">{account.vendorId}</p>
              </div>
              <Button
                data-testid={`setup-provider-use-existing-${account.id}`}
                size="sm"
                variant="outline"
                disabled={validation.phase === 'validating'}
                onClick={() => void handleValidateExisting(account)}
              >
                {validation.phase === 'validating' && useExistingId === account.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  t('provider.existing.useThis')
                )}
              </Button>
            </div>
          ))}
          <div className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
            <ChevronDown className="h-3 w-3" />
            {t('provider.existing.orNew')}
          </div>
        </div>
      )}

      {/* Vendor picker */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {setupVendors.map((info) => (
          <button
            key={info.id}
            type="button"
            data-testid={`setup-provider-vendor-${info.id}`}
            onClick={() => {
              setSelectedType(info.id);
              setBaseUrl('');
              setApiKey('');
              setUseExistingId(null);
              resetValidation();
            }}
            className={cn(
              'setup-frame flex items-center gap-2 rounded-lg border p-3 text-left text-sm transition-colors',
              selectedType === info.id
                ? 'setup-frame--on border-primary bg-primary/5'
                : 'border-border hover:bg-surface-input/50',
            )}
          >
            <ProviderMark vendorId={info.id} name={info.name} fallback={info.icon} />
            <span className="truncate">{info.name}</span>
          </button>
        ))}
      </div>

      {typeInfo && (
        <div className="space-y-3">
          {requiresApiKey && (
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="setup-provider-api-key">
                {t('provider.apiKey')}
              </label>
              <Input
                id="setup-provider-api-key"
                data-testid="setup-provider-api-key"
                type="password"
                autoComplete="off"
                value={apiKey}
                placeholder={typeInfo.placeholder}
                onChange={(event) => {
                  setApiKey(event.target.value);
                  resetValidation();
                }}
              />
              <p className="text-xs text-muted-foreground">{t('provider.storedLocally')}</p>
            </div>
          )}
          {(typeInfo.showBaseUrl || typeInfo.id === 'custom') && (
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="setup-provider-base-url">
                {t('provider.baseUrl')}
              </label>
              <Input
                id="setup-provider-base-url"
                data-testid="setup-provider-base-url"
                value={baseUrl}
                placeholder={typeInfo.defaultBaseUrl || 'https://…/v1'}
                onChange={(event) => {
                  setBaseUrl(event.target.value);
                  resetValidation();
                }}
              />
            </div>
          )}
          {typeInfo.apiKeyUrl && (
            <a
              className="inline-flex items-center gap-1 text-xs text-muted-foreground underline"
              href={typeInfo.apiKeyUrl}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink className="h-3 w-3" />
              {t('provider.getKey')}
            </a>
          )}
          <div className="flex items-center gap-3">
            <Button
              data-testid="setup-provider-validate"
              disabled={validation.phase === 'validating'}
              onClick={() => void handleValidateNew()}
            >
              {validation.phase === 'validating' ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('provider.validating')}
                </>
              ) : (
                t('provider.validateButton')
              )}
            </Button>
            {validation.phase === 'valid' && (
              <span
                data-testid="setup-provider-validated"
                className="flex items-center gap-1 text-sm text-green-700 dark:text-green-400"
              >
                <CheckCircle2 className="h-4 w-4" />
                {t('provider.validated')}
              </span>
            )}
          </div>
        </div>
      )}

      {validation.phase === 'failed' && failureCopy(validation.failure, validation.rawError)}

      {pending && validation.phase === 'valid' && (
        <p className="text-sm text-muted-foreground">
          {t('provider.readyHint', { label: pending.label })}
        </p>
      )}
    </div>
  );
}

interface ModelStepContentProps {
  pending: PendingProviderSetup | null;
  onVerified: (verified: { model: string } | null) => void;
}

export function ModelStepContent({ pending, onVerified }: ModelStepContentProps) {
  const { t } = useTranslation('setup');
  const listAccountModels = useProviderStore((s) => s.listAccountModels);
  const updateAccount = useProviderStore((s) => s.updateAccount);
  const setDefaultAccount = useProviderStore((s) => s.setDefaultAccount);
  const setSetupProviderVerification = useSettingsStore((s) => s.setSetupProviderVerification);

  const [models, setModels] = useState<string[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmedModel, setConfirmedModel] = useState<string | null>(null);
  const loadedForAccount = useRef<string | null>(null);
  const mounted = useRef(false);
  const listGeneration = useRef(0);
  const confirmationGeneration = useRef(0);
  const confirmationInFlight = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const loadModels = useCallback(async () => {
    const generation = ++listGeneration.current;
    confirmationGeneration.current += 1;
    setSelectedModel(null);
    setConfirmedModel(null);
    onVerified(null);
    if (!pending) {
      setModels(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setListError(null);
    setModels(null);
    try {
      const result = await listAccountModels(pending.accountId, undefined, {
        baseUrl: pending.baseUrl,
        apiProtocol: pending.apiProtocol,
      });
      if (!mounted.current || generation !== listGeneration.current) return;
      if (!result.success) {
        setListError(result.error || 'model listing failed');
        return;
      }
      setModels(result.models);
    } catch (error) {
      if (mounted.current && generation === listGeneration.current) setListError(String(error));
    } finally {
      if (mounted.current && generation === listGeneration.current) setLoading(false);
    }
  }, [pending, listAccountModels, onVerified]);

  useEffect(() => {
    const accountKey = pending ? JSON.stringify([pending.accountId, pending.baseUrl, pending.apiProtocol]) : null;
    if (loadedForAccount.current === accountKey) return;
    loadedForAccount.current = accountKey;
    void loadModels();
  }, [pending, loadModels]);

  const handleConfirm = async () => {
    if (!pending || !selectedModel || !models?.includes(selectedModel) || confirmationInFlight.current) return;
    confirmationInFlight.current = true;
    const generation = ++confirmationGeneration.current;
    const isCurrent = () => mounted.current && generation === confirmationGeneration.current;
    setConfirming(true);
    try {
      const account = useProviderStore
        .getState()
        .accounts.find((entry) => entry.id === pending.accountId);
      const checkedAt = new Date().toISOString();
      await updateAccount(pending.accountId, {
        model: selectedModel,
        metadata: {
          ...account?.metadata,
          validation: {
            status: 'valid',
            checkedAt,
            model: selectedModel,
            source: 'setup',
          },
        },
      });
      if (!isCurrent()) return;
      await setDefaultAccount(pending.accountId);
      if (!isCurrent()) return;
      setSetupProviderVerification({
        status: 'verified',
        accountId: pending.accountId,
        vendorId: pending.vendorId,
        model: selectedModel,
        checkedAt,
      });
      setConfirmedModel(selectedModel);
      onVerified({ model: selectedModel });
    } catch (error) {
      if (isCurrent()) {
        setListError(String(error));
        onVerified(null);
      }
    } finally {
      confirmationInFlight.current = false;
      if (mounted.current) setConfirming(false);
    }
  };

  if (!pending) {
    return (
      <p data-testid="setup-model-no-provider" className="text-sm text-muted-foreground">
        {t('model.noProvider')}
      </p>
    );
  }

  return (
    <div data-testid="setup-model-step" className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t('model.stepIntro', { label: pending.label })}
      </p>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('model.loading')}
        </div>
      )}

      {listError && (
        <div
          data-testid="setup-model-list-error"
          className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm"
        >
          <p className="flex items-center gap-1 font-medium text-red-700 dark:text-red-300">
            <XCircle className="h-4 w-4" />
            {t('model.listFailed.title')}
          </p>
          <p className="mt-1 text-muted-foreground">{t('model.listFailed.action')}</p>
          <p className="mt-1 break-all font-mono text-xs text-muted-foreground/70">{listError}</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={() => void loadModels()}>
            <RefreshCw className="mr-1 h-3 w-3" />
            {t('model.retry')}
          </Button>
        </div>
      )}

      {models && models.length === 0 && (
        <p data-testid="setup-model-empty" className="text-sm text-muted-foreground">
          {t('model.empty')}
        </p>
      )}

      {models && models.length > 0 && (
        <div className="max-h-56 space-y-1 overflow-y-auto">
          {models.slice(0, 60).map((model) => (
            <button
              key={model}
              type="button"
              data-testid={`setup-model-option-${model}`}
              onClick={() => {
                confirmationGeneration.current += 1;
                setSelectedModel(model);
                setConfirmedModel(null);
                onVerified(null);
              }}
              className={cn(
                'setup-frame flex w-full items-center justify-between rounded-lg border p-2 text-left text-sm',
                selectedModel === model
                  ? 'setup-frame--on border-primary bg-primary/5'
                  : 'border-border hover:bg-surface-input/50',
              )}
            >
              <span className="truncate font-mono">{model}</span>
              {confirmedModel === model && (
                <CheckCircle2 className="h-4 w-4 text-green-700 dark:text-green-400" />
              )}
            </button>
          ))}
        </div>
      )}

      {models && models.length > 0 && (
        <div className="flex items-center gap-3">
          <Button
            data-testid="setup-model-confirm"
            disabled={!selectedModel || confirming}
            onClick={() => void handleConfirm()}
          >
            {confirming ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('model.confirming')}
              </>
            ) : (
              t('model.confirm')
            )}
          </Button>
          {confirmedModel && (
            <span
              data-testid="setup-model-verified"
              className="flex items-center gap-1 text-sm text-green-700 dark:text-green-400"
            >
              <CheckCircle2 className="h-4 w-4" />
              {t('model.verifiedAs', { model: confirmedModel })}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
