import { parseToolUiContent, parseToolUiToolUses, type ToolUiInteraction } from '@/components/tool-ui/agent-interactions';
import type { RawMessage } from '@/stores/chat/types';
import { extractText, extractToolUse } from './message-utils';
import { MESSAGE_CARD_EXCLUDED_TOOL_UI_TYPES } from './run-surface-promotion';

export function isComposerInteraction(interaction: ToolUiInteraction): boolean {
  return (['question-flow', 'option-list', 'preferences-panel', 'approval-card'].includes(interaction.type)
      || (interaction.type === 'plan' && interaction.requiresApproval === true))
    && (!('choice' in interaction) || interaction.choice == null);
}

/** A response retires its request; later requests and other sessions retain their own state. */
export function collectComposerInteractions(messages: RawMessage[], unsettledResponse?: string): ToolUiInteraction[] {
  const pending = new Map<string, ToolUiInteraction>();
  for (const message of messages) {
    const text = extractText(message);
    if (message.role === 'user') {
      if (text === unsettledResponse) continue;
      if (!text.startsWith('Tool UI response:\n')) continue;
      try {
        const response = JSON.parse(text.slice('Tool UI response:\n'.length)) as { type?: string; id?: string };
        if (response.type && response.id) pending.delete(`${response.type}:${response.id}`);
      } catch { /* An ordinary user message cannot resolve a request. */ }
      continue;
    }
    if (message.role !== 'assistant') continue;
    for (const interaction of [
      ...parseToolUiContent(text, { streaming: true }).interactions,
      ...parseToolUiToolUses(extractToolUse(message)).filter((item) => !MESSAGE_CARD_EXCLUDED_TOOL_UI_TYPES.has(item.type)),
    ]) {
      const key = `${interaction.type}:${interaction.id}`;
      if (isComposerInteraction(interaction)) pending.set(key, interaction);
      else pending.delete(key);
    }
  }
  return [...pending.values()];
}
