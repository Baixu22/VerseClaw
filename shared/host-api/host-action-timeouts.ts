/**
 * Host-action timeout policy — single source of truth for BOTH the Main
 * process dispatcher (enforcement) and the renderer client (last-line
 * fallback). R0-4: a hung host action must fail closed with a TIMEOUT
 * instead of leaving the renderer waiting forever.
 */

export const HOST_ACTION_DEFAULT_TIMEOUT_MS = 60_000;
export const HOST_ACTION_LONG_TIMEOUT_MS = 15 * 60_000;

/**
 * Actions that legitimately exceed the default budget. Rationale per entry:
 * - git.fetch/pull/push: network-bound on large repos / slow remotes
 * - skills.install/installAll: git clone + dependency install steps
 * - app.openClawDoctor: full openclaw doctor diagnostic run
 * - updates.download: downloads the update artifact
 * - uv.installAll / officecli.install: downloads tool binaries
 * - agentDev.workbenchEvidence: runs validation gates
 * - diagnostics.exportSupportBundle: bundles logs and reports
 * - vtoken.assemble: long-running ingestion assembly
 * - dcsProdFlags.setFlag/setPreview/setWorkspaceContext: bounded restart followed by runtime ack
 * - chat.sendWithMedia: a real agent turn may run several read/edit/exec steps
 * - sessions.compact/compactRange: the runtime may need a live-model summary
 * (No host-api git.clone or E2E-run action exists in the current contract.)
 */
const HOST_ACTION_LONG_SET = new Set<string>([
  'git.fetch',
  'git.pull',
  'git.push',
  'skills.install',
  'skills.installAll',
  'app.openClawDoctor',
  'updates.download',
  'uv.installAll',
  'officecli.install',
  'agentDev.workbenchEvidence',
  'diagnostics.exportSupportBundle',
  'vtoken.assemble',
  'dcsProdFlags.setFlag',
  'dcsProdFlags.setPreview',
  'dcsProdFlags.setWorkspaceContext',
  'chat.sendWithMedia',
  'sessions.compact',
  'sessions.compactRange',
]);

export function hostActionTimeoutMs(module: string, action: string): number {
  return HOST_ACTION_LONG_SET.has(module + '.' + action)
    ? HOST_ACTION_LONG_TIMEOUT_MS
    : HOST_ACTION_DEFAULT_TIMEOUT_MS;
}
