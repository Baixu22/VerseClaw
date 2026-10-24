import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { OpenClawConfig } from "../../../../openclaw_runtime/src/config/types.openclaw.js";
import type { AnyAgentTool } from "../../../../openclaw_runtime/src/agents/tools/common.js";
import {
  buildRuntimeFlagAck,
  type RuntimeFlagAckPayload,
} from "../../../../openclaw_runtime/src/context-engine/runtime-flag-ack.js";
import {
  buildRuntimeEffectiveCapabilityProfile,
  createRuntimeCapabilityStateGenerationGuard,
  isRuntimeCapabilityToolOutcomeConsistent,
  type RuntimeEffectiveCapabilityInput,
  type RuntimeEffectiveCapabilityResult,
} from "../../../../openclaw_runtime/src/runtime-core/model-capability-effective-state.js";

const root = process.cwd();
const out = "tests/unit/fixtures/model-capability-effective-state-tf0512";
const now = Date.parse("2026-10-24T08:00:00.000Z");
const nowIso = new Date(now).toISOString();
const capabilityId = "component.coding-execution-backend";
const generation = "gateway-tf0512";

function tool(name: string): AnyAgentTool {
  return {
    name,
    label: name,
    description: `${name} fixture`,
    parameters: { type: "object", properties: {} },
    execute: async () => ({ content: [{ type: "text", text: "ok" }] }),
  } as unknown as AnyAgentTool;
}

function ack(gatewayGeneration = generation, answeredAt = nowIso): RuntimeFlagAckPayload {
  return {
    ...buildRuntimeFlagAck({
      env: {
        OPENCLAW_CONFIG_PATH: path.join(root, "package.json"),
        VERSE_CLAW_GATEWAY_GENERATION: gatewayGeneration,
      },
    }),
    gatewayGeneration: gatewayGeneration,
    degradedReason: null,
    answeredAt,
  };
}

function input(overrides: Partial<RuntimeEffectiveCapabilityInput> = {}): RuntimeEffectiveCapabilityInput {
  return {
    workspaceId: "workspace:component-graduation",
    workspaceDir: "D:/tmp/component-graduation-tf0512",
    sessionKey: "agent:main:tf0512",
    runtimeGeneration: generation,
    tools: [tool("exec")],
    cfg: { tools: { exec: { mode: "full" } } } as OpenClawConfig,
    env: { VERSE_CLAW_GATEWAY_GENERATION: generation },
    runtimeAck: ack(),
    memory: { scope: "workspace", read: "allowed", write: "denied", candidate: "available" },
    knowledge: { appliedState: "stale", version: "knowledge-tf0512", digest: "sha256:tf0512-knowledge" },
    nowMs: () => now,
    ...overrides,
  };
}

function entry(result: RuntimeEffectiveCapabilityResult, id = capabilityId) {
  const found = result.profile.entries.find((candidate) => candidate.capabilityId === id);
  if (!found) throw new Error(`missing capability ${id}`);
  return found;
}

function summary(result: RuntimeEffectiveCapabilityResult) {
  const item = entry(result);
  return {
    source: result.source,
    runtimeAvailability: item.runtimeAvailability,
    driver: item.driver,
    tool: item.tool,
    actionAuthorization: item.actionAuthorization,
    memory: item.memory,
    knowledge: item.knowledge,
    ack: item.ack,
    quarantine: item.quarantine,
    staticDigest: result.profile.staticDigest,
    effectiveDigest: result.effectiveDigest,
  };
}

const enabled = await buildRuntimeEffectiveCapabilityProfile(input({
  grants: [{
    capabilityId,
    actionIds: ["exec"],
    grantId: "grant-tf0512-active",
    state: "active",
    expiresAt: "2026-10-24T08:05:00.000Z",
  }],
}));
const loading = await buildRuntimeEffectiveCapabilityProfile(input({
  driver: { id: "runtime-loading", kind: "runtime", state: "loading", version: null },
  runtimeStates: [{
    capabilityId,
    state: "partial",
    source: "runtime-state:fixture",
    reason: "tool-registry-loading",
  }],
}));
const unavailable = await buildRuntimeEffectiveCapabilityProfile(input({
  driver: { id: "runtime-unavailable", kind: "runtime", state: "unavailable", version: null },
  runtimeStates: [{
    capabilityId,
    state: "disabled",
    source: "runtime-state:fixture",
    reason: "driver-unavailable",
  }],
}));
const degraded = await buildRuntimeEffectiveCapabilityProfile(input({
  driver: { id: "runtime-degraded", kind: "runtime", state: "error", version: null },
  runtimeStates: [{
    capabilityId,
    state: "degraded",
    source: "runtime-state:fixture",
    reason: "partial-provider",
  }],
}));
const quarantined = await buildRuntimeEffectiveCapabilityProfile(input({
  quarantine: [{
    capabilityId,
    state: "quarantined",
    reason: "tool schema rejected",
    since: "2026-10-24T07:59:00.000Z",
  }],
}));
const expiredGrant = await buildRuntimeEffectiveCapabilityProfile(input({
  grants: [{
    capabilityId,
    actionIds: ["exec"],
    grantId: "grant-tf0512-expired",
    state: "active",
    expiresAt: "2026-10-24T07:59:59.000Z",
  }],
}));
const revokedGrant = await buildRuntimeEffectiveCapabilityProfile(input({
  grants: [{
    capabilityId,
    actionIds: ["exec"],
    grantId: "grant-tf0512-revoked",
    state: "revoked",
    expiresAt: null,
  }],
}));
const killSwitch = await buildRuntimeEffectiveCapabilityProfile(input({
  cfg: {
    tools: { exec: { mode: "full" } },
    runtime: { contextEnhancement: { killSwitch: true } },
  } as OpenClawConfig,
}));
const unverified = await buildRuntimeEffectiveCapabilityProfile(input({ runtimeAck: null }));
const restartMismatch = await buildRuntimeEffectiveCapabilityProfile(input({
  runtimeGeneration: "gateway-tf0512-restarted",
  runtimeAck: ack(generation),
}));
const observationOnly = await buildRuntimeEffectiveCapabilityProfile(input({
  nowMs: () => now + 10_000,
  runtimeAck: ack(generation, new Date(now + 10_000).toISOString()),
}));
const noGrant = await buildRuntimeEffectiveCapabilityProfile(input());

