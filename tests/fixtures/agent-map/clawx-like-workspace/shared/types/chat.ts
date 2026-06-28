export type ConversationId = string;

export interface ChatRequest {
  conversationId: ConversationId;
  body: string;
  mode: "interactive" | "background";
}

export type ChatResponse = {
  id: ConversationId;
  accepted: boolean;
};

export interface RuntimeEnvelope {
  conversationId: ConversationId;
  payload: string;
  source: "composer" | "ipc";
}
