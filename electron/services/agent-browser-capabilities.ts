/**
 * Model-facing capability snapshot (TF-0348 / spec N3).
 *
 * The model tool exposes a fixed action vocabulary, but which of those actions a
 * session may really run depends on three independent facts the model cannot
 * see: the active driver, the environment (is the bundled `agent-browser` CLI
 * present) and the host authorization state.
 *
 * Driver facts come from the package's real `DriverProfile` (obtained through the
 * already-exported `AgentBrowserFacade#getDriverProfile`). That profile is built
 * by the package exactly to avoid the "`typeof api.method === 'function'`" trap:
 * it detects thin-driver refusal stubs by declaration shape. This module never
 * infers capability from a Proxy's function surface and never counts the
 * 81-method contract as support.
 *
 * Discovery is pure: it opens no browser, mutates no session and is safe to call
 * on every `status` request. `version` is a deterministic hash of the
 * availability map so consumers can cache a derived schema and only rebuild it
 * when the facts actually change.
 */
import { createHash } from 'node:crypto';

export const MODEL_ACTION_NAMES = [
  'open',
  'status',
  'navigate',
  'waitForSelector',
  'click',
  'type',
  'evaluate',
  'screenshot',
  'command',
  'close',
  'getConsoleMessages',
  'downloadFile',
  'uploadFiles',
  'pointer',
  'drag',
  'selectOption',
  'selectValues',
  'appendText',
  'setChecked',
  'findElement',
  'semanticRead',
  'readForms',
  'readDialogs',
  'respondDialog',
  // Spec N4 observation/verify loop (typed, no optional CLI required).
  'takeSnapshot',
  'extractPageText',
  'pressKey',
  'verifyFlow',
] as const;

export type ModelActionName = (typeof MODEL_ACTION_NAMES)[number];

/** Structural view of the package `DriverProfile` (no type-only import needed). */
export type DriverProfileLike = {
  readonly kind: string;
  readonly methods: ReadonlySet<string> | null;
  readonly unavailableMethods?: ReadonlySet<string>;
};

export type ModelActionRequirement = {
  /** Host-api methods the action really needs. Empty = no driver involvement. */
  readonly methods: readonly string[];
  /** True when the action needs the bundled `agent-browser` executable. */
  readonly requiresCli?: boolean;
  /** True when the handler is facade-local and works with no driver. */
  readonly facadeLocal?: boolean;
  /** True when the action needs the global browser-control run-state switch. */
  readonly requiresControl?: boolean;
};

export const MODEL_ACTION_REQUIREMENTS: Readonly<Record<ModelActionName, ModelActionRequirement>> = Object.freeze({
  open: { methods: ['open'] },
  status: { methods: [], facadeLocal: true },
  navigate: { methods: ['navigate'] },
  waitForSelector: { methods: ['waitForSelector'] },
  click: { methods: ['waitForSelector', 'click'] },
  type: { methods: ['type'] },
  evaluate: { methods: ['evaluate'] },
  screenshot: { methods: ['screenshot'] },
  command: { methods: [], requiresCli: true },
  close: { methods: ['close'] },
  getConsoleMessages: { methods: ['getConsoleMessages'] },
  downloadFile: { methods: ['downloadFile'] },
  uploadFiles: { methods: ['uploadFiles'] },
  pointer: { methods: ['pointer'] },
  drag: { methods: ['drag'] },
  selectOption: { methods: ['selectOption'] },
  selectValues: { methods: ['selectValues'] },
  appendText: { methods: ['appendText'] },
  setChecked: { methods: ['setChecked'] },
  findElement: { methods: ['findElement'] },
  semanticRead: { methods: ['semanticRead'] },
  readForms: { methods: ['readForms'] },
  readDialogs: { methods: ['readDialogs'] },
  respondDialog: { methods: ['respondDialog'] },
  takeSnapshot: { methods: ['takeSnapshot'], requiresControl: true },
  extractPageText: { methods: ['extractPageText'] },
  pressKey: { methods: ['pressKey'], requiresControl: true },
  // verifyFlow is facade-composed: it needs the driver methods the facade drives.
  verifyFlow: { methods: ['waitForSelector', 'evaluate', 'getConsoleMessages', 'networkListRequests', 'screenshot'] },
});

