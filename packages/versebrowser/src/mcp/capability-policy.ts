/**
 * Deny-by-default capability gate for versebrowser MCP tools.
 *
 * Pattern reference: ClawX `resources/verseshell-mcp/src/policy.js`
 * (explicit capability enumeration, no wildcards, fail-closed unknown tools).
 * Versebrowser tool names and capability surface are purpose-built; shell
 * tool tables are intentionally not copied.
 */

export const MCP_TOOL_GROUPS = Object.freeze([
  'core',
  'debug',
  'network',
  'auth',
  'authority',
  'evidence',
] as const);

export type McpToolGroup = (typeof MCP_TOOL_GROUPS)[number];

/** Only these names are valid configuration values. `all` / `*` are forbidden. */
export const MCP_CAPABILITIES = Object.freeze([
  'browser.open',
  'browser.navigate',
  'browser.act',
  'browser.upload',
  'browser.download',
  'browser.observe',
  'browser.semantic',
  'browser.close',
  'debug.console',
  'debug.explain',
  'debug.runtime',
  'network.read',
  'network.replay',
  'auth.vault',
  'authority.upgrade',
  'authority.revoke',
  // TF-0167: the human gate is its own capability. A host may grant the human handoff without
  // granting runtime-mode escalation, and deny-by-default still exposes only `vb_ping`.
  'authority.hitl',
  'evidence.write',
  'evidence.read',
] as const);

export type McpCapability = (typeof MCP_CAPABILITIES)[number];

const CAPABILITY_SET = new Set<string>(MCP_CAPABILITIES);
const GROUP_SET = new Set<string>(MCP_TOOL_GROUPS);

export type McpPolicy = Readonly<{
  groups: readonly McpToolGroup[];
  capabilities: readonly McpCapability[];
}>;

export class McpPolicyError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'McpPolicyError';
    this.code = code;
    this.details = details;
    Object.assign(this, details);
  }
}

export type ToolDescriptor = {
  name: string;
  group: McpToolGroup;
};

/** Planned MCP tool → required capability. Unknown tools are always denied. */
const TOOL_CAPABILITIES: Readonly<Record<string, McpCapability | null>> = Object.freeze({
  vb_ping: null,
  vb_open: 'browser.open',
  vb_nav: 'browser.navigate',
  vb_click: 'browser.act',
  vb_upload: 'browser.upload',
  vb_download: 'browser.download',
  vb_pointer: 'browser.act',
  vb_drag: 'browser.act',
  vb_type: 'browser.act',
  vb_select: 'browser.act',
  vb_select_values: 'browser.act',
  vb_append: 'browser.act',
  vb_check: 'browser.act',
  vb_press: 'browser.act',
  vb_wait: 'browser.observe',
  vb_snapshot: 'browser.observe',
  vb_find: 'browser.observe',
  vb_semantic_read: 'browser.semantic',
  vb_forms: 'browser.observe',
  vb_pages: 'browser.observe',
  vb_dialogs: 'browser.observe',
  vb_dialog_respond: 'browser.act',
  vb_page_select: 'browser.act',
  vb_page_new: 'browser.open',
  vb_page_close: 'browser.close',
  vb_page_text: 'browser.observe',
  vb_screenshot: 'browser.observe',
  vb_close: 'browser.close',
  vb_console: 'debug.console',
  vb_errors: 'debug.console',
  vb_explain_error: 'debug.explain',
  vb_diagnose_page: 'debug.explain',
  vb_runtime_read: 'debug.runtime',
  vb_network_list: 'network.read',
  vb_network_detail: 'network.read',
  vb_network_wait: 'network.read',
  vb_network_compare: 'network.replay',
  vb_network_replay: 'network.replay',
  vb_auth_state: 'auth.vault',
  vb_request_mode_upgrade: 'authority.upgrade',
  vb_boundary_respond: 'authority.upgrade',
  vb_full_access_revoke: 'authority.revoke',
  vb_mode_revoke: 'authority.revoke',
  // Same authority plane as the revoke tools: reading the mode needs the grant
  // too, so deny-by-default still exposes only `vb_ping`.
  vb_mode_status: 'authority.revoke',
  // TF-0167: the human gate. Requesting a pause is safety-positive (it only stops automation) and
  // status is a read, but both need the explicit grant. Resuming needs the one-time token that is
  // issued to the human operator channel, so this capability cannot manufacture one.
  vb_pause_for_human: 'authority.hitl',
  vb_human_gate_status: 'authority.hitl',
  vb_resume_after_human: 'authority.hitl',
  vb_evidence_write: 'evidence.write',
  vb_verify_flow: 'evidence.write',
  vb_record_start: 'evidence.write',
  vb_record_stop: 'evidence.write',
  vb_diagnose: 'evidence.write',
  vb_pr_comment: 'evidence.read',
});

