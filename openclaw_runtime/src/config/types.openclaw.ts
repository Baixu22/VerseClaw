// Defines the top-level OpenClaw configuration type.
import type { SilentReplyPolicyShape } from "../shared/silent-reply-policy.js";
import type { TranscriptsConfig } from "../transcripts/config.js";
import type { AccessGroupsConfig } from "./types.access-groups.js";
import type { AcpConfig } from "./types.acp.js";
import type { AgentBinding, AgentsConfig } from "./types.agents.js";
import type { ApprovalsConfig } from "./types.approvals.js";
import type { AuthConfig } from "./types.auth.js";
import type { DiagnosticsConfig, LoggingConfig, SessionConfig, WebConfig } from "./types.base.js";
import type { BrowserConfig } from "./types.browser.js";
import type { ChannelsConfig } from "./types.channels.js";
import type { CliConfig } from "./types.cli.js";
import type { CommitmentsConfig } from "./types.commitments.js";
import type { CrestodianConfig } from "./types.crestodian.js";
import type { CronConfig } from "./types.cron.js";
import type { DiscoveryConfig, GatewayConfig, TalkConfig } from "./types.gateway.js";
import type { HooksConfig } from "./types.hooks.js";
import type { McpConfig } from "./types.mcp.js";
import type { MemoryConfig } from "./types.memory.js";
import type {
  AudioConfig,
  BroadcastConfig,
  CommandsConfig,
  MessagesConfig,
} from "./types.messages.js";
import type { ModelsConfig, ModelsConfigInput } from "./types.models.js";
import type { NodeHostConfig } from "./types.node-host.js";
import type { PluginsConfig } from "./types.plugins.js";
import type { SecretsConfig } from "./types.secrets.js";
import type { SkillsConfig } from "./types.skills.js";
import type { ToolsConfig } from "./types.tools.js";
import type { ProxyConfig } from "./zod-schema.proxy.js";

/** One persisted suppression for a known security audit finding. */
export type SecurityAuditSuppression = {
  /** Exact security audit check id to suppress. */
  checkId: string;
  /** Optional case-insensitive substring required in the finding title. */
  titleIncludes?: string;
  /** Optional case-insensitive substring required in the finding detail. */
  detailIncludes?: string;
  /** Operator rationale for accepting this standing finding. */
  reason?: string;
};

export type SecurityConfig = {
  /** Security audit policy and accepted standing findings. */
  audit?: {
    /** Accepted security audit findings to omit from active summary/findings. */
    suppressions?: SecurityAuditSuppression[];
  };
  /** Backend-only shadow validation; default off and never enforces policy. */
  validationShadow?: {
    enabled?: boolean;
  };
  installPolicy?: {
    /**
     * Enable operator-owned install policy. When true without an exec command,
     * install/update attempts fail closed for supported targets.
     */
    enabled?: boolean;
    /** Supported install targets. Omit to cover every supported target. */
    targets?: Array<"skill" | "plugin">;
    /**
     * Trusted local policy command. Transport intentionally mirrors exec
     * SecretRef provider fields: absolute command, no shell, bounded output,
     * explicit env allowlist, and secure path checks.
     */
    exec?: {
      source: "exec";
      command: string;
      args?: string[];
      timeoutMs?: number;
      noOutputTimeoutMs?: number;
      maxOutputBytes?: number;
      env?: Record<string, string>;
      passEnv?: string[];
      trustedDirs?: string[];
      allowInsecurePath?: boolean;
      allowSymlinkCommand?: boolean;
    };
  };
};

export type SurfaceConfigEntry = {
  /** Surface-specific silent reply policy for channels or UI integrations. */
  silentReply?: SilentReplyPolicyShape;
};

