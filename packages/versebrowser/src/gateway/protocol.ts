/**
 * Gateway protocol types required by agent-browser-bridge.
 * Extracted subset from electron/gateway/protocol.ts (JsonRpcNotification).
 */
export type JsonRpcNotification = {
  method: string;
  params?: unknown;
};

export type JsonRpcRequest = {
  id: string | number;
  method: string;
  params?: unknown;
};
