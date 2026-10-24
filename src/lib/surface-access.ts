/**
 * Product/developer surface access policy (TF-0505).
 *
 * Routing uses this module to gate experimental pages while the Developer
 * settings entry remains explicitly unlockable. Retired surfaces stay
 * unreachable even in development; agent-dev scenarios may open non-product
 * showcases only in a dev/test runtime.
 */
export type SurfaceAccessReason = "product" | "dev-mode" | "dev-runtime" | "developer-only" | "retired";

export type SurfaceAccessDecision = {
  allowed: boolean;
  reason: SurfaceAccessReason;
};

const RETIRED_SURFACE_PATHS = new Set(["/dreams"]);
const DEV_OR_TEST_SURFACE_PATHS = new Set(["/ui-v2-showcase"]);
const DEVELOPER_SURFACE_PATHS = new Set(["/settings/developer"]);

function normalizedPathname(pathname: string): string {
  const normalized = pathname.trim().split("?")[0]?.split("#")[0] ?? "";
  if (!normalized) return "/";
  return normalized.length > 1 ? normalized.replace(/\/+$/u, "") : normalized;
}

export function isDevRuntime(): boolean {
  return typeof import.meta.env !== "undefined" && Boolean(import.meta.env.DEV || import.meta.env.VITE_E2E);
}

export function isDeveloperSurfacePath(pathname: string): boolean {
  return DEVELOPER_SURFACE_PATHS.has(normalizedPathname(pathname));
}

export function isDevOrTestSurfacePath(pathname: string): boolean {
  return DEV_OR_TEST_SURFACE_PATHS.has(normalizedPathname(pathname));
}

export function resolveSurfaceAccess(input: {
  pathname: string;
  devModeUnlocked: boolean;
  devRuntime: boolean;
}): SurfaceAccessDecision {
  const pathname = normalizedPathname(input.pathname);
  if (RETIRED_SURFACE_PATHS.has(pathname)) return { allowed: false, reason: "retired" };
  if (isDeveloperSurfacePath(pathname)) {
    return input.devModeUnlocked
      ? { allowed: true, reason: "dev-mode" }
      : { allowed: false, reason: "developer-only" };
  }
  if (isDevOrTestSurfacePath(pathname)) {
    if (input.devRuntime) return { allowed: true, reason: "dev-runtime" };
    return input.devModeUnlocked
      ? { allowed: true, reason: "dev-mode" }
      : { allowed: false, reason: "developer-only" };
  }
  return { allowed: true, reason: "product" };
}

