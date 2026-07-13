import { formatErrorMessage } from "../../infra/errors.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { resolveSecretInputRef } from "../../config/types.secrets.js";
import {
  GATEWAY_CLIENT_MODES,
  GATEWAY_CLIENT_NAMES,
} from "../../../packages/gateway-protocol/src/client-info.js";
import { validateSecretsResolveResult } from "../../../packages/gateway-protocol/src/index.js";
import { callGateway } from "../call.js";
import { analyzeCommandSecretAssignmentsFromSnapshot } from "../../secrets/command-config.js";
import { setPathExistingStrict } from "../../secrets/path-utils.js";
import { resolveSecretRefValue } from "../../secrets/resolve.js";
import { assertExpectedResolvedSecretValue } from "../../secrets/secret-value.js";
import { discoverConfigSecretTargetsByIds } from "../../secrets/target-registry.js";

export type CommandSecretResolutionMode =
  | "enforce_resolved"
  | "read_only_status"
  | "read_only_operational";
export type CommandSecretResolutionModeInput =
  | CommandSecretResolutionMode
  | "strict"
  | "summary"
  | "operational_readonly";
export type CommandSecretTargetState =
  | "resolved_gateway"
  | "resolved_local"
  | "inactive_surface"
  | "unresolved";

export type ResolveCommandSecretRefsViaGatewayOptions = {
  config: OpenClawConfig;
  commandName: string;
  targetIds: Set<string>;
  mode?: CommandSecretResolutionModeInput;
  allowedPaths?: ReadonlySet<string>;
  forcedActivePaths?: ReadonlySet<string>;
  optionalActivePaths?: ReadonlySet<string>;
};

export type ResolveCommandSecretRefsViaGatewayResult = {
  resolvedConfig: OpenClawConfig;
  diagnostics: string[];
  targetStatesByPath: Record<string, CommandSecretTargetState>;
  hadUnresolvedTargets: boolean;
};

function normalizeMode(mode: CommandSecretResolutionModeInput | undefined): CommandSecretResolutionMode {
  if (!mode || mode === "strict" || mode === "enforce_resolved") {
    return "enforce_resolved";
  }
  return mode === "summary" || mode === "read_only_status"
    ? "read_only_status"
    : "read_only_operational";
}

function selectedConfiguredTargets(options: ResolveCommandSecretRefsViaGatewayOptions) {
  const defaults = options.config.secrets?.defaults;
  return discoverConfigSecretTargetsByIds(options.config, options.targetIds).filter((target) => {
    if (options.allowedPaths && !options.allowedPaths.has(target.path)) {
      return false;
    }
    return Boolean(
      resolveSecretInputRef({
        value: target.value,
        refValue: target.refValue,
        defaults,
      }).ref,
    );
  });
}

function emptyResult(config: OpenClawConfig): ResolveCommandSecretRefsViaGatewayResult {
  return {
    resolvedConfig: config,
    diagnostics: [],
    targetStatesByPath: {},
    hadUnresolvedTargets: false,
  };
}

