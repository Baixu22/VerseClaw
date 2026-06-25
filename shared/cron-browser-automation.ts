import type {
  CronBrowserAutomationAuthPersistence,
  CronBrowserAutomationConfig,
  CronBrowserAutomationDiagnostics,
  CronBrowserAutomationMode,
  CronBrowserAutomationSensitiveActionPolicy,
  CronBrowserAutomationTemplate,
} from './types/cron';

const MARKER_START = '<!-- clawx:browser-automation';
const MARKER_END = '-->';

export const CRON_BROWSER_AUTOMATION_TOOL_ALLOW = ['agent_browser'] as const;

export const DEFAULT_CRON_BROWSER_AUTOMATION: Required<
  Pick<
    CronBrowserAutomationConfig,
    'template' | 'authPersistence' | 'mode' | 'sensitiveActionPolicy' | 'diagnostics'
  >
> & { retryOnTransientFailure: boolean } = {
  template: 'checkIn',
  authPersistence: 'session-name',
  mode: 'headless',
  sensitiveActionPolicy: 'draft-only',
  retryOnTransientFailure: true,
  diagnostics: {
    snapshot: true,
    console: true,
    errors: true,
    network: true,
    screenshot: true,
  },
};

function normalizeString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const normalized = value
    .map((entry) => normalizeString(entry))
    .filter((entry): entry is string => !!entry);
  return normalized.length > 0 ? Array.from(new Set(normalized)) : undefined;
}

function normalizeTemplate(value: unknown): CronBrowserAutomationTemplate | undefined {
  return value === 'checkIn' || value === 'monitor' || value === 'publishDraft' || value === 'custom'
    ? value
    : undefined;
}

function normalizeAuthPersistence(value: unknown): CronBrowserAutomationAuthPersistence | undefined {
  return value === 'session-name' || value === 'profile' || value === 'off' ? value : undefined;
}

function normalizeMode(value: unknown): CronBrowserAutomationMode | undefined {
  return value === 'headless' || value === 'visible' ? value : undefined;
}

function normalizeSensitiveActionPolicy(
  value: unknown,
): CronBrowserAutomationSensitiveActionPolicy | undefined {
  return value === 'draft-only' || value === 'auto-submit' ? value : undefined;
}

function normalizeDiagnostics(value: unknown): CronBrowserAutomationDiagnostics | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  return {
    snapshot: source.snapshot === undefined ? undefined : source.snapshot === true,
    console: source.console === undefined ? undefined : source.console === true,
    errors: source.errors === undefined ? undefined : source.errors === true,
    network: source.network === undefined ? undefined : source.network === true,
    screenshot: source.screenshot === undefined ? undefined : source.screenshot === true,
  };
}

export function normalizeCronBrowserAutomationConfig(
  input: unknown,
): CronBrowserAutomationConfig | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const source = input as Record<string, unknown>;
  const url = normalizeString(source.url);
  const objective = normalizeString(source.objective);
  if (!url || !objective) return null;
  return {
    url,
    objective,
    ...(normalizeString(source.successCondition)
      ? { successCondition: normalizeString(source.successCondition) }
      : {}),
    ...(normalizeString(source.failureCondition)
      ? { failureCondition: normalizeString(source.failureCondition) }
      : {}),
    template: normalizeTemplate(source.template) ?? DEFAULT_CRON_BROWSER_AUTOMATION.template,
    ...(normalizeString(source.profile) ? { profile: normalizeString(source.profile) } : {}),
    ...(normalizeString(source.authStateName)
      ? { authStateName: normalizeString(source.authStateName) }
      : {}),
    authPersistence:
      normalizeAuthPersistence(source.authPersistence) ??
      DEFAULT_CRON_BROWSER_AUTOMATION.authPersistence,
    mode: normalizeMode(source.mode) ?? DEFAULT_CRON_BROWSER_AUTOMATION.mode,
    ...(normalizeStringArray(source.allowedDomains)
      ? { allowedDomains: normalizeStringArray(source.allowedDomains) }
      : {}),
    sensitiveActionPolicy:
      normalizeSensitiveActionPolicy(source.sensitiveActionPolicy) ??
      DEFAULT_CRON_BROWSER_AUTOMATION.sensitiveActionPolicy,
    retryOnTransientFailure:
      source.retryOnTransientFailure === undefined
        ? DEFAULT_CRON_BROWSER_AUTOMATION.retryOnTransientFailure
        : source.retryOnTransientFailure === true,
    diagnostics: {
      ...DEFAULT_CRON_BROWSER_AUTOMATION.diagnostics,
      ...normalizeDiagnostics(source.diagnostics),
    },
  };
}

