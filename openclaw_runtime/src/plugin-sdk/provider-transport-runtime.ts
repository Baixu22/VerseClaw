/**
 * Runtime SDK subpath for provider transport helpers and stream primitives.
 */
export { buildGuardedModelFetch } from "../agents/provider-transport-fetch.js";
export {
  beginShadowModelCall,
  emitShadowWireReceipt,
  getShadowReceiptOptions,
  attachShadowReceiptOptions,
  recordShadowCensusFailure,
  RC02_SHADOW_OPTIONS,
  type ShadowReceiptOptions,
} from "../agents/shadow-census.js";
export { buildOpenAICompletionsParams } from "../agents/openai-transport-stream.js";
export { stripSystemPromptCacheBoundary } from "../agents/system-prompt-cache-boundary.js";
export { transformTransportMessages } from "../agents/transport-message-transform.js";
export {
  coerceTransportToolCallArguments,
  createEmptyTransportUsage,
  createWritableTransportEventStream,
  failTransportStream,
  finalizeTransportStream,
  mergeTransportHeaders,
  sanitizeTransportPayloadText,
  type WritableTransportStream,
} from "../agents/transport-stream-shared.js";
