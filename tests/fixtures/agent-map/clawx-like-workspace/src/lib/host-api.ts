import type { ChatRequest, ChatResponse } from "../../shared/types/chat";

export type HostApiRoute = "chat:send" | "runtime:dispatch";

export async function sendClawMessage(
  request: ChatRequest,
): Promise<ChatResponse> {
  return windowHostApi.invoke("chat:send", request);
}

export const windowHostApi = {
  async invoke(route: HostApiRoute, payload: ChatRequest): Promise<ChatResponse> {
    return {
      id: payload.conversationId,
      accepted: route === "chat:send" && payload.body.length > 0,
    };
  },
};
