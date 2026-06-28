import { sendMessage, type ChatInput } from "../shared/host-api";
import { useDraftMessage } from "./useDraftMessage";

export function Composer() {
  const { draft, resetDraft, setDraft } = useDraftMessage();

  async function handleSend() {
    const input: ChatInput = { channel: "desktop", text: draft };
    await sendMessage(input);
    await sendMessage({ ...input, text: draft.trim() });
    resetDraft();
  }

  return (
    <form onSubmit={handleSend}>
      <textarea value={draft} onChange={(event) => setDraft(event.currentTarget.value)} />
      <button type="submit">Send</button>
    </form>
  );
}
