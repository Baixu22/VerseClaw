/**
 * ErrorShape wire type for agent-browser standalone package.
 * Source shape: openclaw_runtime/packages/gateway-protocol/src/schema/types.ts
 * (ErrorShape = SchemaType<"ErrorShape">). Inlined here so the package does not
 * need the full ProtocolSchemas TypeBox graph.
 */
export type ErrorShape = {
  code: string;
  message: string;
  details?: unknown;
  retryable?: boolean;
  retryAfterMs?: number;
};
