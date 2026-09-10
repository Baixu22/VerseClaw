// Defines agent routing, model, and runtime configuration types.
import type { ChatType } from "../channels/chat-type.js";
import type {
  AgentContextLimitsConfig,
  AgentDefaultsConfig,
  AgentModelEntryConfig,
  EmbeddedAgentExecutionContract,
  SubagentDelegationMode,
} from "./types.agent-defaults.js";
import type { AgentModelConfig, AgentSandboxConfig } from "./types.agents-shared.js";
import type { DmScope, HumanDelayConfig, IdentityConfig } from "./types.base.js";
import type { GroupChatConfig } from "./types.messages.js";
import type { SkillsLimitsConfig } from "./types.skills.js";
import type { AgentToolsConfig, MemorySearchConfig } from "./types.tools.js";
import type { TtsConfig } from "./types.tts.js";

export type AgentRuntimeAcpConfig = {
  /** ACP harness adapter id (for example codex, claude). */
  agent?: string;
  /** Optional ACP backend override for this agent runtime. */
  backend?: string;
  /** Optional ACP session mode override. */
  mode?: "persistent" | "oneshot";
  /** Optional runtime working directory override. */
  cwd?: string;
};

export type AgentRuntimeConfig =
  | {
      type: "embedded";
    }
  | {
      type: "acp";
      acp?: AgentRuntimeAcpConfig;
    };

export type AgentBindingMatch = {
  channel: string;
  /**
   * Channel account to match.
   * - Omitted/empty: matches only the channel default account.
   * - "*": matches every account on the channel.
   * - Any other string: matches that specific account id.
   */
  accountId?: string;
  peer?: { kind: ChatType; id: string };
  guildId?: string;
  teamId?: string;
  /** Discord role IDs used for role-based routing. */
  roles?: string[];
};

export type AgentRouteBinding = {
  /** Missing type is interpreted as route for backward compatibility. */
  type?: "route";
  agentId: string;
  comment?: string;
  match: AgentBindingMatch;
  session?: {
    /** Optional session scoping override for conversations matched by this binding. */
    dmScope?: DmScope;
  };
};

export type AgentAcpBinding = {
  type: "acp";
  agentId: string;
  comment?: string;
  match: AgentBindingMatch;
  acp?: {
    mode?: "persistent" | "oneshot";
    label?: string;
    cwd?: string;
    backend?: string;
  };
};

export type AgentBinding = AgentRouteBinding | AgentAcpBinding;