export type RuntimeFeatureConfig = {
  /** Master flag for the Phase-3 registry pilot. Defaults off; legacy paths stay authoritative. */
  registryPilot?: {
    /** Enable registry pilot diagnostics only. This must not cut over default behavior. */
    enabled?: boolean;
  };
  /** Runtime provider registry shadow diagnostics. Defaults off. */
  providerRegistry?: {
    /** Emit provider registry diagnostics/evidence without changing provider ordering. */
    shadow?: boolean;
  };
  /** Runtime context provider migration flags. Defaults off. */
  contextProviders?: {
    /** Emit normalized ContextItem shadows from compatibility context providers. */
    shadow?: boolean;
    /** Emit LoopContextPack ContextItem shadows without changing prompt text. */
    loopPackShadow?: boolean;
    /** Run context provider registry pilot diagnostics without changing prompt/message output. */
    registryPilot?: boolean;
  };
  /** Context Runtime Kit backend rollout flags. Defaults on for context/prompt/recovery when no explicit context engine slot is configured. */
  contextRuntimeKit?: {
    /** Set false to roll backend context engine selection back to legacy without UI changes. */
    enabled?: boolean;
    /** Preserve shadow diagnostics compatibility for pre-promotion CRK pilots. */
    shadow?: boolean;
  };
  /** Context Family rollout flags. Defaults off unless a promotion spec changes the default. */
  contextFamily?: {
    /** Projection-only observation masking. Transcript files remain unchanged. */
    observationMasking?: {
      /** Enable archive-backed prompt projection masking for old large observations. */
      enabled?: boolean;
      /** Minimum observation text characters before masking can be considered. */
      minChars?: number;
      /** Keep this many newest observations verbatim in the prompt projection. */
      preserveNewestObservationCount?: number;
    };
    /** Bounded Context Status prompt projection. */
    contextStatus?: {
      /** Enable the prompt projection. Omitted or false preserves prompt parity. */
      enabled?: boolean;
    };
  };
  /** Append-only RuntimeTaskEvent event-log shadow flags. Defaults off. */
  eventLog?: {
    /** Allow event-log diagnostics/envelopes to be created without changing runtime behavior. */
    shadow?: boolean;
    /** Allow an explicitly provided append-only shadow store to persist event-log records. */
    persist?: boolean;
  };
  /** Checkpoint serializer shadow flags. Defaults off. */
  checkpointSerializer?: {
    /** Serialize checkpoint shadows for comparison without changing long_task_checkpoints. */
    shadow?: boolean;
  };
  /** Resume replay shadow flags. Defaults off and never cut over resume authority. */
  resume?: {
    /** Replay event-log state for diagnostics without executing tools or changing resume behavior. */
    replayShadow?: boolean;
  };
  /** Runtime tool registry shadow diagnostics. Defaults off. */
  toolRegistry?: {
    /** Emit tool registry diagnostics/evidence without changing legacy tool responses. */
    shadow?: boolean;
  };
  /** Runtime registry diagnostic collector flags. Defaults off. */
  registryDiagnostics?: {
    /** Merge registry diagnostics into bounded caller-owned shadow output only. */
    collector?: boolean;
  };
  /** Runtime tool protocol migration flags. Defaults off. */
  toolProtocol?: {
    /** Emit MCP ToolCallRequest/ToolCallResult shadows without changing MCP response shape. */
    mcpShadow?: boolean;
  };
  /** Runtime tool governance pilot flags. Defaults off. */
  toolGovernance?: {
    /** Default-off destructive operation guard pilot gates. */
    destructiveOperationGuard?: {
      /** Mutation-capable tool invocation preflight pilot. */
      preflight?: {
        /** Explicit opt-in; omitted or non-true leaves legacy tool behavior unchanged. */
        enabled?: boolean;
      };
    };
  };
  /** Runtime-core migration shadow surfaces. Defaults are off. */
  evidenceVerifier?: {
    /** Emit warning-only evidence verifier reports without changing task completion decisions. */
    shadow?: boolean;
  };
  /** Runtime trace context shadow/provider flags. Defaults are off. */
  traceContext?: {
    /** Record sanitized trace diagnostics only; TaskLoop behavior remains authoritative. */
    shadow?: boolean;
    /** Allow readonly trace context provider output only when explicitly registered. */
    provider?: boolean;
    /** Observe sanitized external trace context only; no telemetry export or runtime authority. */
    propagation?: boolean;
  };
  /** Runtime memory shadow/provider/proposal/persistence flags. Defaults are off. */
  memory?: {
    /** Emit sanitized memory diagnostics; TaskLoop episode persistence also requires persist. */
    shadow?: boolean;
    /** Allow readonly memory context provider output only when explicitly registered. */
    provider?: boolean;
    /** Allow candidate fact proposals only; no durable promotion. */
    proposeFacts?: boolean;
    /** Default-off gate for local sanitized persistence; TaskLoop writes also require shadow. */
    persist?: boolean;
    /**
     * Area 4 §3.4: chat-turn memory injection pilot gate (default-off).
     * When enabled, the agent gateway queries registered memory context
     * providers and appends a `## Memory Context` block to extraSystemPrompt
     * for matching sessions. When disabled (or omitted), prompt bytes are
     * byte-identical to today (comms replay parity, §8).
     */
    injectPilot?: {
      /** Explicit opt-in; omitted or non-true leaves legacy behavior unchanged. */
      enabled?: boolean;
      /** Provider ids to query; unknown ids are filtered. Defaults to ['role-memory']. */
      providers?: Array<"role-memory" | "runtime-memory">;
      /** Total token budget across all providers; defaults to 768. */
      totalTokenBudget?: number;
      /** Session scope; defaults to 'main-only' (agent:<id>:main sessions). */
      sessions?: "all" | "main-only";
    };
  };
  /** Runtime AgentMap shadow/provider flags. Defaults are off. */
  agentMap?: {
    /** Allow readonly AgentMap context provider output only when explicitly registered. */
    provider?: boolean;
    /** Allow experimental AgentMap prompt candidate assembly only for explicit evaluation. */
    promptAssemblyExperiment?: boolean;
    /** Allow runtime shadow diagnostics for prompt candidates; also requires promptAssemblyExperiment. */
    promptCandidateRuntimeShadow?: boolean;
    /** Allow controlled prompt candidate pilot output; also requires promptAssemblyExperiment and promptCandidateRuntimeShadow. */
    promptCandidateControlledCutoverPilot?: boolean;
    /** Allow explicit TaskLoop reviewer prompt pilot output; also requires all prompt candidate pilot gates and explicit invocation. */
    promptCandidateTaskLoopExplicitInvocationPilot?: boolean;
  };
  /** Local runtime control-plane observe-only report flags. Defaults are off. */
  localControlPlane?: {
    /** Record LoopContextPack diagnostics without changing prompt text. */
    contextReport?: boolean;
    /** Record model-router recommendations without changing selected models. */
    modelRouterReport?: boolean;
    /** Record Skill/MCP governance summaries without enabling or registering capabilities. */
    capabilityReport?: boolean;
    /** Record evidence coverage summaries without changing completion gates. */
    evidenceReport?: boolean;
    /** Record Mission/Task Loop lifecycle summaries without changing decisions. */
    missionReport?: boolean;
  };
  /**
   * Area 3 §3.1 / §3.4: multi-agent orchestration pilot flags. Defaults are off;
   * legacy orchestration behavior is byte-identical when omitted.
   */
  orchestration?: {
    /**
     * Routing memo store pilot (Area 3 §3.1). Records each orchestration's
     * routing decision + outcome to a per-workspace JSONL store; on the next
     * plan, recalls similar-task memos as an additive scoring signal.
     * - 'shadow': memos are recorded/recalled; would-be adjustment is written
     *   into `RouteDiagnostics.reasons` as `memo-shadow:...` but scores are
     *   unchanged (byte-identical routing).
     * - 'active': memos apply a bounded ±2/−1 score adjustment to the matching
     *   role (keyword evidence stays dominant).
     * Gate to active: ≥20 shadow runs + ≥70% divergence improvement (§6).
     */
    routingMemoPilot?: "off" | "shadow" | "active";
    /**
     * Handoff artifacts pilot (Area 3 §3.4). When 'on', dependent workers
     * receive their predecessor's expected outputSchema sections in
     * `extraSystemPrompt` along `handoff` graph edges. Adds prompt text only
     * — never tools or permissions (§9 boundary). Default-off for one release
     * alongside the memo pilot.
     */
    handoffArtifacts?: "off" | "on";
  };
  /**
   * Area 3 Round 2: runtime resilience pilot flags. Defaults are off; when
   * omitted, `MissionReviewerInput.anomalyPattern` is `undefined` and the
   * Mission reviewer behaves exactly as before (flag-off parity, §1.2).
   */
  resilience?: {
    /**
     * Anomaly classifier pilot gate. When 'shadow', `classifyAnomalyPattern`
     * is invoked before the Mission reviewer and the result is injected into
     * `MissionReviewerInput.anomalyPattern?` (advisory only — the reviewer
     * MAY ignore it, observe-only honesty, area-3-runtime-resilience.md §9.1).
     * When 'off' (default), the field is always `undefined`.
     */
    anomalyClassifierPilot?: "off" | "shadow";
  };
};