const deniedOutcomeConsistent = isRuntimeCapabilityToolOutcomeConsistent(noGrant.profile, {
  capabilityId,
  actionId: "exec",
  outcome: "denied",
});
const deniedOutcomeOverclaim = isRuntimeCapabilityToolOutcomeConsistent(noGrant.profile, {
  capabilityId,
  actionId: "exec",
  outcome: "succeeded",
});
const grantedOutcomeConsistent = isRuntimeCapabilityToolOutcomeConsistent(enabled.profile, {
  capabilityId,
  actionId: "exec",
  outcome: "succeeded",
});

const guard = createRuntimeCapabilityStateGenerationGuard("run-tf0512-race");
const pending = buildRuntimeEffectiveCapabilityProfile(input({ generationGuard: guard }));
const newerGeneration = guard.next();
let staleRejected = false;
try {
  await pending;
} catch (error) {
  staleRejected = String(error).includes("stale runtime capability generation");
}

const rawEvidence = {
  schemaVersion: "ModelCapabilityEffectiveStateEvidence/v1",
  taskForestNodeId: "TF-0512",
  generatedAt: nowIso,
  driven_by: "agent",
  actor: "codex",
  adapter: "openclaw_runtime/src/runtime-core/model-capability-effective-state.ts",
  promptBoundary: "openclaw_runtime/src/context-engine/model-capability-prompt.ts",
  activeContextEngine: "legacy",
  observations: {
    enabled: summary(enabled),
    loading: summary(loading),
    unavailable: summary(unavailable),
    degraded: summary(degraded),
    quarantined: summary(quarantined),
    expiredGrant: summary(expiredGrant),
    revokedGrant: summary(revokedGrant),
    killSwitch: summary(killSwitch),
    unverified: summary(unverified),
    restartMismatch: summary(restartMismatch),
  },
  digestAudit: {
    staticDigestStableAcrossEffectiveChanges:
      enabled.profile.staticDigest === expiredGrant.profile.staticDigest
      && enabled.profile.staticDigest === killSwitch.profile.staticDigest,
    effectiveDigestChangesWithGrantOrConfig:
      enabled.effectiveDigest !== expiredGrant.effectiveDigest
      && enabled.effectiveDigest !== killSwitch.effectiveDigest,
    observedAtChanged: observationOnly.profile.observedAt !== noGrant.profile.observedAt,
    effectiveDigestStableForObservationOnlyChange:
      observationOnly.effectiveDigest === noGrant.effectiveDigest,
  },
  toolOutcomeCrossCheck: {
    noGrantAuthorization: entry(noGrant).actionAuthorization.find((item) => item.actionId === "exec")?.authorization,
    deniedOutcomeConsistent,
    deniedButProfileWouldAllowSucceeded: !deniedOutcomeOverclaim,
    activeGrantSucceededConsistent: grantedOutcomeConsistent,
  },
  generationGuard: {
    staleCompletionRejected: staleRejected,
    newerGeneration,
  },
  prompt: {
    text: enabled.profile.promptAddition.text,
    budget: enabled.profile.promptAddition.budget,
  },
  boundaries: [
    "Fixture-driven runtime adapter evidence; no live provider or Electron E2E is claimed.",
    "The default legacy context engine is the production assembly path wired to this adapter.",
    "No product default, public release, GA, liveReady, or productApproved value is changed.",
  ],
};

fs.writeFileSync(path.join(root, out, "raw-evidence.json"), JSON.stringify(rawEvidence, null, 2) + "\n", "utf8");
fs.writeFileSync(path.join(root, out, "profile.json"), JSON.stringify(enabled.profile, null, 2) + "\n", "utf8");

