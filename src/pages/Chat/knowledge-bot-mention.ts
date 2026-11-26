/** A leading mention is an explicit recipient, including a status-only mention. */
export function knowledgeBotQuestion(text: string): string | null {
  const match = /^\s*@(?:知识库(?:助手|机器人|bot)?|knowledge(?:-?bot)?|kb)(?=\s|[:：,，]|$)[\s:：,，]*/i.exec(text);
  return match ? text.slice(match[0].length).trim() : null;
}
