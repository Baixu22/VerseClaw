/**
 * Issue #120: after switching language, provider failures must render in the
 * active language. The unified error exit (`AppError` -> `toUserMessage` /
 * `describeUserError` -> toast) must have no English fallback for the
 * high-frequency classes (auth / rate limit / balance / timeout).
 *
 * Synthetic failures are injected at the Main boundary (`host:invoke`) so the
 * renderer exercises its real error path end to end. Note: `host-api-client.ts`
 * currently forwards only `error.message` to the renderer (structured-error
 * retention, issue #118), so this spec drives the untranslated-message fallback
 * and asserts the *rendered* class copy. Structured classification is covered
 * by tests/unit/error-model.test.ts and tests/unit/error-message.test.ts.
 *
 * driven_by: agent; actor: playwright-error-i18n.
 */
import type { ElectronApplication, Page } from '@playwright/test';
import { expect, installIpcMocks, test } from './fixtures/electron';

type ErrorFailure = { code: string; message: string };
type ErrorPlan = Record<string, ErrorFailure>;

/** Every route the Agent Dev Workbench calls on mount/refresh. */
const WORKBENCH_ROUTES = [
  'agentDev.workbenchEvidence',
  'agentDev.status',
  'agentDev.traceTimeline',
  'agentDev.costReport',
  'agentDev.skillSandboxReport',
  'agentDev.selectorContract',
];

/** Synthetic provider failures, shaped like the upstream text a provider returns. */
const CLASSES = {
  auth_invalid: { code: 'AUTH_INVALID', message: 'HTTP 401 Unauthorized: invalid authentication' },
  rate_limit: { code: 'RATE_LIMIT', message: 'HTTP 429 Too Many Requests: rate limit exceeded' },
  billing: { code: 'BILLING', message: 'HTTP 429 insufficient_quota: You exceeded your current quota' },
  timeout: { code: 'TIMEOUT', message: 'Request timed out after 30000ms (ETIMEDOUT)' },
} as const;

type ErrorClassKey = keyof typeof CLASSES;

/** Toast template (`developer.agentDevWorkbench.loadFailed`) + class copy per locale. */
const EXPECTED = {
  en: {
    template: 'Failed to load Agent Dev Workbench',
    auth_invalid: 'Authentication failed',
    rate_limit: 'rate limiting requests right now',
    billing: 'insufficient balance or quota',
    timeout: 'timed out before the provider answered',
  },
  zh: {
    template: '加载 Agent Dev Workbench 失败',
    auth_invalid: '身份验证失败',
    rate_limit: '服务商当前正在限流',
    billing: '服务商账号余额或配额不足',
    timeout: '服务商未在时限内应答',
  },
  ru: {
    template: 'Не удалось загрузить Agent Dev Workbench',
    auth_invalid: 'Не удалось пройти аутентификацию',
    rate_limit: 'ограничивает частоту запросов',
    billing: 'недостаточно средств или квоты',
    timeout: 'время ожидания запроса истекло',
  },
} as const;

const ENGLISH_COPY = [
  EXPECTED.en.auth_invalid,
  EXPECTED.en.rate_limit,
  EXPECTED.en.billing,
  EXPECTED.en.timeout,
];

function planFor(routes: readonly string[], errorClass: ErrorClassKey): ErrorPlan {
  return Object.fromEntries(routes.map((route) => [route, CLASSES[errorClass]]));
}

type ErrorPlanHolder = { __clawxE2eErrorPlan?: ErrorPlan };

/**
 * Wraps the installed `host:invoke` handler once so the routes named in the
 * current plan answer with a structured failure while everything else keeps its
 * real handler. The plan itself lives on `globalThis`, so replacing it never
 * leaves a stale wrapper behind.
 */
async function installErrorPlan(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ ipcMain }) => {
    const holder = globalThis as ErrorPlanHolder;
    if (holder.__clawxE2eErrorPlan) return;
    const handlers = (ipcMain as unknown as {
      _invokeHandlers?: Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>;
    })._invokeHandlers;
    const previous = handlers?.get('host:invoke');
    if (!previous) {
      throw new Error('host:invoke handler is not registered; cannot inject synthetic failures');
    }
    holder.__clawxE2eErrorPlan = {};
    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', async (event: unknown, request: { id?: string; module?: string; action?: string }) => {
      const failure = (globalThis as ErrorPlanHolder).__clawxE2eErrorPlan?.[`${request?.module}.${request?.action}`];
      if (failure) {
        return { id: request.id, ok: false, error: { code: failure.code, message: failure.message } };
      }
      return await previous(event, request);
    });
  });
}

/** Replaces the active failure plan (installing the wrapper on first use). */
async function setErrorPlan(app: ElectronApplication, plan: ErrorPlan): Promise<void> {
  await installErrorPlan(app);
  await app.evaluate((_electron, nextPlan) => {
    (globalThis as ErrorPlanHolder).__clawxE2eErrorPlan = nextPlan;
  }, plan);
}

