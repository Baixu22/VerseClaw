// Core gateway method descriptors keep handler names, auth scopes, startup availability, and write policy in one table.
import type { OperatorScope } from "../operator-scopes.js";
import { GATEWAY_AUX_METHODS } from "../server-aux-methods.js";
import {
  DYNAMIC_GATEWAY_METHOD_SCOPE,
  NODE_GATEWAY_METHOD_SCOPE,
  type GatewayMethodDescriptorInput,
  type GatewayMethodHandler,
  type GatewayMethodScope,
} from "./descriptor.js";

type CoreGatewayMethodSpec = {
  name: string;
  scope: GatewayMethodScope;
  advertise?: false;
  startup?: true;
  controlPlaneWrite?: true;
};

// This is the canonical core method policy table: every core handler must appear here so
// listing, authorization, startup availability, and write throttling stay in sync.
export const CORE_GATEWAY_METHOD_SPECS: readonly CoreGatewayMethodSpec[] = [
  { name: "health", scope: "operator.read" },
  { name: "diagnostics.stability", scope: "operator.read" },
  // FP-P0-04: child-runtime flag acknowledgement read by the Electron control plane.
  { name: "runtime.flags.ack", scope: "operator.read" },
  { name: "doctor.memory.status", scope: "operator.read" },
  { name: "doctor.memory.dreamDiary", scope: "operator.read" },
  { name: "doctor.memory.backfillDreamDiary", scope: "operator.write" },
  { name: "doctor.memory.resetDreamDiary", scope: "operator.write" },
  { name: "doctor.memory.resetGroundedShortTerm", scope: "operator.write" },
  { name: "doctor.memory.repairDreamingArtifacts", scope: "operator.write" },
  { name: "doctor.memory.dedupeDreamDiary", scope: "operator.write" },
  { name: "doctor.memory.remHarness", scope: "operator.read" },
  { name: "logs.tail", scope: "operator.read" },
  { name: "status", scope: "operator.read" },
  { name: "localControlPlane.status", scope: "operator.read" },
  { name: "localControlPlane.reports", scope: "operator.read" },
  { name: "localControlPlane.correlations", scope: "operator.read" },
  { name: "usage.status", scope: "operator.read" },
  { name: "usage.cost", scope: "operator.read" },
  { name: "config.get", scope: "operator.read" },
  { name: "config.set", scope: "operator.admin" },
  { name: "config.apply", scope: "operator.admin", controlPlaneWrite: true },
  { name: "config.patch", scope: "operator.admin", controlPlaneWrite: true },
  { name: "config.schema", scope: "operator.admin" },
  { name: "config.schema.lookup", scope: "operator.read" },
  { name: "exec.approvals.get", scope: "operator.admin" },
  { name: "exec.approvals.set", scope: "operator.admin" },
  { name: "exec.approvals.node.get", scope: "operator.admin" },
  { name: "exec.approvals.node.set", scope: "operator.admin" },
  { name: "exec.approval.get", scope: "operator.approvals" },
  { name: "exec.approval.list", scope: "operator.approvals" },
  { name: "exec.approval.request", scope: "operator.approvals" },
  { name: "exec.approval.waitDecision", scope: "operator.approvals" },
  { name: "exec.approval.resolve", scope: "operator.approvals" },
  { name: "plugin.approval.list", scope: "operator.approvals" },
  { name: "plugin.approval.request", scope: "operator.approvals" },
  { name: "plugin.approval.waitDecision", scope: "operator.approvals" },
  { name: "plugin.approval.resolve", scope: "operator.approvals" },
  { name: "plugins.uiDescriptors", scope: "operator.read" },
  { name: "plugins.sessionAction", scope: "dynamic" },
  { name: "wizard.start", scope: "operator.admin" },
  { name: "wizard.next", scope: "operator.admin" },
  { name: "wizard.cancel", scope: "operator.admin" },
  { name: "wizard.status", scope: "operator.admin" },
  { name: "commands.list", scope: "operator.read" },
  { name: "models.list", scope: "operator.read", startup: true },
  { name: "models.authStatus", scope: "operator.read" },
  { name: "models.authLogout", scope: "operator.admin", controlPlaneWrite: true },
  { name: "tools.catalog", scope: "operator.read" },
  { name: "tools.effective", scope: "operator.read", startup: true },
  { name: "capabilities.publications", scope: "operator.read" },
  { name: "tools.invoke", scope: "operator.write" },
  { name: "agentBrowser.invoke", scope: "operator.write", advertise: false },
  { name: "agentBrowser.invoke.result", scope: "operator.admin", advertise: false },
  { name: "tasks.list", scope: "operator.read" },
  { name: "tasks.get", scope: "operator.read" },
  { name: "tasks.cancel", scope: "operator.write" },
  { name: "agents.list", scope: "operator.read" },
  { name: "agents.create", scope: "operator.admin" },
  { name: "agents.update", scope: "operator.admin" },
  { name: "agents.delete", scope: "operator.admin" },
  { name: "agents.files.list", scope: "operator.read" },
  { name: "agents.files.get", scope: "operator.read" },
  { name: "agents.files.set", scope: "operator.admin" },
  // Role-first runtime: role registry, team templates, and orchestration.
  { name: "roles.list", scope: "operator.read" },
  { name: "roles.get", scope: "operator.read" },
  { name: "teams.list", scope: "operator.read" },
  { name: "orchestrator.plan", scope: "operator.read" },
  { name: "orchestrator.run", scope: "operator.write" },
  { name: "task_loop.run", scope: "operator.write" },
  { name: "task_loop.status", scope: "operator.read" },
  // Mission Control: long-goal outer loop above bounded task_loop.
  { name: "mission.create", scope: "operator.write" },
  { name: "mission.run", scope: "operator.write" },
  { name: "mission.tick", scope: "operator.write" },
  { name: "mission.status", scope: "operator.read" },
  { name: "mission.pause", scope: "operator.write" },
  { name: "mission.resume", scope: "operator.write" },
  { name: "mission.cancel", scope: "operator.write" },
  // ClawGraph Runtime: workspace YAML compile/read methods plus controlled DAG execution.
  { name: "clawgraph.listWorkflows", scope: "operator.read" },
  { name: "clawgraph.compile", scope: "operator.read" },
  { name: "clawgraph.status", scope: "operator.read" },
  { name: "clawgraph.events", scope: "operator.read" },
  { name: "clawgraph.run", scope: "operator.write" },
  { name: "clawgraph.abort", scope: "operator.write" },
  { name: "clawgraph.review", scope: "operator.write" },
  // Observability bridge: reportTraces writes, traces read.
  { name: "observability.reportTrace", scope: "operator.write" },
  { name: "observability.traces", scope: "operator.read" },
  { name: "observability.readFrom", scope: "operator.read" },
  { name: "observability.subscribe", scope: "operator.read" },
  { name: "observability.unsubscribe", scope: "operator.read" },
  // Security/verification shadow MVP: read/simulate only; no active enforcement.
  { name: "security.health", scope: "operator.read" },
  { name: "security.policy.get", scope: "operator.read" },
  { name: "security.policy.simulate", scope: "operator.read" },
  { name: "security.intercepts.list", scope: "operator.read" },
  { name: "verification.health", scope: "operator.read" },
  { name: "verification.run", scope: "operator.read" },
  { name: "verification.status", scope: "operator.read" },
  { name: "verification.results.list", scope: "operator.read" },
  { name: "verification.results.get", scope: "operator.read" },
  // Memory subsystem: read cards, store gatekeeper-reviewed proposals.
  { name: "memory.list", scope: "operator.read" },
  { name: "memory.conflicts", scope: "operator.read" },
  { name: "memory.conflictDetail", scope: "operator.read" },
  { name: "memory.explainInjection", scope: "operator.read" },
  // R3-2.2 COMPASS memory-injection receipt read ("本轮注入了什么").
  { name: "memory.injectionReceipts", scope: "operator.read" },
  // R3-2.4 proposeFacts manual-confirm queue (read) + confirm (write).
  { name: "memory.proposeFacts.list", scope: "operator.read" },
  { name: "memory.proposeFacts.confirm", scope: "operator.write" },
  { name: "memory.proposals", scope: "operator.read" },
  { name: "memory.versions", scope: "operator.read" },
  { name: "memory.audit", scope: "operator.read" },
  { name: "memory.stats", scope: "operator.read" },
  { name: "memory.policy", scope: "operator.read" },
  { name: "memory.retentionCandidates", scope: "operator.read" },
  { name: "memory.evidenceCheck", scope: "operator.read" },
  { name: "memory.simulateInjection", scope: "operator.read" },
  { name: "memory.health", scope: "operator.read" },
  { name: "memory.governance", scope: "operator.read" },
  { name: "memory.operatorInspection", scope: "operator.admin" },
  { name: "memory.utilityReport", scope: "operator.read" },
  { name: "memory.evalReport", scope: "operator.read" },
  { name: "memory.detail", scope: "operator.read" },
  { name: "memory.previewProposal", scope: "operator.read" },
  { name: "memory.feedbackList", scope: "operator.read" },
  { name: "memory.propose", scope: "operator.write" },
  { name: "memory.feedback", scope: "operator.write" },
  { name: "memory.store", scope: "operator.write" },
  { name: "memory.update", scope: "operator.write" },
  { name: "memory.archive", scope: "operator.write" },
  { name: "memory.supersede", scope: "operator.write" },
  { name: "memory.restore", scope: "operator.write" },
  { name: "memory.retentionPropose", scope: "operator.write" },
  { name: "memory.review", scope: "operator.write" },
  { name: "memory.reviewBatch", scope: "operator.write" },
  { name: "memory.merge", scope: "operator.write" },
  { name: "memory.mergeDraft", scope: "operator.write" },
  { name: "memory.resolveConflict", scope: "operator.write" },
  { name: "artifacts.list", scope: "operator.read" },
  { name: "artifacts.get", scope: "operator.read" },
  { name: "artifacts.download", scope: "operator.read" },
  { name: "skills.status", scope: "operator.read" },
  { name: "skills.search", scope: "operator.read" },
  { name: "skills.detail", scope: "operator.read" },
  { name: "skills.securityVerdicts", scope: "operator.read" },
  { name: "skills.skillCard", scope: "operator.read" },
  { name: "skills.bins", scope: "node" },
  { name: "skills.upload.begin", scope: "operator.admin" },
  { name: "skills.upload.chunk", scope: "operator.admin" },
  { name: "skills.upload.commit", scope: "operator.admin" },
  { name: "skills.install", scope: "operator.admin" },
  { name: "skills.update", scope: "operator.admin" },
  { name: "skills.proposals.list", scope: "operator.read" },
  { name: "skills.proposals.inspect", scope: "operator.read" },
  { name: "skills.proposals.create", scope: "operator.admin" },
  { name: "skills.proposals.update", scope: "operator.admin" },
  { name: "skills.proposals.revise", scope: "operator.admin" },
  { name: "skills.proposals.requestRevision", scope: "operator.admin" },
  { name: "skills.proposals.apply", scope: "operator.admin" },
  { name: "skills.proposals.reject", scope: "operator.admin" },
  { name: "skills.proposals.quarantine", scope: "operator.admin" },
  { name: "update.status", scope: "operator.admin" },
  { name: "update.run", scope: "operator.admin", controlPlaneWrite: true },
  { name: "secrets.reload", scope: "operator.admin" },
  { name: "secrets.resolve", scope: "operator.admin" },
  { name: "sessions.list", scope: "operator.read", startup: true },
  { name: "session.activitySnapshot", scope: "operator.read" },
  { name: "sessions.subscribe", scope: "operator.read" },
  { name: "sessions.unsubscribe", scope: "operator.read" },
  { name: "sessions.messages.subscribe", scope: "operator.read" },
  { name: "sessions.messages.unsubscribe", scope: "operator.read" },
  { name: "sessions.preview", scope: "operator.read" },
  { name: "sessions.describe", scope: "operator.read" },
  { name: "sessions.compactionStatus", scope: "operator.read" },
  { name: "sessions.compactionHistory", scope: "operator.read" },
  { name: "sessions.recallOriginal", scope: "operator.read" },
  { name: "sessions.expandSelector", scope: "operator.read" },
  { name: "sessions.compressionArtifact", scope: "operator.read" },
  { name: "sessions.recoveryContext", scope: "operator.read" },  { name: "sessions.longTaskControlStatus", scope: "operator.read" },
  { name: "sessions.longTaskControlHistory", scope: "operator.read" },
  { name: "sessions.resumeCheckpoints", scope: "operator.read" },
  { name: "sessions.checkpointDiff", scope: "operator.read" },
  { name: "sessions.restoreCheckpoint", scope: "operator.write" },
  { name: "sessions.queueDrain", scope: "operator.write" },
  { name: "sessions.yieldState", scope: "operator.read" },
  { name: "sessions.lifecycleLedger", scope: "operator.read" },
  { name: "sessions.compaction.list", scope: "operator.read" },
  { name: "sessions.compaction.get", scope: "operator.read" },
  { name: "sessions.compaction.branch", scope: "operator.write" },
  { name: "sessions.compaction.restore", scope: "operator.admin" },
  { name: "sessions.create", scope: "operator.write", startup: true },
  { name: "sessions.fork", scope: "operator.write", startup: true },
  { name: "sessions.send", scope: "operator.write", startup: true },
  { name: "sessions.abort", scope: "operator.write", startup: true },
  { name: "sessions.stop", scope: "operator.admin" },
  { name: "sessions.patch", scope: "operator.admin" },
  { name: "sessions.pluginPatch", scope: "operator.admin" },
  { name: "sessions.cleanup", scope: "operator.admin" },
  { name: "sessions.reset", scope: "operator.admin" },
  { name: "sessions.delete", scope: "operator.admin" },
  { name: "sessions.compact", scope: "operator.admin" },
  { name: "sessions.compactRange", scope: "operator.admin" },
  { name: "last-heartbeat", scope: "operator.read" },
  { name: "set-heartbeats", scope: "operator.admin" },
  { name: "wake", scope: "operator.write" },
  { name: "node.pair.request", scope: "operator.pairing" },
  { name: "node.pair.list", scope: "operator.pairing" },
  { name: "node.pair.approve", scope: "operator.pairing" },
  { name: "node.pair.reject", scope: "operator.pairing" },
  { name: "node.pair.remove", scope: "operator.pairing" },
  { name: "node.pair.verify", scope: "operator.pairing" },
  { name: "device.pair.list", scope: "operator.pairing" },
  { name: "device.pair.approve", scope: "operator.pairing" },
  { name: "device.pair.reject", scope: "operator.pairing" },
  { name: "device.pair.remove", scope: "operator.pairing" },
  { name: "device.token.rotate", scope: "operator.pairing" },
  { name: "device.token.revoke", scope: "operator.pairing" },
  { name: "node.rename", scope: "operator.pairing" },
  { name: "node.list", scope: "operator.read" },
  { name: "node.describe", scope: "operator.read" },
  { name: "node.pluginSurface.refresh", scope: "node" },
  { name: "node.pending.drain", scope: "node" },
  { name: "node.pending.enqueue", scope: "operator.write" },
  { name: "node.invoke", scope: "operator.write" },
  { name: "node.pending.pull", scope: "node" },
  { name: "node.pending.ack", scope: "node" },
  { name: "node.invoke.result", scope: "node" },
  { name: "node.event", scope: "node" },
  { name: "cron.get", scope: "operator.read" },
  { name: "cron.list", scope: "operator.read" },
  { name: "cron.status", scope: "operator.read" },
  { name: "cron.add", scope: "operator.admin" },
  { name: "cron.update", scope: "operator.admin" },
  { name: "cron.remove", scope: "operator.admin" },
  { name: "cron.run", scope: "operator.admin" },
  { name: "cron.runs", scope: "operator.read" },
  { name: "channels.status", scope: "operator.read" },
  { name: "channels.start", scope: "operator.admin" },
  { name: "channels.stop", scope: "operator.admin" },
  { name: "channels.logout", scope: "operator.admin" },
  { name: "gateway.identity.get", scope: "operator.read" },
  { name: "gateway.restart.preflight", scope: "operator.read" },
  { name: "gateway.restart.request", scope: "operator.admin", controlPlaneWrite: true },
  { name: "system-presence", scope: "operator.read" },
  { name: "system-event", scope: "operator.admin" },
  { name: "message.action", scope: "operator.write" },
  { name: "send", scope: "operator.write" },
  { name: "agent", scope: "operator.write" },
  { name: "agent.identity.get", scope: "operator.read" },
  { name: "agent.wait", scope: "operator.write", startup: true },
  { name: "chat.history", scope: "operator.read", startup: true },
  { name: "chat.startup", scope: "operator.read", startup: true },
  { name: "chat.metadata", scope: "operator.read", startup: true },
  { name: "chat.message.get", scope: "operator.read", startup: true },
  { name: "chat.abort", scope: "operator.write" },
  { name: "chat.send", scope: "operator.write" },
  { name: "sessions.get", scope: "operator.read", advertise: false },
  { name: "sessions.resolve", scope: "operator.read", advertise: false },
  { name: "sessions.usage", scope: "operator.read", advertise: false },
  { name: "sessions.usage.timeseries", scope: "operator.read", advertise: false },
  { name: "sessions.usage.logs", scope: "operator.read", advertise: false },
  { name: "poll", scope: "operator.write", advertise: false },
  { name: "sessions.steer", scope: "operator.write", advertise: false },
  { name: "config.openFile", scope: "operator.admin", advertise: false },
  { name: "connect", scope: "operator.admin", advertise: false },
  { name: "chat.inject", scope: "operator.admin", advertise: false },
  { name: "nativeHook.invoke", scope: "operator.admin", advertise: false },
  { name: "web.login.start", scope: "operator.admin", advertise: false },
  { name: "web.login.wait", scope: "operator.admin", advertise: false },
] as const;

