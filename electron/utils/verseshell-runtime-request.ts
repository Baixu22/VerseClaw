const VERSESHELL_ROLLOUT_BINDINGS = [
  ["verifiedRuntime", "VERSE_VERSESHELL_FOUNDATION_VERIFIED_RUNTIME"],
  ["typedAci", "VERSE_VERSESHELL_FOUNDATION_TYPED_ACI"],
  ["facade", "VERSE_VERSESHELL_FOUNDATION_FACADE"],
  ["deferredOps", "VERSE_VERSESHELL_FOUNDATION_DEFERRED_OPS"],
  ["governedExec", "VERSE_VERSESHELL_FOUNDATION_GOVERNED_EXEC"],
  ["artifactResults", "VERSE_VERSESHELL_FOUNDATION_ARTIFACT_RESULTS"],
  ["mcpCompatibility", "VERSE_VERSESHELL_FOUNDATION_MCP_COMPATIBILITY"],
  ["legacyEval", "VERSE_VERSESHELL_FOUNDATION_LEGACY_EVAL"],
  ["compatibilityNativeFallback", "VERSE_VERSESHELL_FOUNDATION_NATIVE_FALLBACK"],
  ["readOnlyShadow", "VERSE_VERSESHELL_FOUNDATION_READ_ONLY_SHADOW"],
] as const;

const VERSESHELL_KILL_SWITCH_ENV = "VERSE_VERSESHELL_FOUNDATION_KILL_SWITCH";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
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

function foundationConfig(config: unknown): Record<string, unknown> {
  const root = asRecord(config);
  if (!root) return {};
  return asRecord(asRecord(root.runtime)?.verseShellFoundation)
    ?? asRecord(root.verseShellFoundation)
    ?? {};
}

/** Mirrors the OpenClaw rollout precedence needed before Gateway spawn. */
export function isVerseShellRuntimeRequestedByRollout(
  config: unknown,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const foundation = foundationConfig(config);
  if (parseBoolean(env[VERSESHELL_KILL_SWITCH_ENV]) === true || parseBoolean(foundation.killSwitch) === true) {
    return false;
  }
  return VERSESHELL_ROLLOUT_BINDINGS.some(([configName, envName]) => (
    (parseBoolean(env[envName]) ?? parseBoolean(foundation[configName]) ?? false) === true
  ));
}
