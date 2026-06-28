import type {
  ChatRequest,
  ChatResponse,
  RuntimeEnvelope,
} from "../../../shared/types/chat";

export function dispatchRuntimeMessage(request: ChatRequest): ChatResponse {
  const envelope = buildRuntimeEnvelope(request);
  return {
    id: envelope.conversationId,
    accepted: envelope.payload.length > 0,
  };
}

export function buildRuntimeEnvelope(request: ChatRequest): RuntimeEnvelope {
  return {
    conversationId: request.conversationId,
    payload: request.body,
    source: "composer",
  };
}

export function buildDispatchRuntimeMessageNote(request: ChatRequest): string {
  return `${request.conversationId}:${request.mode}`;
}

export const runtimeMessageQueueState = {
  pending: 0,
  lastEnvelope: undefined as RuntimeEnvelope | undefined,
};