const TOOL_GROUPS: Readonly<Record<string, McpToolGroup>> = Object.freeze({
  vb_ping: 'core',
  vb_open: 'core',
  vb_nav: 'core',
  vb_click: 'core',
  vb_upload: 'core',
  vb_download: 'core',
  vb_pointer: 'core',
  vb_drag: 'core',
  vb_type: 'core',
  vb_select: 'core',
  vb_select_values: 'core',
  vb_append: 'core',
  vb_check: 'core',
  vb_press: 'core',
  vb_wait: 'core',
  vb_snapshot: 'core',
  vb_find: 'core',
  vb_semantic_read: 'core',
  vb_forms: 'core',
  vb_pages: 'core',
  vb_dialogs: 'core',
  vb_dialog_respond: 'core',
  vb_page_select: 'core',
  vb_page_new: 'core',
  vb_page_close: 'core',
  vb_page_text: 'core',
  vb_screenshot: 'core',
  vb_close: 'core',
  vb_console: 'debug',
  vb_errors: 'debug',
  vb_explain_error: 'debug',
  vb_diagnose_page: 'debug',
  vb_runtime_read: 'debug',
  vb_network_list: 'network',
  vb_network_detail: 'network',
  vb_network_wait: 'network',
  vb_network_compare: 'network',
  vb_network_replay: 'network',
  vb_auth_state: 'auth',
  vb_request_mode_upgrade: 'authority',
  vb_boundary_respond: 'authority',
  vb_full_access_revoke: 'authority',
  vb_mode_revoke: 'authority',
  vb_mode_status: 'authority',
  vb_pause_for_human: 'authority',
  vb_human_gate_status: 'authority',
  vb_resume_after_human: 'authority',
  vb_evidence_write: 'evidence',
  vb_verify_flow: 'evidence',
  vb_record_start: 'evidence',
  vb_record_stop: 'evidence',
  vb_diagnose: 'evidence',
  vb_pr_comment: 'evidence',
});

/**
 * Split an env list. `errorCode` / `wildcardMessage` are supplied by the caller so a wildcard in
 * the *group* list fails as a group-config error, not a capability-config one: the README promises
 * `E_GROUP_CONFIG` for group wildcards, and a caller keying on the code must be able to tell a
 * groups mistake from a capabilities mistake. (Both used to raise `E_CAPABILITY_CONFIG`, so the
 * documented group code was unreachable for wildcards.)
 */
function parseList(raw: string | undefined | null, errorCode: string, wildcardMessage: string): string[] {
  if (raw === undefined || raw === null || String(raw).trim() === '') return [];
  const values = String(raw)
    .split(/[\s,]+/u)
    .map((value) => value.trim())
    .filter(Boolean);
  if (values.some((value) => value === 'all' || value === '*')) {
    throw new McpPolicyError(errorCode, wildcardMessage);
  }
  return [...new Set(values)];
}

export function parseCapabilityList(raw: string | undefined | null): McpCapability[] {
  const values = parseList(
    raw,
    'E_CAPABILITY_CONFIG',
    'Wildcard capability grants are forbidden; enumerate capabilities.',
  );
  const unknown = values.filter((value) => !CAPABILITY_SET.has(value));
  if (unknown.length > 0) {
    throw new McpPolicyError('E_CAPABILITY_CONFIG', `Unknown capability: ${unknown[0]}`, {
      unknown_capabilities: unknown,
    });
  }
  return values as McpCapability[];
}

