import { describe, expect, it } from 'vitest';
import { resolveInstructionPrecedence } from '@shared/instruction-precedence';

describe('instruction precedence', () => {
  it('orders AGENTS, project rules, skill and role with stable explain output', () => {
    const result = resolveInstructionPrecedence([
      { kind: 'agents', source: 'AGENTS.md', scope: 'workspace', trust: 'owner', content: 'Use host-api for all backend calls.' },
      { kind: 'project-rules', source: '.clawx/rules/a.md', scope: 'workspace', trust: 'owner', content: 'Do not edit generated files.' },
      { kind: 'skill', source: 'frontend', scope: 'context', trust: 'owner', content: 'Follow the frontend style guide.' },
      { kind: 'role', source: 'reviewer', scope: 'role', trust: 'owner', content: 'Report risks before completion.' },
    ]);

    expect(result.layers.map((layer) => layer.kind)).toEqual(['project-rules', 'agents', 'role', 'skill']);
    expect(result.explain[0]).toContain('project-rules source=.clawx/rules/a.md');
    expect(result.totalTokens).toBeGreaterThan(0);
  });

  it('reports conflicts and lets turn override win over every durable layer', () => {
    const result = resolveInstructionPrecedence([
      { kind: 'agents', source: 'AGENTS.md', scope: 'workspace', trust: 'owner', content: 'Keep the default transport policy unchanged.' },
      { kind: 'project-rules', source: '.clawx/rules/a.md', scope: 'workspace', trust: 'owner', content: 'Keep the default transport policy unchanged.' },
      { kind: 'turn-override', source: 'turn:1', scope: 'turn', trust: 'user', content: 'Keep the default transport policy unchanged.' },
    ]);

    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatchObject({
      line: 'Keep the default transport policy unchanged.',
      winner: 'turn-override',
    });
    expect(result.layers.find((layer) => layer.kind === 'agents')?.conflicts).toHaveLength(1);
    expect(result.layers.find((layer) => layer.kind === 'turn-override')?.conflicts).toHaveLength(1);
  });
});