async function skipSetup(page: Page): Promise<void> {
  await expect(page.getByTestId('setup-page')).toBeVisible();
  await page.getByTestId('setup-skip-button').click();
  await expect(page.getByTestId('main-layout')).toBeVisible();
}

async function switchLanguage(page: Page, optionName: string): Promise<void> {
  if (!await page.getByTestId('settings-page').isVisible().catch(() => false)) {
    await page.getByTestId('sidebar-nav-settings').click();
  }
  await expect(page.getByTestId('settings-page')).toBeVisible();
  await page.getByTestId('settings-nav-general').click();
  await page.getByTestId('settings-language-select').click();
  await page.getByRole('option', { name: optionName, exact: true }).click();
}

async function openDeveloperSection(page: Page): Promise<void> {
  if (!await page.getByTestId('settings-page').isVisible().catch(() => false)) {
    await page.getByTestId('sidebar-nav-settings').click();
  }
  await expect(page.getByTestId('settings-page')).toBeVisible();
  await page.getByTestId('settings-nav-developer').click();
  const devModeSwitch = page.getByTestId('settings-dev-mode-switch');
  if ((await devModeSwitch.getAttribute('data-state')) !== 'checked') await devModeSwitch.click();
  await expect(page.getByTestId('settings-agent-dev-workbench')).toBeVisible();
  await expect(page.getByTestId('settings-agent-dev-workbench-refresh')).toBeEnabled();
}

async function openImageGeneration(page: Page): Promise<void> {
  await page.getByTestId('settings-back-button').click();
  await page.getByTestId('sidebar-footer-menu-trigger').click();
  await page.getByTestId('sidebar-more-image-generation').click();
  await expect(page.getByTestId('image-generation-settings')).toBeVisible();
}

/**
 * Triggers one synthetic class through the workbench refresh affordance and
 * asserts the toast renders that class in the expected language with no
 * English copy inside it.
 */
async function expectLocalizedFailure(
  page: Page,
  app: ElectronApplication,
  language: keyof typeof EXPECTED,
  errorClass: ErrorClassKey,
): Promise<void> {
  await setErrorPlan(app, planFor(WORKBENCH_ROUTES, errorClass));
  await page.getByTestId('settings-agent-dev-workbench-refresh').click();

  const toast = page
    .locator('[data-sonner-toast]')
    .filter({ hasText: EXPECTED[language].template })
    .filter({ hasText: EXPECTED[language][errorClass] })
    .first();
  await expect(toast).toBeVisible();

  const text = await toast.innerText();
  if (language !== 'en') {
    for (const english of ENGLISH_COPY) {
      expect(text, `${language}/${errorClass} must not fall back to English`).not.toContain(english);
    }
  }
}

test.describe('unified error exit i18n', () => {
  test('switches language and renders auth/rate-limit/balance/timeout failures without English fallback', async ({ electronApp, page }) => {
    await installIpcMocks(electronApp, {
      gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
    });
    await skipSetup(page);

    // English control first: the same synthetic failure must resolve through the
    // locale catalogue, so the later "not English" assertions are not vacuous.
    await setErrorPlan(electronApp, planFor(WORKBENCH_ROUTES, 'auth_invalid'));
    await openDeveloperSection(page);
    await expectLocalizedFailure(page, electronApp, 'en', 'auth_invalid');

    await switchLanguage(page, '中文');
    await openDeveloperSection(page);
    for (const errorClass of ['auth_invalid', 'rate_limit', 'billing', 'timeout'] as const) {
      await expectLocalizedFailure(page, electronApp, 'zh', errorClass);
    }

    await switchLanguage(page, 'Русский');
    await openDeveloperSection(page);
    for (const errorClass of ['auth_invalid', 'billing'] as const) {
      await expectLocalizedFailure(page, electronApp, 'ru', errorClass);
    }
  });

  test('shows the class message, responsibility, next step and error reference after switching language', async ({ electronApp, page }) => {
    await installIpcMocks(electronApp, {
      gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
    });
    await skipSetup(page);
    await switchLanguage(page, '中文');
    await openDeveloperSection(page);

    // The image-generation page loads its snapshot on mount and funnels the
    // failure through `toastUserError`, i.e. the full three-part exit.
    await setErrorPlan(electronApp, planFor(['media.imageGenerationSettings'], 'billing'));
    await openImageGeneration(page);

    const toast = page.locator('[data-sonner-toast]').filter({ hasText: '服务商账号余额或配额不足' }).first();
    await expect(toast).toBeVisible();
    await expect(toast).toContainText('这是服务商账号的计费或配额问题'); // responsibility
    await expect(toast).toContainText('现在重试不会成功'); // next step (no bare "retry now")
    await expect(toast).toContainText('错误编号'); // shared errorReference label
    await expect(toast).not.toContainText('insufficient balance or quota');
  });
});