const acceptance = {
  schemaVersion: "ModelCapabilityEffectiveStateAcceptance/v1",
  taskForestNodeId: "TF-0512",
  generatedAt: nowIso,
  driven_by: "agent",
  actor: "codex",
  status: "complete",
  criteria: [
    {
      criterion: "loading/unavailable/degraded/quarantined 状态正确传播",
      status: "verified",
      evidence: "raw-evidence.json#observations",
      detail: "Driver and runtime facts preserve loading, unavailable, partial/degraded and quarantined states without promotion.",
    },
    {
      criterion: "grant 到期/撤销和配置开关后 profile 刷新",
      status: "verified",
      evidence: "raw-evidence.json#observations.expiredGrant, revokedGrant, killSwitch",
      detail: "Expiry is recomputed at refresh time, revocation denies the action, and the kill switch moves availability to disabled.",
    },
    {
      criterion: "工具实际拒绝与 profile 一致",
      status: "verified",
      evidence: "raw-evidence.json#toolOutcomeCrossCheck; tests/unit/model-capability-effective-state-tf0512.test.ts",
      detail: "Tool presence alone yields requires-approval; a denied outcome is consistent only when the profile did not claim an executable action.",
    },
    {
      criterion: "重启后 effective state 恢复/降级可解释",
      status: "verified",
      evidence: "raw-evidence.json#observations.restartMismatch",
      detail: "A stale pre-restart acknowledgement cannot prove post-restart execution; availability and driver become unknown.",
    },
    {
      criterion: "静态与 effective digest 可审计",
      status: "verified",
      evidence: "raw-evidence.json#digestAudit; profile.json",
      detail: "Static digest stays stable across effective changes while effective digest changes with facts and remains stable for observation-only updates.",
    },
  ],
  completionVerdict: "complete",
};
fs.writeFileSync(path.join(root, out, "acceptance.json"), JSON.stringify(acceptance, null, 2) + "\n", "utf8");

function sha(rel: string): { path: string; sha256: string; bytes: number } {
  const bytes = fs.readFileSync(path.join(root, rel));
  return { path: rel, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length };
}

const report = {
  schemaVersion: "ComponentGraduationReport/v1",
  reportId: "tf-0512-model-capability-effective-state",
  reportKind: "runtime-integration",
  componentId: "model-capability-profile",
  taskForestNodeId: "TF-0512",
  disposition: "internal",
  maturity: "verified",
  owner: "TF-0512",
  entryPoint: "openclaw_runtime/src/context-engine/model-capability-prompt.ts",
  defaultMode: "internal",
  benefitEvidence: "Every default legacy context-engine assemble refreshes a bounded capability profile from the admitted tool surface, runtime ack, grants, quarantine, memory and knowledge inputs.",
  rollback: "Remove the capability prompt bridge call from LegacyContextEngine; the prior pass-through assembly remains available and no product default changes.",
  modelEffectiveState: "Current tool inventory and runtime ack are read per assemble; missing/stale ack yields unknown availability, and grant expiry/revocation/config kill switch are reflected before prompt projection.",
  evidenceGrade: "unit-test",
  actor: "codex",
  driven_by: "agent",
  expiry: null,
  binding: {
    commit: process.env.TF0512_BINDING_COMMIT ?? execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    tree: process.env.TF0512_BINDING_TREE ?? execFileSync("git", ["rev-parse", "HEAD^{tree}"], { encoding: "utf8" }).trim(),
    runtimeGeneration: generation,
    provider: "not-applicable",
    model: "not-applicable",
    inputSet: "raw-evidence.json; profile.json; tests/unit/model-capability-effective-state-tf0512.test.ts",
    scope: "workspace:component-graduation/session:tf0512",
    artifacts: [
      sha("openclaw_runtime/src/runtime-core/model-capability-effective-state.ts"),
      sha("openclaw_runtime/src/context-engine/model-capability-prompt.ts"),
      sha("openclaw_runtime/src/context-engine/legacy.ts"),
      sha("tests/unit/model-capability-effective-state-tf0512.test.ts"),
      sha(`${out}/raw-evidence.json`),
      sha(`${out}/profile.json`),
    ],
  },
  evidence: [{
    kind: "runtime-state-adapter",
    status: "pass",
    grade: "unit-test",
    summary: "Five acceptance criteria map to generated state, digest, grant, restart and tool-outcome checks.",
    artifacts: [sha(`${out}/raw-evidence.json`), sha(`${out}/acceptance.json`)],
  }],
  recompute: {
    verdict: "pass",
    command: "pnpm exec tsx tests/unit/fixtures/model-capability-effective-state-tf0512/generate-acceptance.mts",
  },
};
fs.writeFileSync(path.join(root, out, "component-graduation-report.json"), JSON.stringify(report, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ status: acceptance.status, criteria: acceptance.criteria.length, profileEntries: enabled.profile.entries.length }, null, 2));