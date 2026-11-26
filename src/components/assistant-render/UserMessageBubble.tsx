export function UserMessageBubble({
  text,
}: {
  text: string;
}) {
  return (
    <div
      className="chat-user-message-card relative min-w-0 overflow-hidden text-left transition-colors duration-150"
      data-testid="chat-user-message-bubble"
    >
      <p className="reading-text whitespace-pre-wrap break-words font-[445]">{text}</p>
    </div>
  );
}
