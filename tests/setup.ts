/**
 * Vitest Test Setup
 * Global test configuration and mocks
 */
import { vi } from 'vitest';
import '@testing-library/jest-dom';

// Provide a minimal `electron` mock so tests that transitively import
// main-process code (logger, store, etc.) don't blow up when the Electron
// binary is not present (e.g. CI with ELECTRON_SKIP_BINARY_DOWNLOAD=1).
// Individual test files can override with their own vi.mock('electron', ...).
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/tmp/verse-claw-test'),
    getVersion: vi.fn().mockReturnValue('0.0.0-test'),
    getName: vi.fn().mockReturnValue('verse-claw-test'),
    isPackaged: false,
    isReady: vi.fn().mockResolvedValue(true),
    on: vi.fn(),
    off: vi.fn(),
    quit: vi.fn(),
    whenReady: vi.fn().mockResolvedValue(undefined),
  },
  BrowserWindow: vi.fn(),
  Menu: {
    buildFromTemplate: vi.fn((template) => ({ template })),
    setApplicationMenu: vi.fn(),
  },
  ipcMain: { on: vi.fn(), handle: vi.fn(), removeHandler: vi.fn() },
  dialog: { showOpenDialog: vi.fn(), showMessageBox: vi.fn() },
  shell: { openExternal: vi.fn() },
  session: { defaultSession: { webRequest: { onBeforeSendHeaders: vi.fn() } } },
  utilityProcess: {},
}));

const electronStoreMockState = vi.hoisted(() => ({
  memory: new Map<string, Record<string, unknown>>(),
  clone<T>(value: T): T {
    if (Array.isArray(value)) return [...value] as T;
    if (value && typeof value === 'object') return { ...(value as Record<string, unknown>) } as T;
    return value;
  },
}));

vi.mock('electron-store', () => {
  class MockElectronStore {
    private readonly key: string;

    constructor(options?: { name?: string; projectName?: string; defaults?: Record<string, unknown> }) {
      this.key = `${options?.projectName ?? 'test'}:${options?.name ?? 'default'}`;
      if (!electronStoreMockState.memory.has(this.key)) {
        const defaults = options?.defaults ?? {};
        electronStoreMockState.memory.set(this.key, Object.fromEntries(
          Object.entries(defaults).map(([entryKey, value]) => [entryKey, electronStoreMockState.clone(value)]),
        ));
      }
    }

    get store(): Record<string, unknown> {
      return { ...(electronStoreMockState.memory.get(this.key) ?? {}) };
    }

    set store(value: Record<string, unknown>) {
      electronStoreMockState.memory.set(this.key, { ...value });
    }

    get(key: string) {
      return electronStoreMockState.clone((electronStoreMockState.memory.get(this.key) ?? {})[key]);
    }

    set(key: string, value: unknown) {
      const store = electronStoreMockState.memory.get(this.key) ?? {};
      store[key] = electronStoreMockState.clone(value);
      electronStoreMockState.memory.set(this.key, store);
    }

    delete(key: string) {
      const store = electronStoreMockState.memory.get(this.key) ?? {};
      delete store[key];
      electronStoreMockState.memory.set(this.key, store);
    }

    clear() {
      electronStoreMockState.memory.set(this.key, {});
    }
  }

  return { default: MockElectronStore };
});

// Mock window.electron API
const mockElectron = {
  ipcRenderer: {
    invoke: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
    off: vi.fn(),
  },
  openExternal: vi.fn(),
  getPathForFile: vi.fn((file: File) => (file as File & { path?: string }).path ?? ''),
  platform: 'darwin',
  isDev: true,
};

if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'electron', {
    value: mockElectron,
    writable: true,
  });
}

// Vitest/jsdom can expose an opaque-origin window where localStorage is absent.
// The renderer stores use it for small UI caches, so provide the browser shape
// expected by unit tests when the environment does not.
if (typeof window !== 'undefined') {
  let needsLocalStorageMock: boolean;
  try {
    needsLocalStorageMock = !window.localStorage;
  } catch {
    needsLocalStorageMock = true;
  }

  if (needsLocalStorageMock) {
    const storage = new Map<string, string>();
    const localStorageMock: Storage = {
      get length() {
        return storage.size;
      },
      clear: vi.fn(() => storage.clear()),
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      key: vi.fn((index: number) => Array.from(storage.keys())[index] ?? null),
      removeItem: vi.fn((key: string) => {
        storage.delete(key);
      }),
      setItem: vi.fn((key: string, value: string) => {
        storage.set(key, String(value));
      }),
    };
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'localStorage', {
      value: localStorageMock,
      configurable: true,
    });
  }
}

// Mock matchMedia
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

// Mock IntersectionObserver: jsdom does not implement it, but framer-motion's
// useInView (used by dia-text-reveal in the loading shells) constructs one at
// mount. A no-op observer keeps those components renderable in unit tests.
if (typeof window !== 'undefined' && !('IntersectionObserver' in window)) {
  class IntersectionObserverMock {
    readonly root = null;
    readonly rootMargin = '';
    readonly thresholds: ReadonlyArray<number> = [];
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
    takeRecords = vi.fn(() => []);
  }
  Object.defineProperty(window, 'IntersectionObserver', {
    writable: true,
    value: IntersectionObserverMock,
  });
  Object.defineProperty(globalThis, 'IntersectionObserver', {
    writable: true,
    value: IntersectionObserverMock,
  });
}

// Mock ResizeObserver: jsdom does not implement it either. The composer's
// plus-menu-morph measures the add menu on mount, so renderer tests that mount
// ChatInput need a no-op observer.
if (typeof window !== 'undefined' && !('ResizeObserver' in window)) {
  class ResizeObserverMock {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  }
  Object.defineProperty(window, 'ResizeObserver', {
    writable: true,
    value: ResizeObserverMock,
  });
  Object.defineProperty(globalThis, 'ResizeObserver', {
    writable: true,
    value: ResizeObserverMock,
  });
}

// jsdom ships the `CSS` object without `supports()`. Components that
// feature-detect CSS capabilities at mount must take their real fallback path.
if (typeof window !== 'undefined') {
  const cssObject = (window as unknown as { CSS?: Record<string, unknown> }).CSS ?? {};
  if (typeof cssObject.supports !== 'function') {
    cssObject.supports = () => false;
    Object.defineProperty(window, 'CSS', { writable: true, configurable: true, value: cssObject });
  }
}

// Reset mocks after each test
afterEach(() => {
  vi.clearAllMocks();
});
