export interface ChatInput {
  channel: "desktop" | "mobile";
  text: string;
}

export type ChatResult = {
  messageId: string;
  queued: boolean;
};

export async function sendMessage(input: ChatInput): Promise<ChatResult> {
  return hostApi.post("/chat/send", input);
}

export const hostApi = {
  async post(path: string, body: ChatInput): Promise<ChatResult> {
    return {
      messageId: `${path}:${body.text.length}`,
      queued: true,
    };
  },
};