export type ModelActionCapability = {
  readonly action: ModelActionName;
  readonly available: boolean;
  /** Present only when `available` is false. */
  readonly reason?: string;
  /** True when this action leaves the sandbox and needs supervised permission. */
  readonly supervised: boolean;
};

export type ModelActionCapabilitySnapshot = {
  readonly version: string;
  readonly driverKind: string;
  readonly cliAvailable: boolean;
  readonly actions: readonly ModelActionCapability[];
  /** TF-0503: browser is supervised; risky actions need a live approval, not just a driver. */
  readonly supervision: "required";
  /** Actions that stay inside the sandbox and need no approval. */
  readonly unsupervisedActions: readonly ModelActionName[];
};

export function driverProfileSupports(profile: DriverProfileLike, method: string): boolean {
  return !profile.unavailableMethods?.has(method) && (profile.methods === null || profile.methods.has(method));
}

export function modelActionCapability(
  action: ModelActionName,
  profile: DriverProfileLike,
  env: { cliAvailable: boolean },
): ModelActionCapability {
  const requirement = MODEL_ACTION_REQUIREMENTS[action];
  const supervised = modelActionRequiresSupervision(action);
  if (requirement.requiresCli && !env.cliAvailable) {
    return { action, available: false, supervised, reason: 'bundled agent-browser CLI is not available' };
  }
  if (requirement.facadeLocal) return { action, available: true, supervised };
  if (profile.kind === 'none') {
    return { action, available: false, supervised, reason: 'driver "none" is active; no browser session' };
  }
  // `methods === null` means "assume the contract", but the profile may still
  // declare methods it refuses; driverProfileSupports checks that first.
  const missing = requirement.methods.filter((method) => !driverProfileSupports(profile, method));
  if (missing.length > 0) {
    const stub = missing.filter((method) => profile.unavailableMethods?.has(method));
    return {
      action,
      available: false,
      supervised,
      reason: stub.length > 0
        ? `driver "${profile.kind}" declares ${stub.join(', ')} but refuses them (E_NOT_IMPLEMENTED)`
        : `driver "${profile.kind}" does not serve ${missing.join(', ')}`,
    };
  }
  return { action, available: true, supervised };
}

export function modelActionCapabilities(
  profile: DriverProfileLike,
  env: { cliAvailable: boolean },
): ModelActionCapabilitySnapshot {
  const actions = MODEL_ACTION_NAMES.map((action) => modelActionCapability(action, profile, env));
  const canonical = JSON.stringify({
    driverKind: profile.kind,
    cliAvailable: env.cliAvailable,
    actions: actions.map((entry) => [entry.action, entry.available, entry.supervised, entry.reason ?? '']),
  });
  return {
    version: createHash('sha256').update(canonical).digest('hex'),
    driverKind: profile.kind,
    cliAvailable: env.cliAvailable,
    actions,
    supervision: 'required',
    unsupervisedActions: [...UNSUPERVISED_ACTIONS].sort(),
  };
}

/**
 * TF-0503: a browser action is supervised when it can cause an external,
 * irreversible or credentialed effect. Pure reads stay unsupervised.
 */
const UNSUPERVISED_ACTIONS: ReadonlySet<ModelActionName> = new Set<ModelActionName>([
  "status",
  "getConsoleMessages",
  "takeSnapshot",
  "extractPageText",
  "findElement",
  "semanticRead",
  "readForms",
  "readDialogs",
  "screenshot",
]);

export function modelActionRequiresSupervision(action: string): boolean {
  if (!(MODEL_ACTION_NAMES as readonly string[]).includes(action)) return true;
  return !UNSUPERVISED_ACTIONS.has(action as ModelActionName);
}

export function modelActionRequiresControl(action: string): boolean {
  const requirement = (MODEL_ACTION_REQUIREMENTS as Record<string, ModelActionRequirement>)[action];
  return requirement?.requiresControl === true;
}

export function availableModelActions(snapshot: ModelActionCapabilitySnapshot): ModelActionName[] {
  return snapshot.actions.filter((entry) => entry.available).map((entry) => entry.action);
}
