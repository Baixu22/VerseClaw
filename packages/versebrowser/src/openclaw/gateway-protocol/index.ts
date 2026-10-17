/**
 * Gateway protocol entrypoint subset for agent-browser standalone package.
 * Source: openclaw_runtime/packages/gateway-protocol/src/index.ts re-exports.
 */
export { ErrorCodes, errorShape, type ErrorCode } from "./error-codes.ts";
export type { ErrorShape } from "./types.ts";
export {
  GATEWAY_CLIENT_IDS,
  GATEWAY_CLIENT_NAMES,
  GATEWAY_CLIENT_MODES,
  GATEWAY_CLIENT_CAPS,
  type GatewayClientId,
  type GatewayClientName,
  type GatewayClientMode,
  type GatewayClientInfo,
  type GatewayClientCap,
} from "./client-info.ts";