/** Top-level OpenClaw config as read from user/project config files. */
export type OpenClawConfig = {
  /** JSON schema URL used by editors and generated config files. */
  $schema?: string;
  meta?: {
    /** Last OpenClaw version that wrote this config. */
    lastTouchedVersion?: string;
    /** ISO timestamp when this config was last written. */
    lastTouchedAt?: string;
  };
  /** Authentication provider/profile configuration. */
  auth?: AuthConfig;
  /** Named access groups used by channel/provider policy allowlists. */
  accessGroups?: AccessGroupsConfig;
  /** ACP integration settings. */
  acp?: AcpConfig;
  /** Runtime-core migration flags and runtime-owned feature gates. */
  runtime?: RuntimeFeatureConfig;
  env?: {
    /** Opt-in: import missing secrets from a login shell environment (exec `$SHELL -l -c 'env -0'`). */
    shellEnv?: {
      enabled?: boolean;
      /** Timeout for the login shell exec (ms). Default: 15000. */
      timeoutMs?: number;
    };
    /** Inline env vars to apply when not already present in the process env. */
    vars?: Record<string, string>;
    /** Sugar: allow env vars directly under env (string values only). */
    [key: string]:
      | string
      | Record<string, string>
      | { enabled?: boolean; timeoutMs?: number }
      | undefined;
  };
  wizard?: {
    /** Last setup wizard completion timestamp. */
    lastRunAt?: string;
    /** OpenClaw version used by the last completed wizard run. */
    lastRunVersion?: string;
    /** Git commit used by the last completed wizard run, when available. */
    lastRunCommit?: string;
    /** Command that invoked the last wizard run. */
    lastRunCommand?: string;
    /** Whether the last wizard run configured a local or remote install. */
    lastRunMode?: "local" | "remote";
  };
  /** Diagnostics, tracing, and stability debugging settings. */
  diagnostics?: DiagnosticsConfig;
  /** Log sink, level, rotation, and redaction settings. */
  logging?: LoggingConfig;
  /** Security audit suppressions and security policy settings. */
  security?: SecurityConfig;
  /** CLI defaults and command-specific settings. */
  cli?: CliConfig;
  /** Crestodian rescue/maintenance integration settings. */
  crestodian?: CrestodianConfig;
  update?: {
    /** Update channel for git + npm installs ("stable", "beta", or "dev"). */
    channel?: "stable" | "beta" | "dev";
    /** Check for updates on gateway start (npm installs only). */
    checkOnStart?: boolean;
    /** Core auto-update policy for package installs. */
    auto?: {
      /** Enable background auto-update checks and apply logic. Default: false. */
      enabled?: boolean;
      /** Stable channel minimum delay before auto-apply. Default: 6. */
      stableDelayHours?: number;
      /** Additional stable-channel jitter window. Default: 12. */
      stableJitterHours?: number;
      /** Beta channel check cadence. Default: 1 hour. */
      betaCheckIntervalHours?: number;
    };
  };
  /** Browser automation and browser plugin integration settings. */
  browser?: BrowserConfig;
  ui?: {
    /** Accent color for OpenClaw UI chrome (hex). */
    seamColor?: string;
    assistant?: {
      /** Assistant display name for UI surfaces. */
      name?: string;
      /** Assistant avatar (emoji, short text, or image URL/data URI). */
      avatar?: string;
    };
  };
  /** Secret providers, defaults, and ref-resolution settings. */
  secrets?: SecretsConfig;
  /** Skill loading and bundled skill configuration. */
  skills?: SkillsConfig;
  /** Plugin registry/install/runtime configuration. */
  plugins?: PluginsConfig;
  /** Per-surface policy keyed by channel/UI/runtime surface id. */
  surfaces?: Record<string, SurfaceConfigEntry>;
  /** Model providers, model catalog, pricing, and catalog merge policy. */
  models?: ModelsConfig;
  /** Node-host pairing and remote command node settings. */
  nodeHost?: NodeHostConfig;
  /** Agent definitions, defaults, bindings, and runtime policy. */
  agents?: AgentsConfig;
  /** Tool exposure, policy, web/media tools, exec, and code-mode settings. */
  tools?: ToolsConfig;
  /** Legacy/direct agent bindings used by runtime resolution. */
  bindings?: AgentBinding[];
  /** Broadcast command and delivery settings. */
  broadcast?: BroadcastConfig;
  /** Audio command and media handling settings. */
  audio?: AudioConfig;
  media?: {
    /** Preserve original uploaded filenames when storing inbound media. */
    preserveFilenames?: boolean;
    /** Optional retention window for persisted inbound media cleanup. */
    ttlHours?: number;
  };
  /** Message formatting, delivery, and action settings. */
  messages?: MessagesConfig;
  /** Chat command settings. */
  commands?: CommandsConfig;
  /** Human approval workflow settings. */
  approvals?: ApprovalsConfig;
  /** Session keying, reset, maintenance, send-policy, and thread-binding settings. */
  session?: SessionConfig;
  /** Web runtime settings, including WhatsApp web transport controls. */
  web?: WebConfig;
  /** Channel defaults, built-in channel sections, and plugin-owned channel config. */
  channels?: ChannelsConfig;
  /** Cron schedule and retention settings. */
  cron?: CronConfig;
  /** Transcript persistence and export settings. */
  transcripts?: TranscriptsConfig;
  /** Commitment/reminder extraction settings. */
  commitments?: CommitmentsConfig;
  /** Runtime hook registration and queue behavior. */
  hooks?: HooksConfig;
  /** Network discovery and service advertisement settings. */
  discovery?: DiscoveryConfig;
  /** Voice/talk mode configuration. */
  talk?: TalkConfig;
  /** Gateway server, auth, UI, node-pairing, and dispatch settings. */
  gateway?: GatewayConfig;
  /** Memory indexing/search configuration. */
  memory?: MemoryConfig;
  /** MCP client/server and Codex MCP approval configuration. */
  mcp?: McpConfig;
  /** Network-level SSRF protection via an operator-managed forward proxy. */
  proxy?: ProxyConfig;
};

