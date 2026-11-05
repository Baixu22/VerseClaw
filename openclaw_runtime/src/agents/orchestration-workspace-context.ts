import { realpathSync, statSync } from "node:fs";
import path from "node:path";
import { isRecord } from "@openclaw/normalization-core/record-coerce";
import { normalizeOptionalString as readString } from "@openclaw/normalization-core/string-coerce";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { resolveGatewaySessionStoreTargetWithStore, resolveFreshestSessionEntryFromStoreKeys } from "../gateway/session-utils.js";
import { resolveAgentWorkspaceDir } from "./agent-scope.js";
import type { DelegationAdmissionContext } from "./delegation-admission.js";
import type { RoleSpawnContext } from "./role-spawn.js";

function canonicalWorkspace(value: string): string {
  const root = realpathSync(value);
  if (!statSync(root).isDirectory()) throw new Error("Parent workspace is not a directory");
  return root;
}

function sameWorkspace(left: string, right: string): boolean {
  return path.relative(left, right) === "";
}

/** Read the same parent session/config owners used by agent execution; request paths are assertions only. */
export function resolveOrchestrationContext(
  params: Record<string, unknown>,
  getConfig: () => OpenClawConfig,
  admission?: DelegationAdmissionContext,
): RoleSpawnContext {
  const sessionKey = readString(params.sessionKey);
  if (!sessionKey) {
    if (params.workspaceDir !== undefined || admission) throw new Error("workspace requires a parent sessionKey");
    return {};
  }
  const readParent = () => {
    const cfg = getConfig();
    const target = resolveGatewaySessionStoreTargetWithStore({ cfg, key: sessionKey });
    const entry = resolveFreshestSessionEntryFromStoreKeys(target.store, target.storeKeys);
    if (!entry?.sessionId) throw new Error("Parent session generation is missing");
    const root = entry.workspaceDir
      ?? (entry.spawnedBy ? entry.spawnedWorkspaceDir : undefined)
      ?? resolveAgentWorkspaceDir(cfg, target.agentId);
    return { agentId: target.agentId, sessionKey: target.canonicalKey, expectedSessionId: entry.sessionId, root: canonicalWorkspace(root) };
  };
  const parent = readParent();
  if (params.agentId !== undefined && readString(params.agentId) !== parent.agentId) {
    throw new Error("Requested agent differs from the authorized parent session");
  }
  const requestedRoot = readString(params.workspaceDir);
  if (params.workspaceDir !== undefined && (!requestedRoot || !sameWorkspace(canonicalWorkspace(requestedRoot), parent.root))) {
    throw new Error("Requested workspace differs from the authorized parent workspace");
  }
  if (params.expectedSessionGeneration !== undefined && params.expectedSessionGeneration !== parent.expectedSessionId) {
    throw new Error("Parent session generation changed");
  }
  if (admission) {
    const coordinator = admission.coordinator;
    if (coordinator.sessionKey !== parent.sessionKey || coordinator.agentId !== parent.agentId
      || coordinator.sessionId !== parent.expectedSessionId) {
      throw new Error("Delegation coordinator session or generation differs from the parent");
    }
    const rawAdmission = isRecord(params.delegationAdmission) ? params.delegationAdmission : {};
    const environment = isRecord(rawAdmission.parentEnvironment) ? rawAdmission.parentEnvironment : undefined;
    if (environment && (!readString(environment.canonicalRoot)
      || !sameWorkspace(canonicalWorkspace(String(environment.canonicalRoot)), parent.root))) {
      throw new Error("Delegation workspace differs from the authorized parent workspace");
    }
  }
  return {
    agentSessionKey: parent.sessionKey,
    requesterAgentIdOverride: parent.agentId,
    workspaceDir: parent.root,
    workspaceOwner: { agentId: parent.agentId, sessionKey: parent.sessionKey, expectedSessionId: parent.expectedSessionId },
    assertWorkspaceCurrent() {
      const current = readParent();
      if (current.expectedSessionId !== parent.expectedSessionId || current.agentId !== parent.agentId
        || current.sessionKey !== parent.sessionKey || !sameWorkspace(current.root, parent.root)) {
        throw new Error("Parent workspace or session generation changed before spawn");
      }
    },
  };
}

