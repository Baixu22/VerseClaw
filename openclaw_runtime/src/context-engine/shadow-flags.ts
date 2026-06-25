export type RuntimeContextProviderShadowConfig = {
  contextProviders?: {
    shadow?: boolean;
    loopPackShadow?: boolean;
  };
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function runtimeConfigFrom(value: unknown): RuntimeContextProviderShadowConfig | undefined {
  const record = asRecord(value);
  const directRuntime = asRecord(record?.runtime);
  if (directRuntime) return directRuntime as RuntimeContextProviderShadowConfig;
  const configRuntime = asRecord(asRecord(record?.config)?.runtime);
  return configRuntime as RuntimeContextProviderShadowConfig | undefined;
}

export function contextProviderShadowFlagEnabled(
  value: unknown,
  flag: keyof NonNullable<RuntimeContextProviderShadowConfig["contextProviders"]>,
): boolean {
  const runtime = runtimeConfigFrom(value);
  return asRecord(runtime?.contextProviders)?.[flag] === true;
}