const CORE_GATEWAY_METHOD_SPEC_BY_NAME: ReadonlyMap<string, CoreGatewayMethodSpec> = new Map(
  CORE_GATEWAY_METHOD_SPECS.map((spec) => [spec.name, spec]),
);

/** Core methods that are listed early but return retryable unavailable until sidecars are ready. */
export const STARTUP_UNAVAILABLE_GATEWAY_METHODS = CORE_GATEWAY_METHOD_SPECS.filter(
  (spec) => spec.startup === true,
).map((spec) => spec.name);

/** Returns the core methods that should be advertised to external gateway clients. */
export function listCoreAdvertisedGatewayMethodNames(): string[] {
  return CORE_GATEWAY_METHOD_SPECS.filter((spec) => spec.advertise !== false).map(
    (spec) => spec.name,
  );
}

/** Returns all registered core method names, including hidden/internal compatibility methods. */
export function listCoreGatewayMethodNames(): string[] {
  return CORE_GATEWAY_METHOD_SPECS.map((spec) => spec.name);
}

/** Looks up the raw core method scope, including node and dynamic sentinel scopes. */
export function resolveCoreGatewayMethodScope(method: string): GatewayMethodScope | undefined {
  return CORE_GATEWAY_METHOD_SPEC_BY_NAME.get(method)?.scope;
}