async function resolveLocally(
  options: ResolveCommandSecretRefsViaGatewayOptions,
  gatewayError: unknown,
): Promise<ResolveCommandSecretRefsViaGatewayResult> {
  const mode = normalizeMode(options.mode);
  const resolvedConfig = structuredClone(options.config);
  const states: Record<string, CommandSecretTargetState> = {};
  const diagnostics: string[] = [];
  const inactiveRefPaths = new Set<string>();
  const defaults = options.config.secrets?.defaults;

  for (const target of selectedConfiguredTargets(options)) {
    if (options.optionalActivePaths?.has(target.path)) {
      inactiveRefPaths.add(target.path);
    }
    const { ref } = resolveSecretInputRef({
      value: target.value,
      refValue: target.refValue,
      defaults,
    });
    if (!ref) {
      continue;
    }
    try {
      const value = await resolveSecretRefValue(ref, { config: options.config });
      assertExpectedResolvedSecretValue({
        value,
        expected: target.entry.expectedResolvedValue,
        errorMessage: `${target.path} resolved to an unsupported value.`,
      });
      setPathExistingStrict(resolvedConfig, target.pathSegments, value);
      states[target.path] = "resolved_local";
      inactiveRefPaths.delete(target.path);
    } catch (error) {
      states[target.path] = options.optionalActivePaths?.has(target.path)
        ? "inactive_surface"
        : "unresolved";
      if (mode !== "enforce_resolved") {
        setPathExistingStrict(resolvedConfig, target.pathSegments, undefined);
        diagnostics.push(
          `${options.commandName}: failed to resolve ${target.path} locally (${formatErrorMessage(error)}).`,
        );
      }
    }
  }

  const analyzed = analyzeCommandSecretAssignmentsFromSnapshot({
    sourceConfig: options.config,
    resolvedConfig,
    targetIds: options.targetIds,
    inactiveRefPaths,
    allowedPaths: options.allowedPaths,
  });
  for (const entry of analyzed.inactive) {
    states[entry.path] = "inactive_surface";
  }
  for (const entry of analyzed.unresolved) {
    states[entry.path] = "unresolved";
    if (mode !== "enforce_resolved") {
      setPathExistingStrict(resolvedConfig, entry.pathSegments, undefined);
    }
  }
  if (mode === "enforce_resolved" && analyzed.unresolved.length > 0) {
    throw new Error(
      `${options.commandName}: ${analyzed.unresolved[0]?.path ?? "target"} is unresolved; gateway failed (${formatErrorMessage(gatewayError)}).`,
      { cause: gatewayError },
    );
  }
  diagnostics.push(
    `${options.commandName}: gateway secrets.resolve unavailable (${formatErrorMessage(gatewayError)}); attempted local command-secret resolution.`,
  );
  return {
    resolvedConfig,
    diagnostics: [...new Set([...analyzed.diagnostics, ...diagnostics])],
    targetStatesByPath: states,
    hadUnresolvedTargets: Object.values(states).includes("unresolved"),
  };
}

export async function resolveCommandSecretRefsViaGateway(
  options: ResolveCommandSecretRefsViaGatewayOptions,
): Promise<ResolveCommandSecretRefsViaGatewayResult> {
  if (selectedConfiguredTargets(options).length === 0) {
    return emptyResult(options.config);
  }

  let payload: unknown;
  try {
    payload = await callGateway({
      config: options.config,
      method: "secrets.resolve",
      requiredMethods: ["secrets.resolve"],
      params: {
        commandName: options.commandName,
        targetIds: [...options.targetIds],
        ...(options.allowedPaths ? { allowedPaths: [...options.allowedPaths] } : {}),
        ...(options.forcedActivePaths
          ? { forcedActivePaths: [...options.forcedActivePaths] }
          : {}),
        ...(options.optionalActivePaths
          ? { optionalActivePaths: [...options.optionalActivePaths] }
          : {}),
      },
      timeoutMs: 30_000,
      clientName: GATEWAY_CLIENT_NAMES.CLI,
      mode: GATEWAY_CLIENT_MODES.CLI,
    });
  } catch (error) {
    return resolveLocally(options, error);
  }

  if (!validateSecretsResolveResult(payload)) {
    throw new Error(`${options.commandName}: gateway returned invalid secrets.resolve payload.`);
  }
  const resolvedConfig = structuredClone(options.config);
  const states: Record<string, CommandSecretTargetState> = {};
  for (const assignment of payload.assignments ?? []) {
    setPathExistingStrict(resolvedConfig, assignment.pathSegments, assignment.value);
    states[assignment.path ?? assignment.pathSegments.join(".")] = "resolved_gateway";
  }
  const inactiveRefPaths = new Set(payload.inactiveRefPaths ?? []);
  const analyzed = analyzeCommandSecretAssignmentsFromSnapshot({
    sourceConfig: options.config,
    resolvedConfig,
    targetIds: options.targetIds,
    inactiveRefPaths,
    allowedPaths: options.allowedPaths,
  });
  for (const entry of analyzed.inactive) {
    states[entry.path] = "inactive_surface";
  }
  if (analyzed.unresolved.length > 0) {
    return resolveLocally(options, new Error("gateway snapshot was incomplete"));
  }
  return {
    resolvedConfig,
    diagnostics: [...new Set([...(payload.diagnostics ?? []), ...analyzed.diagnostics])],
    targetStatesByPath: states,
    hadUnresolvedTargets: false,
  };
}
