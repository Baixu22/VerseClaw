const DYNAMIC_IMPORT_RECOVERY_KEY = 'clawx:dynamic-import-recovery';
const DYNAMIC_IMPORT_RECOVERY_WINDOW_MS = 30_000;

const DYNAMIC_IMPORT_ERROR_PATTERNS = [
  'failed to fetch dynamically imported module',
  'error loading dynamically imported module',
  'importing a module script failed',
  'loading chunk',
  'chunkloaderror',
];

type DynamicImportRecoveryOptions = {
  now?: number;
  href?: string;
  storage?: Storage | null;
  reload?: (url: string) => void;
};

function errorText(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name} ${error.message}`.toLowerCase();
  }
  return String(error).toLowerCase();
}

export function isDynamicImportLoadError(error: unknown): boolean {
  const text = errorText(error);
  return DYNAMIC_IMPORT_ERROR_PATTERNS.some((pattern) => text.includes(pattern));
}

function currentRouteKey(url: URL): string {
  const normalized = new URL(url.toString());
  normalized.searchParams.delete('clawxReload');
  return `${normalized.pathname}${normalized.search}${normalized.hash}`;
}

function readLastRecovery(storage: Storage | null): { routeKey: string; at: number } | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(DYNAMIC_IMPORT_RECOVERY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<{ routeKey: string; at: number }>;
    if (typeof parsed.routeKey !== 'string' || typeof parsed.at !== 'number') return null;
    return { routeKey: parsed.routeKey, at: parsed.at };
  } catch {
    return null;
  }
}

function writeLastRecovery(storage: Storage | null, routeKey: string, at: number): void {
  if (!storage) return;
  try {
    storage.setItem(DYNAMIC_IMPORT_RECOVERY_KEY, JSON.stringify({ routeKey, at }));
  } catch {
    // Session storage can be unavailable in restricted webviews; reload anyway.
  }
}

export function recoverFromDynamicImportLoadError(
  error: unknown,
  options: DynamicImportRecoveryOptions = {},
): boolean {
  if (typeof window === 'undefined' || !isDynamicImportLoadError(error)) {
    return false;
  }

  const now = options.now ?? Date.now();
  const href = options.href ?? window.location.href;
  const reload = options.reload ?? ((url: string) => window.location.replace(url));
  let storage = options.storage ?? null;
  if (!storage) {
    try {
      storage = window.sessionStorage;
    } catch {
      storage = null;
    }
  }
  const currentUrl = new URL(href);
  const routeKey = currentRouteKey(currentUrl);
  const lastRecovery = readLastRecovery(storage);
  const alreadyTried = lastRecovery?.routeKey === routeKey
    && now - lastRecovery.at < DYNAMIC_IMPORT_RECOVERY_WINDOW_MS;

  if (alreadyTried) {
    return false;
  }

  writeLastRecovery(storage, routeKey, now);
  currentUrl.searchParams.set('clawxReload', String(now));
  reload(currentUrl.toString());
  return true;
}