/** Looks up an operator-only core method scope, excluding node and dynamic methods. */
export function resolveCoreOperatorGatewayMethodScope(method: string): OperatorScope | undefined {
  const scope = resolveCoreGatewayMethodScope(method);
  return scope === NODE_GATEWAY_METHOD_SCOPE || scope === DYNAMIC_GATEWAY_METHOD_SCOPE
    ? undefined
    : scope;
}

/** Returns true for core methods reserved for authenticated node clients. */
export function isCoreNodeGatewayMethod(method: string): boolean {
  return resolveCoreGatewayMethodScope(method) === NODE_GATEWAY_METHOD_SCOPE;
}

/** Returns true for core methods whose required operator scope is resolved by the handler. */
export function isDynamicOperatorGatewayMethod(method: string): boolean {
  return resolveCoreGatewayMethodScope(method) === DYNAMIC_GATEWAY_METHOD_SCOPE;
}

/** Returns true when a method name has an explicit core policy entry. */
export function isCoreGatewayMethodClassified(method: string): boolean {
  return CORE_GATEWAY_METHOD_SPEC_BY_NAME.has(method);
}

/**
 * TF-0089: descriptor specs that are deliberately not backed by the lazy core
 * handler map. Each entry is a reviewed, documented exception - anything else
 * missing a handler fails registry construction instead of silently skipping
 * (the failure mode that shipped `sessions.yieldState` as "unknown method").
 *
 * - Aux methods are served through the auxiliary handler surface
 *   (`server-aux-handlers.ts`) and get their descriptors there.
 * - `sessions.compressionArtifact` / `sessions.recoveryContext` are pre-existing
 *   unreachable methods (descriptor + handler exist, lazy whitelist entry is
 *   missing at HEAD). Registering them changes checkpoint/recovery behavior, so
 *   the fix belongs to that workstream; until then they stay listed here
 *   instead of hiding in a silent skip.
 */
