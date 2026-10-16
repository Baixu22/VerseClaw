/**
 * TF-0175 — optional, read-only visual adapter (Midscene), loaded only when the host provides it.
 *
 * Deliberately NOT a product dependency: importing `@midscene/web` would pull sharp + the whole
 * puppeteer subtree into the product lock and turn a 0-vulnerability root audit into 12 high
 * advisories (measured 2026-10-12; those advisories are unreachable at runtime but still reported).
 * The host that wants visual read supplies the package itself; without it this module fails closed.
 *
 * Scope is read-only on purpose (`docs/integration/upstream-reuse.md` §98): observe/extract only.
 * Visual actions stay with the controlled primitives; `aiAct`/`aiTap` are never exposed here.
 */
import { redactSecretsInText, redactSecretsInValue } from '../security/redact-secrets.ts';

export type VisualGateway = {
  /** Host-provided model. Mirrors the semantic gateway: the host owns model choice and budget. */
  modelId: string;
  apiKey: string;
  baseURL: string;
  modelFamily: string;
  maxCalls: number;
  maxInputChars: number;
};

export type VisualReadOptions = {
  action: 'observe' | 'extract';
  instruction: string;
  schema?: Record<string, unknown>;
  timeoutMs?: number;
};

/** Minimal structural view of the parts of a Playwright page this adapter needs. */
export type VisualPage = {
  url(): string;
  evaluate<T>(fn: () => T): Promise<T>;
};

type MidsceneAgent = {
  aiQuery(instruction: string, options?: { domIncluded?: boolean }): Promise<unknown>;
  destroy?: () => Promise<void> | void;
};

const CONFIG_ERROR = 'E_VISUAL_CONFIG';
const UNAVAILABLE = 'E_VISUAL_UNAVAILABLE';
const STALE = 'E_VISUAL_STALE';
const BUDGET = 'E_VISUAL_BUDGET';
const MODEL = 'E_VISUAL_MODEL';

function fail(code: string, message: string, details?: Record<string, unknown>): never {
  throw Object.assign(new Error(`${code}: ${message}`), { code, ...(details ? { details } : {}) });
}

/**
 * A page identity that changes whenever the observed document does. Coordinates are only valid for
 * the snapshot they were derived from, so a read whose page moved on is refused instead of applied.
 */
async function pageVersion(page: VisualPage): Promise<{ url: string; documentRevision: string }> {
  const url = page.url();
  const marker = await page.evaluate(() => {
    const w = globalThis as unknown as { __vbVisualRevision?: number };
    w.__vbVisualRevision = (w.__vbVisualRevision ?? 0) + 1;
    return String(w.__vbVisualRevision);
  });
  return { url, documentRevision: marker };
}

export type VisualModuleLoader = () => Promise<{ PlaywrightAgent?: unknown }>;

export async function prepareVisualBrowser(gateway: VisualGateway, loadModule?: VisualModuleLoader) {
  if (!gateway || typeof gateway !== 'object') fail(CONFIG_ERROR, 'a host visual gateway is required');
  for (const key of ['modelId', 'apiKey', 'baseURL', 'modelFamily'] as const) {
    const value = gateway[key];
    if (typeof value !== 'string' || !value.trim() || value.length > 500) fail(CONFIG_ERROR, `invalid host visual ${key}`);
  }
  for (const [key, maximum] of [['maxCalls', 4], ['maxInputChars', 20000]] as const) {
    const value = gateway[key];
    if (!Number.isInteger(value) || value < 1 || value > maximum) fail(CONFIG_ERROR, `invalid host visual budget ${key}`);
  }
  // Load the optional package at call time so the product lock never depends on it.
  let module: { PlaywrightAgent?: unknown };
  try {
    // Non-literal specifier: the package is intentionally absent from the product dependency tree,
    // so it must not be statically resolvable at build time. Tests and alternative hosts may inject
    // their own loader; the default is the runtime import of the host-provided package.
    module = loadModule
      ? await loadModule()
      : ((await import(/* @vite-ignore */ '@midscene/web/playwright' as string)) as { PlaywrightAgent?: unknown });
  } catch {
    fail(UNAVAILABLE, 'the optional @midscene/web package is not installed; visual read is unavailable');
  }
  if (typeof module.PlaywrightAgent !== 'function') fail(UNAVAILABLE, 'the installed @midscene/web does not expose PlaywrightAgent');
  return { gateway: { ...gateway }, PlaywrightAgent: module.PlaywrightAgent as new (page: unknown, options: Record<string, unknown>) => MidsceneAgent };
}

export type PreparedVisualBrowser = Awaited<ReturnType<typeof prepareVisualBrowser>>;

export async function attachVisualBrowser(prepared: PreparedVisualBrowser) {
  let active: { signal: AbortSignal; calls: number; inputChars: number } | undefined;
  let closed = false;
  const gateway = prepared.gateway;

  const read = async (page: VisualPage, options: VisualReadOptions, signal?: AbortSignal) => {
    if (closed) fail(UNAVAILABLE, 'visual adapter is closed');
    const controller = new AbortController();
    const timeout = Number.isFinite(options.timeoutMs) && (options.timeoutMs as number) > 0 ? (options.timeoutMs as number) : 30000;
    const timer = setTimeout(() => controller.abort(new Error('E_VISUAL_TIMEOUT: visual read deadline expired')), timeout);
    const combined = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
    const call = { signal: combined, calls: 0, inputChars: 0 };
    active = call;
    const before = await pageVersion(page);
    try {
      combined.throwIfAborted();
      const instruction = redactSecretsInText(options.instruction);
      call.inputChars += instruction.length;
      if (call.inputChars > gateway.maxInputChars) fail(BUDGET, 'visual input budget exceeded');
      const agent = new prepared.PlaywrightAgent(page, {
        // Navigation semantics must not be silently changed by the visual layer.
        forceSameTabNavigation: false,
        generateReport: false,
        modelConfig: { modelName: gateway.modelId, openaiApiKey: gateway.apiKey, openaiBaseURL: gateway.baseURL, modelFamily: gateway.modelFamily },
        beforeInvokeAction: async () => {
          combined.throwIfAborted();
          if (call.calls >= gateway.maxCalls) fail(BUDGET, 'visual model call budget exhausted');
          call.calls += 1;
        },
      });
      const value = await agent.aiQuery(
        options.action === 'extract' ? `${instruction}\nReturn only JSON matching this schema: ${JSON.stringify(options.schema ?? {})}` : instruction,
        { domIncluded: false },
      );
      await agent.destroy?.();
      const after = await pageVersion(page);
      if (after.url !== before.url || after.documentRevision !== before.documentRevision) {
        fail(STALE, 'the page changed while the visual read was in flight; observe again before acting', { before, after });
      }
      return {
        value: redactSecretsInValue(value),
        source: { url: before.url, documentRevision: before.documentRevision },
        model: { id: gateway.modelId, calls: call.calls },
        trust: 'untrusted' as const,
      };
    } finally {
      clearTimeout(timer);
      active = undefined;
    }
  };

  return {
    read,
    async close() {
      closed = true;
      active = undefined;
    },
    get inFlight() {
      return active !== undefined;
    },
  };
}

export type VisualAdapter = Awaited<ReturnType<typeof attachVisualBrowser>>;