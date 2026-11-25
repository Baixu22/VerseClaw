// @vitest-environment node
import { expect, it, vi } from 'vitest';
const createGuard = vi.hoisted(() => vi.fn(() => null));
vi.mock('../../openclaw_runtime/src/agents/execution-task-guard', () => ({ createExecutionTaskGuard: createGuard }));
import { toToolDefinitions } from '../../openclaw_runtime/src/agents/agent-tool-definition-adapter';
import { wrapToolWithBeforeToolCallHook } from '../../openclaw_runtime/src/agents/agent-tools.before-tool-call';
import type { AnyAgentTool } from '../../openclaw_runtime/src/agents/agent-tools.types';

it('captures one authority snapshot for a raw tool set and reuses an explicit wrapped snapshot', () => {
  const tools = ['read', 'write', 'exec'].map(name => ({ name, label: name, description: name,
    parameters: { type: 'object', properties: {} }, execute: vi.fn(),
  })) as AnyAgentTool[];
  const context = { workspaceDir: '/fixture', sessionKey: 'session', sessionId: 'generation', runId: 'run' };
  toToolDefinitions(tools, context);
  expect(createGuard).toHaveBeenCalledTimes(1);
  createGuard.mockClear();
  const wrapped = tools.map(tool => wrapToolWithBeforeToolCallHook(tool, context, { taskGuard: null }));
  toToolDefinitions(wrapped, context);
  expect(createGuard).not.toHaveBeenCalled();
});
