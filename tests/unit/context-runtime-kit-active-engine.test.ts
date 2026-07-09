import { describe, expect, it } from 'vitest';
import type { AgentMessage } from '../../openclaw_runtime/src/agents/runtime';
import { createContextRuntimeKitContextEngine } from '../../openclaw_runtime/src/context-engine/cvk/engine';

describe('Context Runtime Kit active context engine', () => {
  const assembleParams = {
    sessionId: 'session-crk-active',
    messages: [
      { role: 'user', content: 'Use the shell only after schema selectors are visible.' },
    ] as AgentMessage[],
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
      content: `RAW-LARGE-CONTEXT-${'x'.repeat(6_000)}`,
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
  };

  it('preserves messages and returns bounded selector-backed prompt diagnostics', async () => {
    const engine = createContextRuntimeKitContextEngine({ maxPromptAdditionChars: 2_000 });

    const result = await engine.assemble(assembleParams);

    expect(result.messages).toBe(assembleParams.messages);
    expect(result.estimatedTokens).toBeGreaterThan(0);
    expect(result.systemPromptAddition).toContain('Context Runtime Kit');
    expect(result.systemPromptAddition).toContain('toolset:runtime-tools@active');
    expect(result.systemPromptAddition).toContain('schema:tool.run_shell.required');
    expect(result.systemPromptAddition).toContain('schema:tool.run_shell.field.command.type');
    expect(result.systemPromptAddition).toContain('tool gate mode: report_only');
    expect(result.systemPromptAddition).not.toContain(assembleParams.projectContextFiles[0]!.content);
    expect(result.systemPromptAddition!.length).toBeLessThanOrEqual(2_000);
  });

  it('keeps exact prompt parity when Context Status is disabled', async () => {
    const baseline = createContextRuntimeKitContextEngine({ maxPromptAdditionChars: 2_000 });
    const disabled = createContextRuntimeKitContextEngine({
      maxPromptAdditionChars: 2_000,
      contextStatusEnabled: false,
    });

    const baselineResult = await baseline.assemble(assembleParams);
    const disabledResult = await disabled.assemble(assembleParams);

    expect(disabledResult.systemPromptAddition).toBe(baselineResult.systemPromptAddition);
  });

  it('injects bounded Context Status when explicitly enabled', async () => {
    const engine = createContextRuntimeKitContextEngine({
      maxPromptAdditionChars: 2_400,
      contextStatusEnabled: true,
      contextStatusSnapshot: {
        schemaVersion: 1,
        totalItems: 4,
        countsByKind: { observation: 2, derived: 1, ledger: 1 },
        countsByLifecycleState: { active: 1, archived: 2, compacted: 1 },
        archiveAvailable: true,
        recoveryAvailable: false,
        warnings: ['recall surface disabled in Slice 6', 'x'.repeat(1_000)],
      },
    });

    const result = await engine.assemble(assembleParams);

    expect(result.systemPromptAddition).toContain('[Context Status]');
    expect(result.systemPromptAddition).toContain('pressure: tokenBudget=4000');
    expect(result.systemPromptAddition).toContain('lifecycle: active=1 archived=2 compacted=1');
    expect(result.systemPromptAddition).toContain('kinds: derived=1 ledger=1 observation=2');
    expect(result.systemPromptAddition).toContain('archive: available=true recovery=false');
    expect(result.systemPromptAddition).toContain('recall surface disabled in Slice 6');
    expect(result.systemPromptAddition).not.toContain(assembleParams.projectContextFiles[0]!.content);
    expect(result.systemPromptAddition).not.toContain('x'.repeat(500));
    expect(result.systemPromptAddition!.length).toBeLessThanOrEqual(2_400);
  });
});
