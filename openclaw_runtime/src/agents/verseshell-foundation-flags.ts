const FOUNDATION_FLAG_NAMES = [
  "verifiedRuntime",
  "typedAci",
  "facade",
  "deferredOps",
  "governedExec",
  "artifactResults",
  "patchPreview",
  "mcpCompatibility",
  "legacyEval",
  "compatibilityNativeFallback",
  "readOnlyShadow",
] as const;

export type VerseShellFoundationFlagName = (typeof FOUNDATION_FLAG_NAMES)[number];
export type VerseShellFoundationFlagSource = "default" | "config" | "environment" | "kill-switch";

export type ResolvedVerseShellFoundationFlag = {
  enabled: boolean;
  source: VerseShellFoundationFlagSource;
  reason: string;
};

export type VerseShellFoundationRolloutConfig = {
  schemaVersion: 1;
  killSwitch: {
    engaged: boolean;
    reason: string;
  };
  flags: Record<VerseShellFoundationFlagName, ResolvedVerseShellFoundationFlag>;
  enabled: Record<VerseShellFoundationFlagName, boolean>;
  governedExecNativeFallback: false;
  shadowAccess: "disabled" | "read-only";
};

export type ResolveVerseShellFoundationRolloutInput = {
  /** Accepts a direct flag object, verseShellFoundation, or runtime.verseShellFoundation. */
  config?: unknown;
  env?: Readonly<Record<string, string | undefined>>;
  /** Project-wide authority can inject its existing kill-switch decision here. */
  globalKillSwitch?: boolean | (() => boolean);
};

export const VERSESHELL_FOUNDATION_KILL_SWITCH_ENV = "VERSE_VERSESHELL_FOUNDATION_KILL_SWITCH";

const FLAG_ENV_NAMES: Record<VerseShellFoundationFlagName, string> = {
  verifiedRuntime: "VERSE_VERSESHELL_FOUNDATION_VERIFIED_RUNTIME",
  typedAci: "VERSE_VERSESHELL_FOUNDATION_TYPED_ACI",
  facade: "VERSE_VERSESHELL_FOUNDATION_FACADE",
  deferredOps: "VERSE_VERSESHELL_FOUNDATION_DEFERRED_OPS",
  governedExec: "VERSE_VERSESHELL_FOUNDATION_GOVERNED_EXEC",
  artifactResults: "VERSE_VERSESHELL_FOUNDATION_ARTIFACT_RESULTS",
  patchPreview: "VERSE_VERSESHELL_FOUNDATION_PATCH_PREVIEW",
  mcpCompatibility: "VERSE_VERSESHELL_FOUNDATION_MCP_COMPATIBILITY",
  legacyEval: "VERSE_VERSESHELL_FOUNDATION_LEGACY_EVAL",
  compatibilityNativeFallback: "VERSE_VERSESHELL_FOUNDATION_NATIVE_FALLBACK",
  readOnlyShadow: "VERSE_VERSESHELL_FOUNDATION_READ_ONLY_SHADOW",
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function flagConfig(value: unknown): Record<string, unknown> {
  const root = asRecord(value);
  if (!root) return {};
  const runtime = asRecord(root.runtime);
  const nested = asRecord(runtime?.verseShellFoundation) ?? asRecord(root.verseShellFoundation);
  return nested ?? root;
}

function parseBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  switch (value.trim().toLowerCase()) {
    case "1":
    case "true":
    case "yes":
    case "on":
      return true;
    case "0":
    case "false":
    case "no":
    case "off":
      return false;
    default:
      return undefined;
  }
}

function resolveGlobalKillSwitch(
  value: ResolveVerseShellFoundationRolloutInput["globalKillSwitch"],
): { engaged: boolean; reason?: string } {
  try {
    const engaged = typeof value === "function" ? value() : value;
    return engaged === true
      ? { engaged: true, reason: "project global kill switch is engaged" }
      : { engaged: false };
  } catch {
    return {
      engaged: true,
      reason: "project global kill switch evaluation failed; foundation is fail-closed",
    };
  }
}

/**
 * Resolves an addition-only rollout view. It does not register flags or wire runtime behavior.
 * Every capability is independently default-off; shadow can only resolve to read-only.
 */
export function resolveVerseShellFoundationRollout(
  input: ResolveVerseShellFoundationRolloutInput = {},
): VerseShellFoundationRolloutConfig {
  const env = input.env ?? process.env;
  const config = flagConfig(input.config);
  const projectKillSwitch = resolveGlobalKillSwitch(input.globalKillSwitch);
  const environmentKillSwitch = parseBoolean(env[VERSESHELL_FOUNDATION_KILL_SWITCH_ENV]);
  const configKillSwitch = parseBoolean(config.killSwitch);
  const killReason =
    projectKillSwitch.reason ??
    (environmentKillSwitch === true
      ? `${VERSESHELL_FOUNDATION_KILL_SWITCH_ENV} is engaged`
      : configKillSwitch === true
        ? "verseShellFoundation.killSwitch is engaged"
        : undefined);
  const killSwitch =
    projectKillSwitch.engaged || environmentKillSwitch === true || configKillSwitch === true;

  const flags = {} as Record<VerseShellFoundationFlagName, ResolvedVerseShellFoundationFlag>;
  const enabled = {} as Record<VerseShellFoundationFlagName, boolean>;

  for (const name of FOUNDATION_FLAG_NAMES) {
    if (killSwitch) {
      flags[name] = {
        enabled: false,
        source: "kill-switch",
        reason: killReason ?? "foundation kill switch is engaged",
      };
      enabled[name] = false;
      continue;
    }

    const environmentValue = parseBoolean(env[FLAG_ENV_NAMES[name]]);
    const configValue = parseBoolean(config[name]);
    if (environmentValue !== undefined) {
      flags[name] = {
        enabled: environmentValue,
        source: "environment",
        reason: `${FLAG_ENV_NAMES[name]} explicitly set ${environmentValue ? "on" : "off"}`,
      };
    } else if (configValue !== undefined) {
      flags[name] = {
        enabled: configValue,
        source: "config",
        reason: `verseShellFoundation.${name} explicitly set ${configValue ? "on" : "off"}`,
      };
    } else {
      flags[name] = {
        enabled: false,
        source: "default",
        reason: "disabled by canary-safe foundation default",
      };
    }
    enabled[name] = flags[name].enabled;
  }

  return {
    schemaVersion: 1,
    killSwitch: {
      engaged: killSwitch,
      reason: killReason ?? "no foundation or project kill switch is engaged",
    },
    flags,
    enabled,
    // Compatibility fallback may be enabled for non-governed callers, but the governed path never uses it.
    governedExecNativeFallback: false,
    shadowAccess: enabled.readOnlyShadow ? "read-only" : "disabled",
  };
}
