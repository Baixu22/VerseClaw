import type { RawData } from "ws";
import { listSystemPresence } from "../../../infra/system-presence.js";
import { rawDataToString } from "../../../infra/ws.js";
import { ADMIN_SCOPE } from "../../method-scopes.js";
import { formatError } from "../../server-utils.js";
import type { GatewayWsMessageHandlerParams } from "./message-handler.js";

const MAX_QUEUED_MESSAGE_HANDLER_FRAMES = 16;

/** A challenge-only readiness probe does not need authentication or RPC execution. */
export function attachGatewayWsMessageHandlerOnDemand(params: GatewayWsMessageHandlerParams): void {
  const queued: RawData[] = [];
  let loading = false;
  const queueMessage = (data: RawData) => {
    if (params.isClosed()) return;
    const client = params.getClient();
    if (client) {
      try {
        const parsed = JSON.parse(rawDataToString(data)) as {
          type?: unknown;
          id?: unknown;
          method?: unknown;
        };
        const scopes = client.connect.scopes ?? [];
        if (
          parsed?.type === "req" &&
          parsed.method === "system-presence" &&
          typeof parsed.id === "string" &&
          (scopes.includes(ADMIN_SCOPE) || scopes.includes("operator.read"))
        ) {
          params.send({
            type: "res",
            id: parsed.id,
            ok: true,
            payload: listSystemPresence(),
          });
          return;
        }
      } catch {
        // The full handler reports malformed frames after it loads.
      }
    }
    if (queued.length >= MAX_QUEUED_MESSAGE_HANDLER_FRAMES) {
      params.setCloseCause("message-handler-loading-overflow", { queuedFrames: queued.length });
      params.close(1008, "gateway message handler loading");
      return;
    }
    queued.push(data);
    if (loading) return;
    loading = true;
    void import("./message-handler.js")
      .then(
        async ({
          attachGatewayWsMessageHandler,
          createGatewayWsMessageProcessor,
          runGatewayWsMessageProcessor,
        }) => {
          if (params.isClosed()) return;
          const handleMessage = createGatewayWsMessageProcessor(params);
          for (;;) {
            const data = queued.shift();
            if (!data || params.isClosed()) break;
            try {
              await runGatewayWsMessageProcessor(handleMessage, data);
            } catch (error) {
              params.logWsControl.warn(
                `ws message handler failed conn=${params.connId}: ${formatError(error)}`,
              );
            }
          }
          params.socket.off("message", queueMessage);
          if (!params.isClosed()) attachGatewayWsMessageHandler(params);
        },
      )
      .catch((error: unknown) => {
        params.socket.off("message", queueMessage);
        params.setCloseCause("message-handler-load-failed", { error: formatError(error) });
        params.logWsControl.warn(
          `failed to load ws message handler conn=${params.connId}: ${formatError(error)}`,
        );
        params.close(1011, "gateway message handler unavailable");
      });
  };
  params.socket.on("message", queueMessage);
  params.socket.once("close", () => {
    queued.length = 0;
    params.socket.off("message", queueMessage);
  });
}
