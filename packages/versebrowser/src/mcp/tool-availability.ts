/**
 * MCP tool exposure model (TF-0064).
 *
 * `TOOL_CATALOG` is the *planned* surface: it lists tools that may exist once a
 * host wires them. What a client may actually call is smaller and depends on
 * two independent facts:
 *
 *   1. `wired`               — the MCP dispatcher has a real handler.
 *   2. `requiresDriverMethods` — the active driver really serves the host-api
 *      methods that handler needs.
 *
 * `tools/list` advertises the intersection. A catalog entry that is not exposed
 * is never returned by `tools/list`, so "宣传了但 E_NOT_IMPLEMENTED" cannot
 * happen: the list is a promise, not a wish.
 */
import {
  driverSupports,
  type DriverProfile,
} from '../engine/driver-profile.ts';

export type ToolAvailability = {
  /** The MCP dispatcher (`invokeTool`) has a handler for this name. */
  wired: boolean;
  /**
   * AgentBrowserHostApi methods the handler calls. Empty = no driver method
   * needed (the handler is facade-local or offline).
   */
  requiresDriverMethods: readonly string[];
  /**
   * The handler runs before the facade guard, so it works with no driver and no
   * facade at all (currently only `vb_ping` / `vb_explain_error`).
   */
  servedWithoutFacade: boolean;
  /** Why this tool is never exposed, when `wired` is false. */
  hiddenReason?: string;
};

const offline = (): Pick<ToolAvailability, 'requiresDriverMethods' | 'servedWithoutFacade'> => ({
  requiresDriverMethods: [],
  servedWithoutFacade: true,
});

const facadeLocal = (): Pick<ToolAvailability, 'requiresDriverMethods' | 'servedWithoutFacade'> => ({
  requiresDriverMethods: [],
  servedWithoutFacade: false,
});

const driver = (
  ...methods: string[]
): Pick<ToolAvailability, 'requiresDriverMethods' | 'servedWithoutFacade'> => ({
  requiresDriverMethods: methods,
  servedWithoutFacade: false,
});

const unwired = (
  hiddenReason: string,
  ...methods: string[]
): ToolAvailability => ({
  wired: false,
  requiresDriverMethods: methods,
  servedWithoutFacade: false,
  hiddenReason,
});

/**
 * Availability for every name in `TOOL_CATALOG`.
 * A test asserts this table and the catalog stay in sync.
 */
