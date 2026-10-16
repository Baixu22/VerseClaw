/**
 * Gateway server-method types required by agent-browser.ts.
 *
 * Source: openclaw_runtime/src/gateway/server-methods/shared-types.ts
 * Adaptive: only the members consumed by agentBrowserHandlers are declared so
 * the package does not pull the full OpenClaw gateway type graph.
 */
import type { ErrorShape } from "../gateway-protocol/index.ts";
import type { GatewayClientInfo } from "../gateway-protocol/client-info.ts";

export type GatewayClient = {
  connect: {
    client: GatewayClientInfo | { id?: string; mode?: string };
  };
  connId?: string;
};

export type RespondFn = (
  ok: boolean,
  payload?: unknown,
  error?: ErrorShape,
  meta?: Record<string, unknown>,
) => void;

export type GatewayRequestContext = {
  getApprovalClientConnIds?: <TPayload>(params?: {
    excludeConnId?: string;
    filter?: (client: GatewayClient, record?: unknown) => boolean;
    record?: unknown;
  }) => ReadonlySet<string>;
  broadcastToConnIds: (
    event: string,
    payload: unknown,
    connIds: ReadonlySet<string>,
    opts?: { dropIfSlow?: boolean },
  ) => void;
};

export type GatewayRequestHandlerOptions = {
  params: Record<string, unknown>;
  client: GatewayClient | null;
  respond: RespondFn;
  context: GatewayRequestContext;
};

export type GatewayRequestHandler = (opts: GatewayRequestHandlerOptions) => Promise<void> | void;

export type GatewayRequestHandlers = Record<string, GatewayRequestHandler>;
