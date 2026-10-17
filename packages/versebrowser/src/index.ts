/**
 * versebrowser — standalone Agent Browser engine.
 *
 * Public surface for hosts embedding the browser automation subsystem.
 */
export * from './core/types.ts';
export * from './core/tool-registry.ts';
export * from './core/tool-authorization.ts';
export * from './core/browser-control.ts';
export * from './core/filesystem-boundary.ts';
export * from './core/network-context.ts';
export * from './contracts/index.ts';
export * from './evidence/index.ts';
export * from './types/host-api.ts';

export { AgentBrowserService } from './engine/service.ts';
export { createDefaultAgentBrowserCliRunner } from './engine/cli-runner.ts';
export { AgentBrowserFacade, type FacadeOptions, type VerifyFlowOptions } from './engine/facade.ts';
export { createAgentBrowserApi, getDefaultAgentBrowserService } from './engine/api.ts';
export { AgentBrowserTaskService } from './engine/task-service.ts';
export { AgentBrowserVault } from './engine/vault.ts';

export {
  setPermissionDecisionRecorder,
  recordPermissionDecisionEvent,
} from './host/permissions-hooks.ts';
export {
  setActiveWorkspaceProfileProvider,
  getActiveWorkspaceProfile,
} from './host/workspace-hooks.ts';
export {
  setSensitiveCapturePolicyLoader,
  getSensitiveCapturePolicy,
} from './host/sensitive-capture-policy-loader.ts';
export { getDataDir, setDataDirProvider } from './host/paths.ts';
export {
  WORKSPACE_AE_DIR,
  WORKSPACE_EVIDENCE_DIR,
  WORKSPACE_SESSIONS_DIR,
  setWorkspaceRoot,
  setWorkspaceRootProvider,
  getWorkspaceRoot,
  getWorkspaceEvidenceRoot,
  getWorkspaceSessionsRoot,
  getWorkspaceSessionDir,
  getWorkspaceEvidencePackDir,
  toWorkspaceRelative,
} from './host/workspace-paths.ts';
export {
  evaluateRedline,
  assertRedlineAllowed,
  REDLINE_DOCS_SNIPPET,
} from './security/redline-policy.ts';
export {
  assertAuthorizationDeclared,
  AUTHORIZATION_REQUIRED_PLAYBOOK_IDS,
  getAutomationPlaybookById,
  getRegisteredAutomationPlaybooks,
} from './core/automation-playbooks.ts';
export { HitlSessionStore, isHumanOnlyGate } from './engine/hitl-checkpoint.ts';
export {
  MultiAgentBoundary,
  multiAgentBoundary,
  multiAgentBoundaryError,
} from './collab/multi-agent-boundary.ts';
export {
  AuditTrail,
  auditTrail,
  auditEventFromHitl,
  createAuditEvent,
  AUDIT_ACTIONS,
  AUDIT_TRAIL_SCHEMA_VERSION,
} from './security/audit-trail.ts';
export {
  buildEvidenceIndex,
  writeEvidenceIndex,
  readEvidenceIndex,
  applyPolicyBundle,
  createDefaultPolicyBundle,
  serializePolicyBundle,
  REMOTE_INDEX_SCHEMA_VERSION,
  POLICY_BUNDLE_SCHEMA_VERSION,
} from './collab/remote-policy.ts';

export { explainError, createFsSourceMapResolver, type SourceMapResolver } from './mcp/explain-error.ts';
