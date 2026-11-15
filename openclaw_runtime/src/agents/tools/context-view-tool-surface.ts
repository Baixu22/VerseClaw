/**
 * TF-0495: single contract for the four read-only DCS context view tools.
 *
 * The core tool catalog already declares these tools in the coding profile.
 * This module makes the runtime registration and the model-facing availability
 * explanation derive from the same catalog digest instead of an env-only gate.
 */
import { createHash } from "node:crypto";
import { CONTEXT_TOOL_SUMMARY_BY_NAME } from "../../context-engine/coding-tool-navigation.js";
import type { WorkspaceFactService } from "../../context-engine/factstore/workspace-fact-service.js";
import { parseBooleanValue } from "../../utils/boolean.js";

export const CONTEXT_UNDERSTAND_TOOL_NAME = "context_understand";
export const CONTEXT_IMPACT_TOOL_NAME = "context_impact";
export const CONTEXT_REUSE_TOOL_NAME = "context_reuse";
export const CONTEXT_VERIFY_TOOL_NAME = "context_verify";

export const CONTEXT_VIEW_TOOL_SURFACE_SCHEMA = "ContextViewToolSurface/v1" as const;

export const CONTEXT_VIEW_TOOL_NAMES = [
  CONTEXT_UNDERSTAND_TOOL_NAME,
  CONTEXT_IMPACT_TOOL_NAME,
  CONTEXT_REUSE_TOOL_NAME,
  CONTEXT_VERIFY_TOOL_NAME,
] as const;

export type ContextViewToolName = (typeof CONTEXT_VIEW_TOOL_NAMES)[number];

export type ContextViewToolCatalogEntry = {
  name: ContextViewToolName;
  selector: string;
  summary: string;
};

export const CONTEXT_VIEW_TOOL_CATALOG: readonly ContextViewToolCatalogEntry[] = [
  {
    name: "context_understand",
    selector: "fact.view.context_understand",
    summary: CONTEXT_TOOL_SUMMARY_BY_NAME.context_understand!,
  },
  {
    name: "context_impact",
    selector: "fact.view.context_impact",
    summary: CONTEXT_TOOL_SUMMARY_BY_NAME.context_impact!,
  },
  {
    name: "context_reuse",
    selector: "fact.view.context_reuse",
    summary: CONTEXT_TOOL_SUMMARY_BY_NAME.context_reuse!,
  },
  {
    name: "context_verify",
    selector: "fact.view.context_verify",
    summary: CONTEXT_TOOL_SUMMARY_BY_NAME.context_verify!,
  },
] as const;

export function contextViewToolCatalogDigest(
  entries: readonly ContextViewToolCatalogEntry[] = CONTEXT_VIEW_TOOL_CATALOG,
): string {
  const canonical = entries
    .map((entry) => ({
      name: entry.name,
      selector: entry.selector,
      summary: entry.summary,
    }))
    .toSorted((left, right) => left.name.localeCompare(right.name));
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export const CONTEXT_VIEW_TOOL_CATALOG_DIGEST_SHA256 = contextViewToolCatalogDigest();

export type ContextViewToolSurfaceMode =
  | "healthy"
  | "missing-dependency"
  | "context-store-unavailable"
  | "permission-denied"
  | "explicitly-disabled";

export type ContextViewToolSurfaceState = {
  schemaVersion: typeof CONTEXT_VIEW_TOOL_SURFACE_SCHEMA;
  mode: ContextViewToolSurfaceMode;
  enabled: boolean;
  activeToolNames: readonly ContextViewToolName[];
  catalog: readonly ContextViewToolCatalogEntry[];
  catalogDigest: string;
  reason: string | null;
  recoverable: boolean;
};

export type ContextViewToolSurfaceOptions = {
  env?: NodeJS.ProcessEnv;
  factService?: WorkspaceFactService;
  viewToolsEnabled?: boolean;
  workspaceHealthy?: boolean;
  contextStoreHealthy?: boolean;
  permissionAllowed?: boolean;
  unavailableReason?: string;
};

function explicitViewToolsSwitch(env: NodeJS.ProcessEnv, explicit?: boolean): boolean | undefined {
  if (typeof explicit === "boolean") {
    return explicit;
  }
  const raw = env.OPENCLAW_DCS_CONTEXT_VIEW_TOOLS ?? env.OPENCLAW_DCS_CONTEXT_TOOLS;
  if (raw === undefined) {
    return undefined;
  }
  return parseBooleanValue(raw) ?? false;
}

function healthyState(): ContextViewToolSurfaceState {
  return {
    schemaVersion: CONTEXT_VIEW_TOOL_SURFACE_SCHEMA,
    mode: "healthy",
    enabled: true,
    activeToolNames: [...CONTEXT_VIEW_TOOL_NAMES],
    catalog: CONTEXT_VIEW_TOOL_CATALOG,
    catalogDigest: CONTEXT_VIEW_TOOL_CATALOG_DIGEST_SHA256,
    reason: null,
    recoverable: true,
  };
}

function unavailableState(
  mode: Exclude<ContextViewToolSurfaceMode, "healthy">,
  reason: string,
  recoverable = true,
): ContextViewToolSurfaceState {
  return {
    schemaVersion: CONTEXT_VIEW_TOOL_SURFACE_SCHEMA,
    mode,
    enabled: false,
    activeToolNames: [],
    catalog: CONTEXT_VIEW_TOOL_CATALOG,
    catalogDigest: CONTEXT_VIEW_TOOL_CATALOG_DIGEST_SHA256,
    reason,
    recoverable,
  };
}

export function resolveContextViewToolSurfaceState(
  options: ContextViewToolSurfaceOptions = {},
): ContextViewToolSurfaceState {
  const env = options.env ?? process.env;
  const explicit = explicitViewToolsSwitch(env, options.viewToolsEnabled);
  if (explicit === false) {
    return unavailableState(
      "explicitly-disabled",
      "The context view tools were explicitly disabled by rollback configuration.",
    );
  }
  if (!options.factService) {
    return unavailableState(
      "missing-dependency",
      options.unavailableReason ??
        "The workspace FactService is unavailable, so the four read-only context view tools are not registered.",
    );
  }
  if (options.workspaceHealthy === false) {
    return unavailableState(
      "missing-dependency",
      options.unavailableReason ??
        "The workspace health check did not pass, so the four read-only context view tools are not registered.",
    );
  }
  if (options.contextStoreHealthy === false) {
    return unavailableState(
      "context-store-unavailable",
      options.unavailableReason ??
        "The context store could not be opened for this turn, so the four read-only context view tools are unavailable until it recovers.",
    );
  }
  if (options.permissionAllowed === false) {
    return unavailableState(
      "permission-denied",
      options.unavailableReason ??
        "The current permission/tool policy does not allow the read-only context view tools.",
      false,
    );
  }
  return healthyState();
}