function templateInstruction(template: CronBrowserAutomationTemplate): string {
  switch (template) {
    case 'checkIn':
      return 'Treat this as a check-in/sign-in task: determine whether the account is already checked in, sign in only when needed, then report the final status.';
    case 'monitor':
      return 'Treat this as a page monitoring task: inspect the page state, compare it with the requested objective, and report what changed or failed.';
    case 'publishDraft':
      return 'Treat this as a publish/send task: prepare the content as a draft and verify it, but do not submit unless the sensitive action policy explicitly allows auto-submit.';
    case 'custom':
      return 'Treat this as a custom browser automation task and follow the objective exactly within the configured safety policy.';
  }
}

function enabledDiagnostics(diagnostics: CronBrowserAutomationDiagnostics | undefined): string[] {
  const source = { ...DEFAULT_CRON_BROWSER_AUTOMATION.diagnostics, ...diagnostics };
  return Object.entries(source)
    .filter(([, enabled]) => enabled)
    .map(([key]) => key);
}

function markerFor(config: CronBrowserAutomationConfig): string {
  return `${MARKER_START}\n${JSON.stringify(config, null, 2)}\n${MARKER_END}`;
}

export function buildCronBrowserAutomationPrompt(input: CronBrowserAutomationConfig): string {
  const config = normalizeCronBrowserAutomationConfig(input);
  if (!config) {
    throw new Error('Browser automation cron tasks require a URL and objective');
  }
  const diagnostics = enabledDiagnostics(config.diagnostics);
  const allowedDomains = config.allowedDomains?.length
    ? config.allowedDomains.join(', ')
    : 'the target URL origin only unless navigation is required by the page flow';
  const profile = config.profile || 'default';
  const authStateName = config.authStateName || profile;
  const autoSubmitAllowed = config.sensitiveActionPolicy === 'auto-submit';
  const retryInstruction = config.retryOnTransientFailure
    ? 'Transient failure retry: if open/navigate/page-load/wait-for-selector fails before any final sensitive action, retry that safe step once, then collect diagnostics if it still fails. Do not retry final send/publish/pay/delete/confirm actions.'
    : 'Transient failure retry: disabled. Do not repeat failed browser actions; collect diagnostics and report the failure.';

  return [
    'You are running a scheduled Agent OS Browser automation task inside Verse Claw.',
    '',
    'Use the agent_browser tool only. Start by opening the target URL with these browser settings:',
    `- url: ${config.url}`,
    `- mode: ${config.mode}`,
    `- profile: ${profile}`,
    `- authPersistence: ${config.authPersistence}`,
    `- authStateName: ${authStateName}`,
    '- connectionMode: managed',
    '',
    `Template: ${config.template}`,
    templateInstruction(config.template ?? DEFAULT_CRON_BROWSER_AUTOMATION.template),
    '',
    `Objective: ${config.objective}`,
    config.successCondition
      ? `Success condition: ${config.successCondition}`
      : 'Success condition: infer from the objective and page state; explicitly state the evidence you used.',
    config.failureCondition
      ? `Failure condition: ${config.failureCondition}`
      : 'Failure condition: login required, captcha/verification wall, missing expected page state, browser/tool error, or unsafe sensitive action.',
    '',
    `Allowed domains: ${allowedDomains}.`,
    autoSubmitAllowed
      ? 'Sensitive action policy: auto-submit is allowed for this scheduled job after you verify the target page, account, and final action.'
      : 'Sensitive action policy: draft-only. Do not click final send/publish/pay/delete/confirm buttons or change credentials; prepare and verify drafts instead.',
    retryInstruction,
    '',
    'Before acting, determine whether the user is logged in. If login is required, stop and report that the saved browser profile needs authentication.',
    'On success, return a concise result with final page state, actions taken, and evidence. On failure, read diagnostics and report the actionable error.',
    `Diagnostics to collect when useful: ${diagnostics.join(', ') || 'none'}.`,
    '',
    markerFor(config),
  ].join('\n');
}

export function parseCronBrowserAutomationPrompt(
  message: string,
): { config: CronBrowserAutomationConfig; messageWithoutMarker: string } | null {
  const start = message.indexOf(MARKER_START);
  if (start < 0) return null;
  const jsonStart = message.indexOf('\n', start);
  if (jsonStart < 0) return null;
  const end = message.indexOf(MARKER_END, jsonStart);
  if (end < 0) return null;
  const rawJson = message.slice(jsonStart + 1, end).trim();
  try {
    const parsed = JSON.parse(rawJson);
    const config = normalizeCronBrowserAutomationConfig(parsed);
    if (!config) return null;
    const before = message.slice(0, start).trim();
    const after = message.slice(end + MARKER_END.length).trim();
    return {
      config,
      messageWithoutMarker: [before, after].filter(Boolean).join('\n\n').trim(),
    };
  } catch {
    return null;
  }
}
