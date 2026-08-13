import { describe, expect, it } from 'vitest';
import { parseToolUiToolUses, parseToolUiContent } from '@/components/tool-ui/agent-interactions';

/**
 * The runtime's `update_plan` tool (openclaw_runtime/src/agents/tools/
 * update-plan-tool.ts) emits `{ explanation, plan: [{ step, status }] }`. That
 * shape used to match none of the Tool UI aliases and none of the shape
 * fallbacks, so a plan update always degraded to a raw JSON row in the
 * execution graph.
 */
describe('update_plan → plan interaction', () => {
  const args = {
    explanation: 'three steps',
    plan: [
      { step: 'audit', status: 'completed' },
      { step: 'wire', status: 'in_progress' },
      { step: 'verify', status: 'pending' },
    ],
  };

  it('parses the runtime tool call by name', () => {
    const [interaction] = parseToolUiToolUses([{ id: 'call-1', name: 'update_plan', input: args }]);

    expect(interaction).toMatchObject({ type: 'plan', id: 'call-1', description: 'three steps' });
    expect(interaction.type === 'plan' && interaction.todos).toEqual([
      { id: 'todo-1', label: 'audit', status: 'completed', description: undefined },
      { id: 'todo-2', label: 'wire', status: 'in_progress', description: undefined },
      { id: 'todo-3', label: 'verify', status: 'pending', description: undefined },
    ]);
  });

  it('parses TodoWrite under the same alias set', () => {
    const [interaction] = parseToolUiToolUses([{ id: 'call-2', name: 'TodoWrite', input: args }]);
    expect(interaction?.type).toBe('plan');
  });

  it('falls back on payload shape when the tool name is unknown', () => {
    const [interaction] = parseToolUiToolUses([{ id: 'call-3', name: 'plan', input: args }]);
    expect(interaction?.type).toBe('plan');
  });

  it('still requires a title for model-authored fenced plans to stay unchanged', () => {
    const { interactions } = parseToolUiContent([
      '```tool-ui',
      JSON.stringify({ type: 'plan', id: 'fenced', title: 'Ship it', todos: [{ id: 't1', label: 'go', status: 'pending' }] }),
      '```',
    ].join('\n'));

    expect(interactions[0]).toMatchObject({ type: 'plan', title: 'Ship it' });
  });
});
