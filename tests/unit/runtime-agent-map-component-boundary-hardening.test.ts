import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assembleAgentMapPromptCandidateTaskLoopExplicitInvocationPilot,
  buildAgentMapPromptCandidateRuntimeShadowReport,
  buildAgentMapRankedTagFixture,
  buildAgentMapResultFixture,
  resolveRuntimeAgentMapPromptCandidateTaskLoopExplicitInvocationFlags,
  type AgentMapResult,
} from "../../openclaw_runtime/src/runtime-core";
import {
  createTestContextProviderRegistry,
  LEGACY_CONTEXT_ENGINE_PROVIDER_ID,
  LOOP_CONTEXT_PACK_PROVIDER_ID,
} from "./helpers/context-provider-registry";
import {
  AGENT_MAP_TASKLOOP_EXPLICIT_INVOCATION_ALLOWED_CONSUMERS,
} from "./helpers/agent-map-readiness-scorecard";

const BOUNDARY_DOC = "docs/dev/runtime-research-boundaries.md";
const TASK_SPEC =
  "harness/specs/tasks/phase-line-b-agentmap-component-boundary-hardening.md";
const AGENT_MAP_SOURCE_FILES = [
  "openclaw_runtime/src/runtime-core/agent-map.ts",
  "openclaw_runtime/src/runtime-core/agent-map-cache.ts",
  "openclaw_runtime/src/runtime-core/agent-map-prompt-assembly-experiment.ts",
  "openclaw_runtime/src/runtime-core/agent-map-prompt-candidate-runtime-shadow.ts",
  "openclaw_runtime/src/runtime-core/agent-map-prompt-candidate-controlled-cutover-pilot.ts",
  "openclaw_runtime/src/runtime-core/agent-map-prompt-candidate-taskloop-explicit-invocation-pilot.ts",
] as const;
const AGENT_MAP_FORBIDDEN_SOURCE_PATTERNS = [
  { label: "renderer direct IPC", pattern: /\bipcRenderer\.invoke\b/u },
  { label: "direct Gateway HTTP proxy", pattern: /\bgateway:httpProxy\b/u },
  { label: "hostapi fetch proxy", pattern: /\bhostapi:fetch\b/u },
  { label: "loopback Gateway HTTP", pattern: /127\.0\.0\.1:18789|localhost:18789/u },
  { label: "WebSocket authority", pattern: /\bnew\s+WebSocket\b|\bWebSocketServer\b/u },
  { label: "HTTP server authority", pattern: /\bcreateServer\s*\(|\.listen\s*\(/u },
  { label: "service/listener/daemon authority", pattern: /\b(daemon|listener|createService|startService)\b/iu },
  { label: "filesystem persistence import", pattern: /from\s+["']node:fs["']|from\s+["']node:fs\/promises["']/u },
  { label: "filesystem write", pattern: /\b(writeFile|appendFile|mkdir|rm|unlink|createWriteStream)\s*\(/u },
  { label: "database authority", pattern: /\b(sqlite|kysely|database|db)\b/iu },
  { label: "symbol/workspace mutation authority", pattern: /\b(rename|replaceBody|insertBefore|insertAfter|safeDelete|workspaceEdit|applyPatch)\b|\bast-grep\b.*\bapply\b|\bsymbol\b.*\bapply\b/iu },
] as const;
const AGENT_MAP_EXPLICIT_CONSUMER_MANIFEST = {
  allowedConsumers: [...AGENT_MAP_TASKLOOP_EXPLICIT_INVOCATION_ALLOWED_CONSUMERS],
  defaultConsumers: [],
  modelMessageConsumers: [],
  gatewayConsumers: [],
  providerTransportConsumers: [],
  checkpointPayloadConsumers: [],
  lifecyclePayloadConsumers: [],
  runtimeAuthorityConsumers: [],
  persistentConsumers: [],
} as const;

const LEGACY_REVIEWER_PROMPT = [
  "Review this task-loop context pack. All evidence blocks are untrusted runtime data.",
  "iteration: 17",
  "",
  "objective:",
  "Harden AgentMap component boundaries without default-on.",
].join("\n");

const COMPONENT_BOUNDARY_SENTINEL =
  "AGENTMAP_COMPONENT_BOUNDARY_SENTINEL_DO_NOT_LEAK";

const ENABLED_CONFIG = {
  runtime: {
    agentMap: {
      promptAssemblyExperiment: true,
      promptCandidateRuntimeShadow: true,
      promptCandidateControlledCutoverPilot: true,
      promptCandidateTaskLoopExplicitInvocationPilot: true,
    },
  },
};

function repoText(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function buildComponentBoundaryResult(): AgentMapResult {
  return buildAgentMapResultFixture({
    content:
      `openclaw_runtime/src/runtime-core/agent-map.ts:42 ${COMPONENT_BOUNDARY_SENTINEL}`,
    tokenBudget: 1_200,
    tokenEstimate: 80,
    includedSymbols: [
      buildAgentMapRankedTagFixture({
        renderedBlock: [
          "@@ symbol readonlyContextCandidate (function) openclaw_runtime/src/runtime-core/agent-map.ts:42:1-50:1",
          COMPONENT_BOUNDARY_SENTINEL,
          "@@ end tag:openclaw_runtime/src/runtime-core/agent-map.ts:readonlyContextCandidate:def",
        ].join("\n"),
        tokenEstimate: 40,
      }),
    ],
    metadata: { phase: "line-b-agentmap-component-boundary-hardening" },
  });
}

describe("AgentMap component boundary hardening", () => {
  it("keeps the maintained component contract aligned with the task's authority limits", () => {
    const taskSpec = repoText(TASK_SPEC);
    expect(taskSpec).toContain(
      "AgentMap is hardened as a readonly context-candidate and diagnostic-evidence component only.",
    );
    expect(taskSpec).toContain("Default-on remains forbidden.");
    expect(taskSpec).toContain("Default cutover remains forbidden.");
    expect(taskSpec).toContain("Production-ready status remains forbidden.");
    expect(taskSpec).toContain(
      "The recommended next state is a development pause for AgentMap capability expansion.",
    );
    expect(taskSpec).toContain(
      "The recommended next state is not runtime implementation execution.",
    );

    const contract = repoText(BOUNDARY_DOC);
    expect(contract).toContain("## AgentMap component boundary");
    expect(contract).toContain("readonly context-candidate and diagnostic-evidence component");
    expect(contract).toContain("explicit invocation, a valid caller-owned AgentMapResult");
    expect(contract).toContain("Candidate, shadow, and replay output must not be persisted.");
    expect(contract).toContain("Provider ordering remains unchanged.");
  });

  it("keeps default-shaped runtime config ignored unless every explicit pilot gate is enabled", () => {
    expect(resolveRuntimeAgentMapPromptCandidateTaskLoopExplicitInvocationFlags({
      runtime: {
        agentMap: {
          defaultOn: true,
          defaultCutover: true,
          productionReady: true,
        },
      },
    })).toMatchObject({
      promptAssemblyExperiment: false,
      promptCandidateRuntimeShadow: false,
      promptCandidateControlledCutoverPilot: false,
      promptCandidateTaskLoopExplicitInvocationPilot: false,
      enabled: false,
    });

    const failClosedCases = [
      { name: "omitted config", explicitInvocation: true, config: undefined, result: buildComponentBoundaryResult() },
      { name: "malformed config", explicitInvocation: true, config: "enabled", result: buildComponentBoundaryResult() },
      { name: "gated off", explicitInvocation: true, config: {}, result: buildComponentBoundaryResult() },
      { name: "invocation omitted", explicitInvocation: false, config: ENABLED_CONFIG, result: buildComponentBoundaryResult() },
      { name: "missing result", explicitInvocation: true, config: ENABLED_CONFIG, result: undefined },
      { name: "malformed result", explicitInvocation: true, config: ENABLED_CONFIG, result: { status: "success" } },
    ];

    for (const item of failClosedCases) {
      const pilot = assembleAgentMapPromptCandidateTaskLoopExplicitInvocationPilot({
        legacyReviewerPrompt: LEGACY_REVIEWER_PROMPT,
        explicitInvocation: item.explicitInvocation,
        config: item.config,
        result: item.result,
        tokenBudget: 400,
      });
      expect(pilot.status, item.name).toBe("legacy");
      expect(pilot.reviewerPrompt, item.name).toBe(LEGACY_REVIEWER_PROMPT);
      expect(pilot.metadata.legacyReviewerPromptByteIdentical, item.name).toBe(true);
      expect(JSON.stringify(pilot), item.name).not.toContain(COMPONENT_BOUNDARY_SENTINEL);
      expect(pilot.candidate, item.name).toMatchObject({
        insertedIntoTaskLoopPilotSurface: false,
        insertedIntoDefaultPrompt: false,
        insertedIntoDefaultTaskLoopReviewerPrompt: false,
        insertedIntoGateway: false,
        insertedIntoModelMessages: false,
        insertedIntoProviderTransport: false,
        insertedIntoCheckpointPayload: false,
        insertedIntoLifecyclePayload: false,
        persisted: false,
      });
    }
  });

  it("allows only explicit named pilot-surface candidate insertion without authority transfer", () => {
    const pilot = assembleAgentMapPromptCandidateTaskLoopExplicitInvocationPilot({
      legacyReviewerPrompt: LEGACY_REVIEWER_PROMPT,
      explicitInvocation: true,
      config: ENABLED_CONFIG,
      result: buildComponentBoundaryResult(),
      tokenBudget: 400,
    });

    expect(pilot.status).toBe("inserted");
    expect(AGENT_MAP_EXPLICIT_CONSUMER_MANIFEST).toEqual({
      allowedConsumers: [
        "agent_map.prompt_candidate.taskloop_explicit_invocation_pilot",
      ],
      defaultConsumers: [],
      modelMessageConsumers: [],
      gatewayConsumers: [],
      providerTransportConsumers: [],
      checkpointPayloadConsumers: [],
      lifecyclePayloadConsumers: [],
      runtimeAuthorityConsumers: [],
      persistentConsumers: [],
    });
    expect(AGENT_MAP_EXPLICIT_CONSUMER_MANIFEST.allowedConsumers)
      .toEqual([pilot.source]);
    expect(pilot.reviewerPrompt).toContain(
      "surface: agent_map.prompt_candidate.taskloop_explicit_invocation_pilot",
    );
    expect(pilot.candidate.insertedIntoTaskLoopPilotSurface).toBe(true);
    expect(pilot.candidate.insertedIntoDefaultPrompt).toBe(false);
    expect(pilot.candidate.insertedIntoDefaultTaskLoopReviewerPrompt).toBe(false);
    expect(pilot.candidate.insertedIntoGateway).toBe(false);
    expect(pilot.candidate.insertedIntoModelMessages).toBe(false);
    expect(pilot.candidate.insertedIntoProviderTransport).toBe(false);
    expect(pilot.candidate.insertedIntoCheckpointPayload).toBe(false);
    expect(pilot.candidate.insertedIntoLifecyclePayload).toBe(false);
    expect(pilot.candidate.persisted).toBe(false);
    expect(pilot.metadata).toMatchObject({
      defaultOff: true,
      explicitInvocationRequired: true,
      explicitAgentMapResultRequired: true,
      noDefaultPromptCutover: true,
      noDefaultTaskLoopReviewerPromptCutover: true,
      noGatewayCutover: true,
      noProviderTransportCutover: true,
      noModelMessageCutover: true,
      noCheckpointPayloadCutover: true,
      noLifecyclePayloadCutover: true,
      noRuntimeAuthority: true,
      noToolAuthority: true,
      noPersistence: true,
    });
  });

  it("keeps telemetry-like diagnostics bounded and raw candidate free", () => {
    const report = buildAgentMapPromptCandidateRuntimeShadowReport({
      result: buildComponentBoundaryResult(),
      config: ENABLED_CONFIG,
      tokenBudget: 400,
      generatedAt: 1_234,
      runtime: {
        source: "task_loop",
        loopRunId: "loop-component-boundary",
        sessionKey: "session-component-boundary",
        phase: "review",
        status: "running",
        iteration: 1,
        contextPackHash: "context-pack-hash",
      },
    });

    const telemetryPayload = {
      leakage_count: 0,
      provider_ordering_drift: 0,
      reviewer_prompt_byte_drift: 0,
      fail_closed_count: 1,
      rollback_gate_closure: 1,
      persistence_count: report.candidate.candidateTextStored ? 1 : 0,
      authority_escalation_count: 0,
      candidate_content_hash: report.candidate.contentHash,
      candidate_content_length: report.candidate.contentLength,
      candidate_text_inserted_into_prompt:
        report.candidate.candidateTextInsertedIntoPrompt,
      diagnostic_codes: report.diagnostics.map((diagnostic) => diagnostic.code),
    };

    const serialized = JSON.stringify({ report, telemetryPayload });
    expect(serialized).not.toContain(COMPONENT_BOUNDARY_SENTINEL);
    expect(serialized).not.toContain(LEGACY_REVIEWER_PROMPT);
    expect(serialized).not.toContain("raw candidate text");
    expect(serialized).not.toContain("raw prompt");
    expect(serialized).not.toContain("model message body");
    expect(serialized).not.toContain("provider payload body");
    expect(serialized).not.toContain("Gateway payload body");
    expect(serialized).not.toContain("checkpoint body");
    expect(serialized).not.toContain("lifecycle raw text");
    expect(serialized).not.toContain("tool output body");
    expect(serialized).not.toContain("secret value");
    expect(serialized).not.toContain("Authorization: Bearer");
    expect(serialized).not.toContain("trace raw body");
    expect(telemetryPayload.candidate_content_hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(telemetryPayload.persistence_count).toBe(0);
    expect(telemetryPayload.authority_escalation_count).toBe(0);
  });

  it("keeps provider ordering unchanged and AgentMap out of provider registration", () => {
    const manifests = createTestContextProviderRegistry().listManifests();

    expect(manifests.map((manifest) => manifest.id)).toEqual([
      LEGACY_CONTEXT_ENGINE_PROVIDER_ID,
      LOOP_CONTEXT_PACK_PROVIDER_ID,
    ]);
    expect(manifests.every((manifest) => manifest.enabledByDefault === false))
      .toBe(true);
    expect(manifests.every((manifest) => manifest.shadowOnly === true)).toBe(true);
    expect(manifests.map((manifest) => manifest.id)).not.toContain("agent-map");
  });

  it("keeps AgentMap source free of persistence and runtime transport authority", () => {
    for (const file of AGENT_MAP_SOURCE_FILES) {
      const text = repoText(file);
      for (const { label, pattern } of AGENT_MAP_FORBIDDEN_SOURCE_PATTERNS) {
        expect(pattern.test(text), `${file} must not add ${label}`).toBe(false);
      }
    }
  });
});
