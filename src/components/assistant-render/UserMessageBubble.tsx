import { AssistantMarkdown } from './AssistantMarkdown';

export function UserMessageBubble({ text, allowSidePreview = false }: { text: string; allowSidePreview?: boolean }) {
  return (
    <div
      className="chat-user-message-card relative min-w-0 max-w-full overflow-hidden text-left transition-colors duration-150"
      data-testid="chat-user-message-bubble"
    >
      <AssistantMarkdown text={text} isStreaming={false} allowSidePreview={allowSidePreview} />
    </div>
  );
}
