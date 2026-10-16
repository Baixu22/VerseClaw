/**
 * GatewayManager surface required by agent-browser-bridge.
 * Original: electron/gateway/manager.ts (full ClawX gateway manager).
 * Only the members used by registerAgentBrowserGatewayBridge are declared.
 */
import type { JsonRpcNotification } from './protocol.ts';

export type GatewayManager = {
  rpc: (method: string, params: unknown, timeoutMs?: number) => Promise<unknown>;
  on: (event: 'notification', listener: (notification: JsonRpcNotification) => void) => void;
  off: (event: 'notification', listener: (notification: JsonRpcNotification) => void) => void;
};