export function parseToolGroupList(raw: string | undefined | null): McpToolGroup[] {
  const values = parseList(
    raw,
    'E_GROUP_CONFIG',
    'Wildcard tool groups are forbidden; enumerate groups.',
  ).map((value) => value.toLowerCase());
  const unknown = values.filter((value) => !GROUP_SET.has(value));
  if (unknown.length > 0) {
    throw new McpPolicyError('E_GROUP_CONFIG', `Unknown tool group: ${unknown[0]}`, {
      unknown_groups: unknown,
    });
  }
  return [...new Set(values)] as McpToolGroup[];
}

/**
 * Resolve a frozen policy. Default is deny-by-default: empty groups and empty
 * capabilities — only `vb_ping` (no capability) remains callable.
 */
export function resolveMcpPolicy(
  options: {
    groups?: string | readonly McpToolGroup[];
    caps?: string | readonly McpCapability[];
    env?: NodeJS.ProcessEnv;
  } = {},
): McpPolicy {
  const env = options.env ?? process.env;
  const rawGroups =
    options.groups === undefined
      ? env.VERSEBROWSER_TOOL_GROUPS
      : Array.isArray(options.groups)
        ? options.groups.join(',')
        : String(options.groups);
  const rawCaps =
    options.caps === undefined
      ? env.VERSEBROWSER_CAPS
      : Array.isArray(options.caps)
        ? options.caps.join(',')
        : String(options.caps);

  return Object.freeze({
    groups: Object.freeze(parseToolGroupList(rawGroups)),
    capabilities: Object.freeze(parseCapabilityList(rawCaps)),
  });
}

export function requiredCapability(name: string): McpCapability | null | undefined {
  return Object.prototype.hasOwnProperty.call(TOOL_CAPABILITIES, name)
    ? TOOL_CAPABILITIES[name]
    : undefined;
}

export function toolGroup(name: string): McpToolGroup | undefined {
  return TOOL_GROUPS[name];
}

/**
 * Every tool name the policy knows about (group table ∪ capability table).
 * Exported so a test can assert that the declared surface and the registered
 * `TOOL_CATALOG` never drift apart in either direction (TF-0100).
 */
export function declaredToolNames(): string[] {
  return [...new Set([...Object.keys(TOOL_GROUPS), ...Object.keys(TOOL_CAPABILITIES)])].sort();
}

export function isToolAllowed(name: string, policy: McpPolicy): boolean {
  const capability = requiredCapability(name);
  if (capability === undefined) return false;
  const group = toolGroup(name);
  if (group && policy.groups.length > 0 && !policy.groups.includes(group)) {
    // Group filter is an allowlist when non-empty; empty means "no group tools".
    return false;
  }
  if (group && policy.groups.length === 0 && capability !== null) {
    return false;
  }
  if (capability === null) return true;
  return policy.capabilities.includes(capability);
}

export function assertToolAllowed(name: string, policy: McpPolicy): McpCapability | null {
  const capability = requiredCapability(name);
  if (capability === undefined) {
    throw new McpPolicyError('E_TOOL_DENY', `Unknown tool: ${name}`);
  }
  const group = toolGroup(name);
  if (group && policy.groups.length > 0 && !policy.groups.includes(group)) {
    throw new McpPolicyError('E_GROUP_DENY', `${name} is outside enabled tool groups.`, {
      group,
      enabled_groups: policy.groups,
    });
  }
  if (group && policy.groups.length === 0 && capability !== null) {
    throw new McpPolicyError(
      'E_GROUP_DENY',
      `${name} requires an explicit tool group grant (deny-by-default).`,
      { group },
    );
  }
  if (capability !== null && !policy.capabilities.includes(capability)) {
    throw new McpPolicyError('E_CAPABILITY_DENY', `${name} requires capability ${capability}.`, {
      required_capability: capability,
    });
  }
  return capability;
}

export function filterTools<T extends { name: string }>(tools: readonly T[], policy: McpPolicy): T[] {
  return tools.filter((tool) => isToolAllowed(tool.name, policy));
}

/** Expand a tool-group list into the minimal capability set those groups need. */
export function capabilitiesForGroups(groups: readonly McpToolGroup[]): McpCapability[] {
  const result = new Set<McpCapability>();
  for (const [name, capability] of Object.entries(TOOL_CAPABILITIES)) {
    if (capability === null) continue;
    const group = TOOL_GROUPS[name];
    if (group && groups.includes(group)) result.add(capability);
  }
  return [...result];
}
