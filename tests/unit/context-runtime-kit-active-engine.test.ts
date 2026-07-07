import { describe, expect, it } from 'vitest';
import type { AgentMessage } from '../../openclaw_runtime/src/agents/runtime';
import { createContextRuntimeKitContextEngine } from '../../openclaw_runtime/src/context-engine/cvk/engine';

describe('Context Runtime Kit active context engine', () => {
  it('preserves messages and returns bounded selector-backed prompt diagnostics', async () => {
    const messages = [
      { role: 'user', content: 'Use the shell only after schema selectors are visible.' },
    ] as AgentMessage[];
    const largeRawContext = `RAW-LARGE-CONTEXT-${'x'.repeat(6_000)}`;
    const engine = createContextRuntimeKitContextEngine({ maxPromptAdditionChars: 2_000 });

    const result = await engine.assemble({
      sessionId: 'session-crk-active',
      messages,
      tokenBudget: 4_000,
      prompt: 'run shell safely',
      activeTools: [
        {
          name: 'run_shell',
          description: 'Run a shell command.',
          parameters: {
            type: 'object',
            required: ['command'],
            properties: {
              command: { type: 'string', description: 'Command to run.' },
              cwd: { type: ['string', 'null'], default: null },
            },
          },
          permissions: ['filesystem.read'],
          sideEffects: ['executes local process'],
        },
      ],
      projectContextFiles: [{
        path: 'AGENTS.md',
        content: largeRawContext,
      }],
      skillsMetadata: [{
        id: 'test-driven-development',
        title: 'Test Driven Development',
        summary: 'Write the failing test before implementation.',
        triggers: ['feature', 'bugfix'],
        requiredWorkflow: ['red', 'green', 'refactor'],
        safetyRules: ['No production code before RED.'],
        examples: [],
        source: 'Use TDD for behavior changes.',
      }],
    });

    expect(result.messages).toBe(messages);
    expect(result.estimatedTokens).toBeGreaterThan(0);
    expect(result.systemPromptAddition).toContain('Context Runtime Kit');
    expect(result.systemPromptAddition).toContain('toolset:runtime-tools@active');
    expect(result.systemPromptAddition).toContain('schema:tool.run_shell.required');
    expect(result.systemPromptAddition).toContain('schema:tool.run_shell.field.command.type');
    expect(result.systemPromptAddition).toContain('tool gate mode: report_only');
    expect(result.systemPromptAddition).not.toContain(largeRawContext);
    expect(result.systemPromptAddition!.length).toBeLessThanOrEqual(2_000);
  });
});
