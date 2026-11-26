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
      <p className="whitespace-pre-wrap break-words text-[14px] font-[445] leading-[22px]">{text}</p>
    </div>
  );
}
