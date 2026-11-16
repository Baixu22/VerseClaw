import path from "node:path";
import { realpath } from "node:fs/promises";
import YAML from "yaml";
import {
  resolveAgentWorkspaceDir,
  resolveDefaultAgentId,
  resolveSessionAgentId,
} from "../agents/agent-scope.js";
import { resolveMemorySearchConfig } from "../agents/memory-search.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { getSessionEntry } from "../config/sessions/store.js";
import { resolveStorePath } from "../config/sessions/paths.js";
import { getAgentRunContext } from "../infra/agent-events.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { normalizePluginsConfig } from "../plugins/config-state.js";
import { getActiveMemorySearchManager } from "../plugins/memory-runtime.js";
import { getMemoryRuntime, getMemoryCapabilityRegistration } from "../plugins/memory-state.js";
import {
  createOwnerReadSnapshot,
  deriveReadAdmissionContext,
  readOwnerReadPolicyMetadata,
  digestOwnerReadContent,
  evaluateOwnerReadPolicy,
  matchOwnerReadPin,
  type SourceRefV2,
  type OwnerReadRejectionCode,
} from "../runtime-core/knowledge-owner-read.js";
import type { MemoryOwnerReadResult } from "../../../shared/knowledge/memory.js";

type MemoryReadIdentity = {
  sessionId?: string;
  agentSessionKey?: string;
  workspaceId?: string;
  workspaceDir?: string;
  egressProviderRefs?: string[];
};