const KNOWN_UNREGISTERED_CORE_METHOD_SPEC_REASONS: ReadonlyMap<string, string> = new Map([
  [
    "sessions.compressionArtifact",
    "pre-existing: lazy whitelist entry missing at HEAD; registration owned by the checkpoint/recovery workstream",
  ],
  [
    "sessions.recoveryContext",
    "pre-existing: lazy whitelist entry missing at HEAD; registration owned by the checkpoint/recovery workstream",
  ],
]);

/** Test-only view of the documented exceptions (asserted by the guard tests). */
export function listKnownUnregisteredCoreMethodSpecs(): ReadonlyArray<{
  name: string;
  reason: string;
}> {
  return [...KNOWN_UNREGISTERED_CORE_METHOD_SPEC_REASONS.entries()].map(([name, reason]) => ({
    name,
    reason,
  }));
}

/** Creates dispatch descriptors for core handlers and fails if any handler lacks policy. */
export function createCoreGatewayMethodDescriptors(
  handlers: Record<string, GatewayMethodHandler>,
): GatewayMethodDescriptorInput[] {
  const descriptors: GatewayMethodDescriptorInput[] = [];
  const specNames = new Set<string>();
  const auxMethods = new Set<string>(GATEWAY_AUX_METHODS);
  for (const spec of CORE_GATEWAY_METHOD_SPECS) {
    specNames.add(spec.name);
    const handler = handlers[spec.name];
    if (!handler) {
      if (auxMethods.has(spec.name)) {
        // Served through the auxiliary handler surface, not the core lazy map.
        continue;
      }
      const knownReason = KNOWN_UNREGISTERED_CORE_METHOD_SPEC_REASONS.get(spec.name);
      if (knownReason) {
        continue;
      }
      throw new Error(
        "gateway method descriptor has no core handler: " +
          `${spec.name} (add it to the lazy core handler map or document the exception)`,
      );
    }
    descriptors.push({
      name: spec.name,
      handler,
      owner: { kind: "core", area: "gateway" },
      scope: spec.scope,
      ...(spec.advertise === false ? { advertise: false } : {}),
      ...(spec.startup === true ? { startup: "unavailable-until-sidecars" } : {}),
      ...(spec.controlPlaneWrite === true ? { controlPlaneWrite: true } : {}),
    });
  }
  for (const name of Object.keys(handlers)) {
    if (!specNames.has(name)) {
      // Unclassified core handlers would bypass scope/startup/write metadata, so fail before the
      // dispatcher can expose a method with missing policy.
      throw new Error(`gateway method handler is missing a descriptor: ${name}`);
    }
  }
  return descriptors;
}
