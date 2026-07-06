import { describe, expect, it } from 'vitest';
import type { CapabilityPublicationEntry, CapabilityPublicationResult } from '@shared/host-api/contract';
import {
  addPublicationToIds,
  buildCapabilityRows,
  calculateCapabilityDraftDiff,
  capabilityPublicationAliases,
  filterCapabilityRows,
  removePublicationFromIds,
  sortCapabilityRows,
  splitCapabilityIdList,
  summarizeCapabilityDiagnostics,
} from '@/lib/capability-publication-view-model';

function publication(overrides: Partial<CapabilityPublicationEntry>): CapabilityPublicationEntry {
  return {
    id: `${overrides.kind ?? 'skill'}:${overrides.sourceId ?? 'demo'}`,
    kind: overrides.kind ?? 'skill',
    sourceId: overrides.sourceId ?? 'demo',
    name: overrides.name ?? overrides.sourceId ?? 'demo',
    owner: { type: 'agent', id: 'main' },
    scope: 'agent',
    source: 'local',
    state: 'available',
    exposure: { runtimeVisible: false },
    useModes: ['adminAction'],
    runtime: { status: 'cold', method: 'prompt', source: 'gateway' },
    reasons: ['test'],
    diagnostics: [],
    ...overrides,
  };
}

describe('capability publication view model', () => {
  it('normalizes ID text and removes publications by all aliases', () => {
    const entry = publication({
      id: 'skill:create-skill',
      sourceId: 'create-skill',
      name: 'Create Skill',
      skillId: 'create-skill',
    });

    expect(splitCapabilityIdList('create-skill\n\nCreate Skill, create-skill')).toEqual(['create-skill', 'Create Skill']);
    expect(capabilityPublicationAliases(entry)).toEqual(expect.arrayContaining(['skill:create-skill', 'create-skill', 'Create Skill']));
    expect(addPublicationToIds(['other'], entry)).toEqual(['other', 'create-skill']);
    expect(removePublicationFromIds(['skill:create-skill', 'other', 'Create Skill'], entry)).toEqual(['other']);
  });

  it('computes draft diff and row changes', () => {
    const rows = buildCapabilityRows({
      publications: [
        publication({ sourceId: 'alpha', skillId: 'alpha', state: 'published' }),
        publication({ kind: 'mcp', sourceId: 'filesystem', serverId: 'filesystem', state: 'available' }),
      ],
      baselineSkillIds: ['alpha'],
      draftSkillIds: [],
      baselineMcpServerIds: [],
      draftMcpServerIds: ['filesystem'],
    });

    expect(rows.find((row) => row.canonicalId === 'alpha')).toMatchObject({ selected: false, baselineSelected: true, change: 'remove' });
    expect(rows.find((row) => row.canonicalId === 'filesystem')).toMatchObject({ selected: true, baselineSelected: false, change: 'add' });
    expect(calculateCapabilityDraftDiff({
      baselineSkillIds: ['alpha'],
      draftSkillIds: [],
      baselineMcpServerIds: [],
      draftMcpServerIds: ['filesystem'],
    })).toMatchObject({
      skillRemoves: ['alpha'],
      mcpAdds: ['filesystem'],
      totalChanges: 2,
      changed: true,
    });
  });

  it('normalizes publication aliases when computing draft diff', () => {
    const entry = publication({
      id: 'skill:create-skill',
      sourceId: 'create-skill',
      name: 'Create Skill',
      skillId: 'create-skill',
    });

    expect(calculateCapabilityDraftDiff({
      publications: [entry],
      baselineSkillIds: ['skill:create-skill'],
      draftSkillIds: ['Create Skill'],
      baselineMcpServerIds: [],
      draftMcpServerIds: [],
    })).toMatchObject({
      skillAdds: [],
      skillRemoves: [],
      totalChanges: 0,
      changed: false,
    });
  });

  it('filters and sorts rows for management views', () => {
    const rows = sortCapabilityRows(buildCapabilityRows({
      publications: [
        publication({ sourceId: 'published-skill', state: 'published', skillId: 'published-skill' }),
        publication({
          kind: 'mcp',
          sourceId: 'blocked-mcp',
          serverId: 'blocked-mcp',
          state: 'blocked',
          diagnostics: [{ code: 'roleToolsFilter', severity: 'blocked', message: 'blocked by role' }],
        }),
        publication({ sourceId: 'draft-skill', name: 'Draft Skill', skillId: 'draft-skill' }),
      ],
      baselineSkillIds: ['published-skill'],
      draftSkillIds: ['published-skill', 'draft-skill'],
      baselineMcpServerIds: [],
      draftMcpServerIds: [],
    }));

    expect(rows[0]?.canonicalId).toBe('draft-skill');
    expect(filterCapabilityRows(rows, { onlyChanged: true }).map((row) => row.canonicalId)).toEqual(['draft-skill']);
    expect(filterCapabilityRows(rows, { kind: 'mcp', onlyDiagnostics: true }).map((row) => row.canonicalId)).toEqual(['blocked-mcp']);
    expect(filterCapabilityRows(rows, { query: 'draft' }).map((row) => row.canonicalId)).toEqual(['draft-skill']);
  });

  it('summarizes result and publication diagnostics together', () => {
    const result: CapabilityPublicationResult = {
      success: true,
      source: 'gateway',
      generatedAt: '2026-01-01T00:00:00.000Z',
      diagnostics: [{ code: 'runtimeSlow', severity: 'warning', message: 'slow' }],
      publications: [
        publication({ diagnostics: [{ code: 'legacyGlobal', severity: 'info', message: 'legacy' }] }),
        publication({ diagnostics: [{ code: 'blocked', severity: 'blocked', message: 'blocked' }] }),
      ],
    };

    expect(summarizeCapabilityDiagnostics(result)).toEqual({
      info: 1,
      warnings: 1,
      blocked: 1,
      total: 3,
    });
  });
});
