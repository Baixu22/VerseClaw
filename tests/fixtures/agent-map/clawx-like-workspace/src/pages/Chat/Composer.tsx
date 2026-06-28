import { sendClawMessage, type ChatRequest } from "../../lib/host-api";
import type { ConversationId } from "../../../shared/types/chat";

export type ComposerProps = {
  conversationId: ConversationId;
  disabled?: boolean;
};

export function ChatComposer(props: ComposerProps) {
  async function handleSend(text: string) {
    const request: ChatRequest = {
      conversationId: props.conversationId,
      body: text.trim(),
      mode: "interactive",
    };
    await sendClawMessage(request);
  }

  return (
    <section data-conversation={props.conversationId}>
      <button
        type="button"
        disabled={props.disabled}
        onClick={() => void handleSend("hello from composer")}
      >
        Send
      </button>
    </section>
  );
}