/** Config input shape accepted before model provider defaults are fully materialized. */
export type OpenClawConfigInput = Omit<OpenClawConfig, "models"> & {
  models?: ModelsConfigInput;
};

declare const openClawConfigStateBrand: unique symbol;

type BrandedConfigState<TState extends string> = OpenClawConfig & {
  readonly [openClawConfigStateBrand]?: TState;
};

/** Authored config before include/env resolution and runtime defaults. */
export type SourceConfig = BrandedConfigState<"source">;
/** Source config after includes/env substitution, before runtime defaults. */
export type ResolvedSourceConfig = BrandedConfigState<"resolved-source">;
/** Runtime-materialized config with defaults/normalization applied. */
export type RuntimeConfig = BrandedConfigState<"runtime">;

export type ConfigValidationIssue = {
  /** Dot-path to the invalid or legacy config value. */
  path: string;
  /** Human-readable validation message. */
  message: string;
  /** Optional allowed values shown to the operator. */
  allowedValues?: string[];
  /** Number of allowed values omitted from the display list. */
  allowedValuesHiddenCount?: number;
};

export type LegacyConfigIssue = {
  /** Dot-path to the legacy config value. */
  path: string;
  /** Human-readable migration or rejection message. */
  message: string;
};

export type ConfigFileSnapshot = {
  /** Config file path that was read. */
  path: string;
  /** Whether the config file exists on disk. */
  exists: boolean;
  /** Raw file contents before parsing; null when missing. */
  raw: string | null;
  /** Parsed JSON/JSONC/YAML value before schema normalization. */
  parsed: unknown;
  /**
   * Config authored on disk after $include resolution and ${ENV} substitution,
   * but BEFORE runtime defaults are applied.
   */
  sourceConfig: ResolvedSourceConfig;
  /**
   * Config after $include resolution and ${ENV} substitution, but BEFORE runtime
   * defaults are applied. Use this for config set/unset operations to avoid
   * leaking runtime defaults into the written config file.
   */
  resolved: ResolvedSourceConfig;
  valid: boolean;
  /** Runtime-shaped config used by in-process readers. */
  runtimeConfig: RuntimeConfig;
  /** @deprecated Prefer runtimeConfig. */
  config: RuntimeConfig;
  hash?: string;
  issues: ConfigValidationIssue[];
  warnings: ConfigValidationIssue[];
  legacyIssues: LegacyConfigIssue[];
};