/** Read through the selected provider, retaining its exact namespace and file bytes. */
export async function readNativeMemorySource(input: {
  cfg?: OpenClawConfig;
  agentId?: string;
  identity?: MemoryReadIdentity;
  lookup: string;
  sourceRef?: SourceRefV2;
  signal?: AbortSignal;
  internalRunId?: string;
}): Promise<MemoryOwnerReadResult> {
  const deny = (reason: OwnerReadRejectionCode): MemoryOwnerReadResult => ({
    status: "denied",
    reason,
  });
  if (!input.cfg || input.signal?.aborted)
    return deny(input.signal?.aborted ? "cancelled" : "not_found");
  try {
    const cfg = input.cfg;
    const plugins = normalizePluginsConfig(cfg.plugins);
    const slot = plugins.slots.memory;
    if (
      !plugins.enabled ||
      !slot ||
      slot === "none" ||
      slot === "runtime-memory" ||
      plugins.deny.includes(slot) ||
      plugins.entries[slot]?.enabled === false
    )
      return deny("not_found");
    const identity = input.identity ?? {};
    const sessionAgentId = identity.agentSessionKey
      ? resolveSessionAgentId({ config: cfg, sessionKey: identity.agentSessionKey })
      : resolveDefaultAgentId(cfg);
    const agentId = input.agentId ? normalizeAgentId(input.agentId) : sessionAgentId;
    if (identity.agentSessionKey && agentId !== sessionAgentId) return deny("scope_mismatch");
    if (!resolveMemorySearchConfig(cfg, agentId)) return deny("denied");
    const session = identity.agentSessionKey
      ? getSessionEntry({
          agentId,
          sessionKey: identity.agentSessionKey,
          storePath: resolveStorePath(cfg.session?.store, { agentId }),
        })
      : undefined;
    const internalRead =
      !session && input.internalRunId
        ? getAgentRunContext(input.internalRunId)?.internalKnowledgeRead
        : undefined;
    const trustedInternalRead =
      internalRead &&
      internalRead.sessionKey === identity.agentSessionKey &&
      internalRead.sessionId === identity.sessionId &&
      internalRead.workspaceId === identity.workspaceId;
    if (identity.sessionId && session?.sessionId !== identity.sessionId && !trustedInternalRead)
      return deny("invalid_context");
    const sessionGeneration = session?.sessionId ?? internalRead?.sessionId;
    const sessionWorkspaceId = session?.workspaceId;
    const { manager } = await getActiveMemorySearchManager({
      cfg,
      agentId,
      purpose: "status",
      expectedRuntimePluginId: slot,
    });
    if (!manager) return deny("not_found");
    const runtime = getMemoryRuntime();
    const status = manager.status();
    const canonicalPath = async (directory: string) => {
      const resolved = (await realpath(path.resolve(directory))).replace(/\\/g, "/");
      return process.platform === "win32" ? resolved.toLowerCase() : resolved;
    };
    const workspaceDir = status.workspaceDir ?? resolveAgentWorkspaceDir(cfg, agentId);
    const canonicalRoot = await canonicalPath(workspaceDir);
    if (trustedInternalRead && (await canonicalPath(internalRead.workspaceDir)) !== canonicalRoot)
      return deny("scope_mismatch");
    if ((await canonicalPath(identity.workspaceDir ?? workspaceDir)) !== canonicalRoot)
      return deny("scope_mismatch");
    const sessionRoot = session?.workspaceDir
      ? await canonicalPath(session.workspaceDir)
      : undefined;
    if (
      (sessionRoot && sessionRoot !== canonicalRoot) ||
      (sessionWorkspaceId && identity.workspaceId && sessionWorkspaceId !== identity.workspaceId)
    )
      return deny("scope_mismatch");
    const namespaceId = `native-memory:${digestOwnerReadContent(JSON.stringify([slot, agentId, canonicalRoot])).slice(7)}`;
    const context = deriveReadAdmissionContext({
      principalId: "operator",
      agentId,
      sessionId:
        sessionGeneration ??
        identity.sessionId ??
        identity.agentSessionKey ??
        `knowledge-ui:${agentId}`,
      ...(identity.agentSessionKey ? { sessionKey: identity.agentSessionKey } : {}),
      workspaceId: identity.workspaceId ?? canonicalRoot,
      workspaceRootDigest: digestOwnerReadContent(canonicalRoot),
      ownerNamespaces: [namespaceId],
      policyDigest: digestOwnerReadContent(
        JSON.stringify(["native-memory-read-v1", slot, agentId, canonicalRoot]),
      ),
      egressProviderRefs: identity.egressProviderRefs ?? Object.keys(cfg.models?.providers ?? {}),
      expiresAt: new Date(Date.now() + 30_000).toISOString(),
    });
    if (
      input.sourceRef &&
      (input.sourceRef.domain !== "native-memory" ||
        input.sourceRef.authorityId !== "native-memory" ||
        input.sourceRef.namespaceId !== namespaceId)
    )
      return deny("namespace_mismatch");
    const lookup = input.sourceRef?.subjectId ?? input.lookup.replace(/^native-memory:/, "");
    const file = await manager.readFile({ relPath: lookup, raw: true });
    if (
      (await canonicalPath(
        manager.status().workspaceDir ?? resolveAgentWorkspaceDir(cfg, agentId),
      )) !== canonicalRoot
    )
      return deny("scope_mismatch");
    const currentPlugins = normalizePluginsConfig(cfg.plugins);
    const currentSession = identity.agentSessionKey
      ? getSessionEntry({
          agentId,
          sessionKey: identity.agentSessionKey,
          storePath: resolveStorePath(cfg.session?.store, { agentId }),
        })
      : undefined;
    const currentSessionRoot = currentSession?.workspaceDir
      ? await canonicalPath(currentSession.workspaceDir)
      : undefined;
    if (currentSessionRoot !== sessionRoot || currentSession?.workspaceId !== sessionWorkspaceId)
      return deny("scope_mismatch");
    if (
      !currentPlugins.enabled ||
      currentPlugins.slots.memory !== slot ||
      currentPlugins.entries[slot]?.enabled === false ||
      currentPlugins.deny.includes(slot) ||
      !resolveMemorySearchConfig(cfg, agentId) ||
      getMemoryRuntime() !== runtime ||
      getMemoryCapabilityRegistration()?.runtimePluginId !== slot ||
      currentSession?.sessionId !== session?.sessionId ||
      (trustedInternalRead &&
        getAgentRunContext(input.internalRunId!)?.internalKnowledgeRead !== internalRead) ||
      input.signal?.aborted
    )
      return deny(input.signal?.aborted ? "cancelled" : "invalid_context");
    if (!file.text || file.truncated) return deny("not_found");
    const header = file.text.match(/^\s*---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    const metadata: unknown = header ? YAML.parse(header[1]) : {};
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return deny("denied");
    const policy = readOwnerReadPolicyMetadata(metadata as Record<string, unknown>);
    const ownerPolicyDenied = evaluateOwnerReadPolicy(policy, context, namespaceId, {
      signal: input.signal,
    });
    if (ownerPolicyDenied) return deny(ownerPolicyDenied);
    policy.scope = { ...policy.scope, agentId: context.agentId, workspaceId: context.workspaceId };
    let startChar = 0,
      endChar = file.text.length;
    if (input.sourceRef?.locator) {
      const range = input.sourceRef.locator,
        bytes = Buffer.from(file.text, "utf8");
      if (range.endByteExclusive > bytes.length) return deny("invalid_range");
      try {
        const decoder = new TextDecoder("utf8", { fatal: true, ignoreBOM: true });
        startChar = decoder.decode(bytes.subarray(0, range.startByte)).length;
        endChar =
          startChar +
          decoder.decode(bytes.subarray(range.startByte, range.endByteExclusive)).length;
      } catch {
        return deny("invalid_range");
      }
    }
    const snapshot = createOwnerReadSnapshot({
      raw: file.text,
      startChar,
      endChar,
      policy,
      context,
      title: file.path,
      source: {
        domain: "native-memory",
        authorityId: "native-memory",
        namespaceId,
        subjectId: file.path,
        revision: digestOwnerReadContent(file.text),
      },
    });
    const mismatch = input.sourceRef ? matchOwnerReadPin(snapshot, input.sourceRef) : undefined;
    return mismatch ? deny(mismatch) : { status: "admitted", snapshot };
  } catch {
    return deny(input.signal?.aborted ? "cancelled" : "denied");
  }
}