export type AgentConfig = {
  id: string;
  default?: boolean;
  name?: string;
  /** Optional human-authored agent description. */
  description?: string;
  workspace?: string;
  agentDir?: string;
  model?: AgentModelConfig;
  /**
   * @deprecated Legacy raw config accepted only by doctor/migration repair.
   * Normal schema parsing rejects this key; use per-model agentRuntime instead.
   */
  agentRuntime?: AgentModelEntryConfig["agentRuntime"];
  /** Per-model metadata overrides for this agent. */
  models?: Record<string, AgentModelEntryConfig>;
  /** @deprecated Legacy per-agent compaction config is kept for raw doctor migration/repair. */
  compaction?: AgentDefaultsConfig["compaction"];
  /** Optional per-agent default thinking level (overrides agents.defaults.thinkingDefault). */
  thinkingDefault?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "adaptive" | "max";
  /** Optional per-agent default verbosity level. */
  verboseDefault?: "off" | "on" | "full";
  /** Optional per-agent tool progress detail mode. */
  toolProgressDetail?: AgentDefaultsConfig["toolProgressDetail"];
  /** Optional per-agent default reasoning visibility. */
  reasoningDefault?: "on" | "off" | "stream";
  /** Optional per-agent default for fast mode. */
  fastModeDefault?: boolean;
  /** Optional per-agent bootstrap/context injection mode override. */
  contextInjection?: AgentDefaultsConfig["contextInjection"];
  /** Optional per-agent max chars for each injected bootstrap file. */
  bootstrapMaxChars?: AgentDefaultsConfig["bootstrapMaxChars"];
  /** Optional per-agent max total chars across injected bootstrap files. */
  bootstrapTotalMaxChars?: AgentDefaultsConfig["bootstrapTotalMaxChars"];
  /** Optional per-agent experimental flags. Omitted fields inherit agents.defaults.experimental. */
  experimental?: AgentDefaultsConfig["experimental"];
  /** Optional allowlist of skills for this agent; omitting it inherits agents.defaults.skills when set, and an explicit list replaces defaults instead of merging. */
  skills?: string[];
  memorySearch?: MemorySearchConfig;
  /** Human-like delay between block replies for this agent. */
  humanDelay?: HumanDelayConfig;
  /** Optional per-agent TTS overrides, deep-merged over messages.tts. */
  tts?: TtsConfig;
  /** Optional per-agent skills subsystem overrides. */
  skillsLimits?: Pick<SkillsLimitsConfig, "maxSkillsPromptChars">;
  /** Optional per-agent overrides for selected context/token-heavy limits. */
  contextLimits?: AgentContextLimitsConfig;
  contextTokens?: number;
  /** Optional per-agent heartbeat overrides. */
  heartbeat?: AgentDefaultsConfig["heartbeat"];
  identity?: IdentityConfig;
  groupChat?: GroupChatConfig;
  subagents?: {
    /** Prompt-only guidance for how strongly this agent should delegate work. */
    delegationMode?: SubagentDelegationMode;
    /** Allow spawning sub-agents under other agent ids. Use "*" to allow any configured target. */
    allowAgents?: string[];
    /** Per-agent default model for spawned sub-agents (string or {primary,fallbacks}). */
    model?: AgentModelConfig;
    /** Per-agent default thinking level for spawned sub-agents. */
    thinking?: string;
    /** Require explicit agentId in sessions_spawn (no default same-as-caller). */
    requireAgentId?: boolean;
  };
  /** Optional outer run loop retry boundaries. */
  runRetries?: AgentDefaultsConfig["runRetries"];
  /** Optional bounded self-checking task-loop overrides. */
  taskLoop?: AgentDefaultsConfig["taskLoop"];
  /** Optional long-goal Mission Loop overrides. */
  missionLoop?: AgentDefaultsConfig["missionLoop"];
  /** Optional per-agent embedded OpenClaw overrides. */
  embeddedAgent?: {
    /** Optional per-agent execution contract override. */
    executionContract?: EmbeddedAgentExecutionContract;
  };
  /** Optional per-agent sandbox overrides. */
  sandbox?: AgentSandboxConfig;
  /** Optional per-agent stream params (e.g. cacheRetention, temperature). */
  params?: Record<string, unknown>;
  tools?: AgentToolsConfig;
  /** Optional runtime descriptor for this agent. */
  runtime?: AgentRuntimeConfig;
};

/**
 * Config-defined role contract for the role-first runtime.
 *
 * Structurally mirrors a YAML role contract (see agents/role-contract.ts).
 * Kept permissive here so config parsing does not couple to the agents layer;
 * the role registry normalizes + validates these entries at load time and
 * skips any that fail validation. snake_case and camelCase keys are accepted.
 */
export type AgentRoleContractConfig = {
  name: string;
  display_name?: string;
  displayName?: string;
  description?: string;
  role_prompt?: string;
  rolePrompt?: string;
  prompt?: string;
  tools?: string[];
  /**
   * Capabilities and tool requirements are read by `normalizeRoleContract`
   * (agents/role-contract.ts) and consumed by the capability publication and
   * resource-scheduler surfaces. They must stay declared here: an undeclared
   * key fails `satisfies OpenClawConfig`, and the last time that happened the
   * field was deleted from a test fixture instead, silently removing the only
   * coverage of the `roleToolRequirementMissing` diagnostic.
   */
  capabilities?: string[];
  tool_requirements?: string[];
  toolRequirements?: string[];
  risk_profile?: "low" | "medium" | "high" | "critical";
  riskProfile?: "low" | "medium" | "high" | "critical";
  can_modify_scope?: boolean;
  canModifyScope?: boolean;
  routing_keywords?: string[];
  routingKeywords?: string[];
  profile?: Record<string, unknown>;
  permissions?: {
    filesystem?: "none" | "read" | "write" | "admin";
    network?: "none" | "limited" | "full";
    commands?: string[];
    read_paths?: string[];
    readPaths?: string[];
    write_paths?: string[];
    writePaths?: string[];
  };
  model?: {
    default?: string | null;
    fallback?: string[];
    provider?: string | null;
  };
  effort?: "auto" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  output_schema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  handoff?: {
    to?: string[];
    from?: string[];
    requires_review?: boolean;
    requiresReview?: boolean;
  };
  version?: string;
  tags?: string[];
};

export type AgentsConfig = {
  defaults?: AgentDefaultsConfig;
  list?: AgentConfig[];
  /**
   * Optional config-defined role contracts merged over the built-in set by the
   * role registry (agents/role-registry.ts). Built-ins remain available even
   * when this is omitted.
   */
  roles?: AgentRoleContractConfig[];
  /**
   * Optional config-defined team templates merged over the built-in set.
   * Built-in teams remain available even when this is omitted.
   */
  teams?: unknown;
};
