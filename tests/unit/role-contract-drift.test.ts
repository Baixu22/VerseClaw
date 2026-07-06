// Type-drift guard (Area 1 §3.2 / §8):
// Asserts the shared and runtime `RoleContract` declarations have the same
// key set. Catches future drift mechanically — if someone adds a field to
// one side but not the other, this test fails.
//
// The runtime declaration (role-contract.ts) is authoritative (it has the
// validator). The shared declaration (shared/types/agent.ts) must mirror it.
import { describe, expect, it } from 'vitest';
import { normalizeRoleContract, getBuiltInRoleContract } from '../../openclaw_runtime/src/agents/role-contract';
import type { RoleContract as SharedRoleContract } from '@shared/types/agent';

describe('RoleContract type drift guard (Area 1)', () => {
  it('shared and runtime RoleContract have the same key set', () => {
    // Fully-populated runtime RoleContract via the normalizer (exercises every
    // field the runtime knows about, including optional ones set to a value).
    const runtimeRole = normalizeRoleContract({
      name: 'drift-test',
      display_name: 'Drift Test',
      description: 'Guard test.',
      role_prompt: 'This is a test role prompt for drift guard.',
      tools: ['read'],
      capabilities: ['task-analysis'],
      tool_requirements: ['read'],
      risk_profile: 'medium',
      can_modify_scope: true,
      permissions: { filesystem: 'read', network: 'none', commands: [] },
      model: { default: null },
      effort: 'medium',
      output_schema: { format: 'markdown' },
      handoff: { to: [], from: [] },
      version: '1.0.0',
      tags: ['test'],
      routing_keywords: ['alpha'],
      profile: { displayName: 'Test' },
    });

    // Fully-populated shared RoleContract (manually constructed to match the
    // shared interface). If the shared type is missing a field the runtime
    // has, TypeScript will error here at compile time; the runtime key
    // comparison below catches the reverse direction.
    const sharedRole: SharedRoleContract = {
      name: 'drift-test',
      displayName: 'Drift Test',
      description: 'Guard test.',
      rolePrompt: 'This is a test role prompt for drift guard.',
      tools: ['read'],
      capabilities: ['task-analysis'],
      toolRequirements: ['read'],
      riskProfile: 'medium',
      canModifyScope: true,
      permissions: { filesystem: 'read', network: 'none', commands: [] },
      model: { default: null },
      effort: 'medium',
      outputSchema: { format: 'markdown' },
      handoff: { to: [], from: [] },
      version: '1.0.0',
      tags: ['test'],
      routingKeywords: ['alpha'],
      profile: { displayName: 'Test' },
    };

    const runtimeKeys = Object.keys(runtimeRole).sort();
    const sharedKeys = Object.keys(sharedRole).sort();

    expect(runtimeKeys).toEqual(sharedKeys);
  });

  it('built-in role contracts include the unified fields', () => {
    // Sanity: at least one built-in should have capabilities/riskProfile/canModifyScope
    // populated (they were runtime-only before Area 1 reunified them into shared).
    const reviewer = getBuiltInRoleContract('reviewer');
    expect(reviewer).toBeDefined();
    expect(reviewer.capabilities).toContain('review');
    expect(reviewer.riskProfile).toBeDefined();
    expect(reviewer.canModifyScope).toBeDefined();
  });
});
