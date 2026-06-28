import { sendMessage, type ChatInput } from "../shared/host-api";

export function registerChatIpc() {
  return {
    channel: "chat:send",
    async handle(input: ChatInput) {
      return sendMessage(input);
    },
  };
}
