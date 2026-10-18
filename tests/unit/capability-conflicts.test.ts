import { describe, expect, it } from 'vitest';
import { applyCapabilityConflictDiagnostics, type CapabilityPublicationEntry } from '../../openclaw_runtime/src/runtime-core/capability-publications';

function publication(overrides: Partial<CapabilityPublicationEntry> & Pick<CapabilityPublicationEntry, 'id' | 'sourceId'>): CapabilityPublicationEntry {
  return {
    kind: 'skill',
    name: overrides.sourceId,
    owner: { type: 'unknown' },
    scope: 'unknown',
    source: 'local',
    state: 'available',
    exposure: {},
    useModes: ['adminAction'],
    runtime: { status: 'configured', source: 'gateway' },
    reasons: [],
    diagnostics: [],
    ...overrides,
  };
}

describe('capability conflicts', () => {
  it('marks duplicate canonical capabilities and emits one conflict diagnostic per source', () => {
    const result = applyCapabilityConflictDiagnostics([
      publication({ id: 'skill:shared', sourceId: 'shared', source: 'local', name: 'Local Shared' }),
      publication({ id: 'workspace-skill:shared', sourceId: 'shared', source: 'workspace', name: 'Workspace Shared' }),
      publication({ id: 'skill:unique', sourceId: 'unique' }),
    ]);

    const shared = result.publications.filter((entry) => entry.sourceId === 'shared');
    expect(shared).toHaveLength(2);
    expect(shared[0].conflicts).toEqual(['workspace-skill:shared']);
    expect(shared[1].conflicts).toEqual(['skill:shared']);
    expect(result.publications.find((entry) => entry.sourceId === 'unique')?.conflicts).toBeUndefined();
    expect(result.diagnostics.filter((entry) => entry.code === 'capabilityConflict')).toHaveLength(2);
    expect(result.diagnostics[0].message).toContain('explicit source selection is required');
  });
});
