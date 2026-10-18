/**
 * Driver capability profile (TF-0064).
 *
 * `AgentBrowserHostApi` declares every contract method, and the thin playwright
 * driver satisfies the type by installing `E_NOT_IMPLEMENTED` stubs. A
 * `typeof api.method === 'function'` probe therefore cannot tell drivers apart,
 * so each driver declares the method set it really serves.
 *
 * Consumers (MCP `tools/list`) use this to avoid advertising tools the active
 * driver cannot answer — the "模块存在 ≠ 默认产品已具备" rule applied to the
 * tool surface itself.
 */

export type DriverKind = 'host-api' | 'playwright' | 'upstream' | 'injected' | 'none';

export type DriverProfile = {
  kind: DriverKind;
  /**
   * AgentBrowserHostApi method names the driver really serves.
   * `null` = assume the full host-api contract (host-injected facade).
   */
  methods: ReadonlySet<string> | null;
  /** Legacy assumed-full profiles can exclude optional methods absent on the host. */
  unavailableMethods?: ReadonlySet<string>;
  clickAfter?: boolean;
  readFeatures?: ReadonlySet<'scopedSnapshot' | 'pagedSnapshot' | 'structuredText' | 'rowExtraction' | 'elementScreenshot'>;
};

/**
 * Methods the standalone playwright driver really serves.
 * Keep in sync with `createPlaywrightHostApi` in `playwright-host-api.ts`:
 * every other contract method there calls `notImplemented()`.
 */
export const PLAYWRIGHT_DRIVER_METHODS: readonly string[] = Object.freeze([
  'open',
  'navigate',
  'waitForSelector',
  'click',
  'pointer',
  'drag',
  'type',
  'selectOption',
  'selectValues',
  'appendText',
  'setChecked',
  // TF-0113: keyboard input (allow-listed keys) — Enter-submit forms and
  // keyboard-driven widgets were undrivable without it.
  'pressKey',
  'screenshot',
  'takeSnapshot',
  'extractPageText',
  'evaluate',
  'getConsoleMessages',
  'networkListRequests',
  'networkGetRequestDetails',
  'networkWaitForRequests',
  // TF-0105: bounded runtime-globals read (fixed template + redaction).
  // `runtimeSearchModules` / `runtimeDescribeFunction` stay host-only.
  'runtimeInspectGlobals',
  'close',
  'status',
  'setEnabled',
  'clickByUid',
  'fillByUid',
]);

/** No driver at all (`VERSEBROWSER_NO_DRIVER=1` / offline-only). */
export const NONE_DRIVER_PROFILE: DriverProfile = Object.freeze({
  kind: 'none',
  methods: new Set<string>(),
});

/** Host-injected facade: trust the full contract until the host says otherwise. */
export const ASSUMED_FULL_DRIVER_PROFILE: DriverProfile = Object.freeze({
  kind: 'injected',
  methods: null,
});

export function profileForDriver(kind: DriverKind, semantic = false): DriverProfile {
  if (kind === 'upstream') return { kind, clickAfter: true, readFeatures: new Set(['scopedSnapshot', 'pagedSnapshot', 'structuredText', 'rowExtraction', 'elementScreenshot']), methods: new Set([...PLAYWRIGHT_DRIVER_METHODS.filter(method => !['runtimeInspectGlobals', 'fillByUid', 'clickByUid'].includes(method)), 'findElement', 'readForms', 'listPages', 'selectPage', 'newPage', 'closePage', 'readDialogs', 'respondDialog', 'uploadFiles', 'downloadFile', ...(semantic ? ['semanticRead'] : [])]) };
  if (kind === 'playwright') {
    return { kind, clickAfter: true, readFeatures: new Set(['structuredText', 'rowExtraction']), methods: new Set(PLAYWRIGHT_DRIVER_METHODS) };
  }
  if (kind === 'none') return NONE_DRIVER_PROFILE;
  return { kind, methods: null };
}

/** Include concrete own/prototype methods, respecting overrides; never infer proxy methods. */
export function profileFromHostApi(api: object): DriverProfile {
  const methods = new Set<string>(), seen = new Set<string>();
  const unavailable = new Set<string>();
  for (let owner: object | null = api; owner && owner !== Object.prototype; owner = Object.getPrototypeOf(owner)) {
    for (const key of Object.getOwnPropertyNames(owner)) {
      if (key === 'constructor' || seen.has(key)) continue;
      seen.add(key);
      const value = Object.getOwnPropertyDescriptor(owner, key)?.value;
      if (typeof value !== 'function') continue;
      methods.add(key);
      // TF-0162: a thin driver declares the whole contract and then refuses most of it.
      // Those methods exist but always throw E_NOT_IMPLEMENTED, so counting them as served
      // would let one driver pass in place of another. Detect the declaration instead of
      // guessing: a method whose body only throws E_NOT_IMPLEMENTED is recorded as unavailable.
      if (throwsNotImplemented(value)) unavailable.add(key);
    }
  }
  return unavailable.size
    ? { kind: 'host-api', methods, unavailableMethods: unavailable }
    : { kind: 'host-api', methods };
}

/**
 * True when a method is a thin-driver refusal stub.
 *
 * Matched on the declaration shape, never by calling it: profileFromHostApi runs against hosts
 * that may be live, and probing them would dispatch real work before the caller decided to.
 * A thin driver writes exactly `() => notImplemented('name')`, so the body is matched instead of
 * the behaviour. Anything else counts as served, which is the safe direction: a capability is
 * only withdrawn when the declaration proves the refusal.
 */
function throwsNotImplemented(fn: unknown): boolean {
  const body = String(fn).replace(/\s+/g, ' ');
  // The argument may be single- or double-quoted: the bundler rewrites string literals, so
  // both forms must match or the check silently stops working in built output.
  return /^\(\s*\)?\s*=>\s*notImplemented\(\s*["'][^"']+["']\s*\)\s*;?$/.test(body) || /^function\s*\(\s*\)\s*\{\s*notImplemented/.test(body);
}

export function driverSupports(profile: DriverProfile, method: string): boolean {
  return !profile.unavailableMethods?.has(method) && (profile.methods === null || profile.methods.has(method));
}

/** Human-readable profile for tool errors and diagnostics. */
export function describeDriverProfile(profile: DriverProfile): string {
  const count = profile.methods === null ? 'assumed-full' : String(profile.methods.size);
  return `${profile.kind} (${count} host-api methods)`;
}
