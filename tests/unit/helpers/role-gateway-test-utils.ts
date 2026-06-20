// Minimal test helpers for role-first gateway handler integration tests.
//
// The real GatewayRequestContext (shared-types.ts) is large and gateway-only;
// handlers under test only touch `context.getRuntimeConfig()`, so we build a
// minimal fake context via a type cast rather than constructing the full type.
//
// These helpers let tests exercise the REAL roleOrchestrationHandlers against
// a captured respond() sink and a controlled config — closing the gap between
// unit tests (which inject fake spawns) and the gateway integration layer.
import type { OpenClawConfig } from '../../../openclaw_runtime/src/config/types.openclaw';

/** Captured respond() call. Handlers call respond(ok, payload, error, meta). */
export type CapturedRespond = {
  ok: boolean;
  payload?: unknown;
  error?: { code?: string | number; message?: string };
  meta?: Record<string, unknown>;
};

/**
 * Builds a respond() fn that records the single call into `target`.
 * Handlers respond exactly once, so a single-slot capture is sufficient.
 */
export function captureRespond(target: CapturedRespond[]): {
  respond: (...args: Parameters<(...a: unknown[]) => void>) => void;
} {
  return {
    respond: (ok, payload, error, meta) => {
      target.push({ ok: ok as boolean, payload, error: error as CapturedRespond['error'], meta: meta as Record<string, unknown> });
    },
  };
}

/** A minimal handler-arg shape: only the fields role handlers actually read. */
export type HandlerArgs = {
  params: Record<string, unknown>;
  respond: (...args: unknown[]) => void;
  context: {
    getRuntimeConfig: () => OpenClawConfig;
  };
};

/** Builds handler args with a captured respond and a controlled config. */
export function buildHandlerArgs(
  params: Record<string, unknown>,
  cfg: OpenClawConfig,
  respondTarget: CapturedRespond[],
): HandlerArgs {
  return {
    params,
    respond: captureRespond(respondTarget).respond,
    context: { getRuntimeConfig: () => cfg },
  };
}

/** An empty OpenClawConfig baseline (no roles, no providers). */
export function emptyConfig(): OpenClawConfig {
  return {} as OpenClawConfig;
}

/** Config carrying role contracts under cfg.agents.roles. */
export function configWithRoles(
  roles: Array<Record<string, unknown>>,
): OpenClawConfig {
  return { agents: { roles } } as unknown as OpenClawConfig;
}