export const TOOL_AVAILABILITY: Readonly<Record<string, ToolAvailability>> = Object.freeze({
  // ---- wired + served by every driver (offline capable) ----
  vb_ping: { wired: true, ...offline() },
  vb_explain_error: { wired: true, ...offline() },

  // ---- wired + thin-driver core ----
  vb_open: { wired: true, ...driver('open') },
  vb_nav: { wired: true, ...driver('navigate') },
  vb_click: { wired: true, ...driver('waitForSelector', 'click') },
  vb_pointer: { wired: true, ...driver('pointer') },
  vb_drag: { wired: true, ...driver('drag') },
  vb_type: { wired: true, ...driver('type') },
  vb_select: { wired: true, ...driver('selectOption') },
  vb_select_values: { wired: true, ...driver('selectValues') },
  vb_append: { wired: true, ...driver('appendText') },
  vb_check: { wired: true, ...driver('setChecked') },
  // TF-0113: bounded keyboard input (allow-listed keys) — without it an
  // Enter-to-submit form or a keyboard-driven widget cannot be driven at all.
  vb_press: { wired: true, ...driver('pressKey') },
  vb_snapshot: { wired: true, ...driver('takeSnapshot') },
  vb_find: { wired: true, ...driver('findElement') },
  vb_semantic_read: { wired: true, ...driver('semanticRead') },
  vb_forms: { wired: true, ...driver('readForms') },
  vb_upload: { wired: true, ...driver('uploadFiles') },
  vb_download: { wired: true, ...driver('downloadFile') },
  vb_pages: { wired: true, ...driver('listPages') },
  vb_dialogs: { wired: true, ...driver('readDialogs') },
  vb_dialog_respond: { wired: true, ...driver('respondDialog') },
  vb_page_select: { wired: true, ...driver('selectPage') },
  vb_page_new: { wired: true, ...driver('newPage') },
  vb_page_close: { wired: true, ...driver('closePage') },
  // TF-0098: page text is a driver capability (extract-page-text); without it
  // an agent can only see the interactive snapshot, which has no body text.
  vb_page_text: { wired: true, ...driver('extractPageText') },
  // TF-0100: bounded waiting (selector via the driver's wait, text/url polled).
  vb_wait: { wired: true, ...driver('waitForSelector', 'evaluate') },
  vb_screenshot: { wired: true, ...driver('screenshot') },
  vb_close: { wired: true, ...driver('close') },
  vb_console: { wired: true, ...driver('getConsoleMessages') },
  vb_errors: { wired: true, ...driver('getConsoleMessages', 'networkListRequests') },
  vb_diagnose_page: {
    wired: true,
    ...driver('takeSnapshot', 'getConsoleMessages', 'networkListRequests'),
  },
  vb_network_list: { wired: true, ...driver('networkListRequests') },
  // TF-0103: request/response details (headers always; bounded textual bodies).
  vb_network_detail: { wired: true, ...driver('networkGetRequestDetails') },
  // TF-0104: wait for a matching request, or for the page to go quiet.
  vb_network_wait: { wired: true, ...driver('networkWaitForRequests') },
  // TF-0105: bounded runtime-globals read (`inspect-globals`) is real on the
  // thin driver. `search-modules` / `describe-function` are host-engine
  // capabilities and are not advertised by this tool's action enum.
  vb_runtime_read: { wired: true, ...driver('runtimeInspectGlobals') },
  vb_network_compare: { wired: true, ...driver('networkListRequests') },
  vb_verify_flow: {
    wired: true,
    ...driver(
      'waitForSelector',
      'evaluate',
      'getConsoleMessages',
      'networkListRequests',
      'screenshot',
    ),
  },

  // ---- wired + facade-local (evidence / runtime mode), no driver method ----
  vb_record_start: { wired: true, ...facadeLocal() },
  vb_record_stop: { wired: true, ...facadeLocal() },
  vb_diagnose: { wired: true, ...facadeLocal() },
  vb_pr_comment: { wired: true, ...facadeLocal() },
  vb_evidence_write: { wired: true, ...facadeLocal() },
  vb_request_mode_upgrade: { wired: true, ...facadeLocal() },
  vb_mode_revoke: { wired: true, ...facadeLocal() },
  vb_mode_status: { wired: true, ...facadeLocal() },
  vb_full_access_revoke: { wired: true, ...facadeLocal() },
  // TF-0167: the human gate. Facade-local (no driver method needed): what makes it matter is the
  // pause state itself, and the resume token only ever comes from the human operator channel.
  vb_pause_for_human: { wired: true, ...facadeLocal() },
  vb_human_gate_status: { wired: true, ...facadeLocal() },
  vb_resume_after_human: { wired: true, ...facadeLocal() },

  // ---- planned but NOT wired: never advertised until a handler exists ----
  // vb_runtime_read is wired now (TF-0105, inspect-globals only); the network
  // tools are wired too (TF-0103 / TF-0104).
  vb_network_replay: unwired(
    'needs a credentialed replay path plus a boundary grant (host engine)',
    'replayPrepareRequest',
    'replaySendRequest',
    'replayCompareResponses',
  ),
  vb_auth_state: unwired(
    'needs the host vault (secrets stay in the host); never exposed on the standalone driver',
    'vault',
  ),
  vb_boundary_respond: unwired(
    'needs the host boundary executor (respondBoundaryChoice is not on the thin driver)',
    'respondBoundaryChoice',
  ),
});

/**
 * Why a tool is not exposed for this driver; `undefined` means it is exposed.
 * Used both by `tools/list` and by the call-time guard so the two agree.
 */
export function exposureReason(name: string, profile: DriverProfile): string | undefined {
  const availability = TOOL_AVAILABILITY[name];
  if (!availability) return `unknown tool: ${name}`;
  if (!availability.wired) {
    return availability.hiddenReason ?? `${name} has no MCP handler`;
  }
  if (profile.kind === 'none' && !availability.servedWithoutFacade) {
    return (
      `${name} needs a live browser session; no driver is active ` +
      `(VERSEBROWSER_NO_DRIVER=1 or noDriver). Unset it to auto-start playwright-core, ` +
      `or inject a host facade.`
    );
  }
  const missing = availability.requiresDriverMethods.filter(
    (method) => !driverSupports(profile, method),
  );
  if (missing.length > 0) {
    return `driver "${profile.kind}" does not serve ${missing.join(', ')}`;
  }
  return undefined;
}

export function isToolExposed(name: string, profile: DriverProfile): boolean {
  return exposureReason(name, profile) === undefined;
}

export function filterExposedTools<T extends { name: string }>(
  tools: readonly T[],
  profile: DriverProfile,
): T[] {
  return tools.filter((tool) => isToolExposed(tool.name, profile));
}

/** Exposed names in catalog order — handy for docs/CLI diagnostics and tests. */
export function exposedToolNames(
  tools: readonly { name: string }[],
  profile: DriverProfile,
): string[] {
  return filterExposedTools(tools, profile).map((tool) => tool.name);
}
