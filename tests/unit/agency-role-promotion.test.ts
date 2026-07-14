import { describe, expect, it } from 'vitest';
import { importAgencyDraftRoles } from '../../openclaw_runtime/src/agents/agency-role-importer';
import { canSpawnAgencyDraft } from '../../openclaw_runtime/src/agents/agency-draft-catalog';
import {
  fingerprintRoleContract,
  materializeAgencyRoleContract,
  suggestAgencyToolMappings,
  validateAgencyPromotionCandidate,
  type AgencyPromotionCandidate,
} from '../../openclaw_runtime/src/agents/agency-role-promotion';

function makeDraft() {
  return importAgencyDraftRoles({
    divisions: [{
      name: 'Engineering',
      agents: [{
        name: 'Code Reviewer',
        description: 'Review implementation correctness and report actionable evidence.',
        tools: ['read', 'search'],
        capabilities: ['review'],
      }],
    }],
  })[0]!;
}

function makeCandidate(
  overrides: Partial<AgencyPromotionCandidate> = {},
): AgencyPromotionCandidate {
  const draft = makeDraft();
  return {
    contract: {
      ...draft.roleCandidate!,
      name: 'agency-code-reviewer',
      tools: ['untrusted-source-tool'],
      permissions: { filesystem: 'read', network: 'none', commands: [] },
    },
    toolHintDispositions: [
      {
        hint: 'read',
        disposition: 'mapped',
        selectedTools: ['read'],
        reviewerNote: 'Required for source inspection.',
      },
      {
        hint: 'search',
        disposition: 'waived',
        selectedTools: [],
        reviewerNote: 'Search is not required for the first release.',
      },
    ],
    evidenceQualification: 'unverified',
    evidenceRefs: [],
    ...overrides,
  };
}

describe('Agency role promotion domain', () => {
  it('offers conservative mapping suggestions without selecting tools', () => {
    const draft = makeDraft();

    expect(suggestAgencyToolMappings(draft)).toEqual([
      { hint: 'read', candidateTools: ['read'] },
      { hint: 'search', candidateTools: ['glob', 'grep'] },
    ]);
    expect(draft.roleCandidate?.tools).toEqual([]);
  });

  it('requires exactly one disposition for every source tool hint', () => {
    const draft = makeDraft();
    const missing = makeCandidate({
      toolHintDispositions: makeCandidate().toolHintDispositions.slice(0, 1),
    });
    const duplicate = makeCandidate({
      toolHintDispositions: [
        ...makeCandidate().toolHintDispositions,
        {
          hint: 'read',
          disposition: 'waived',
          selectedTools: [],
          reviewerNote: 'Duplicate.',
        },
      ],
    });

    expect(validateAgencyPromotionCandidate(draft, missing)).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([expect.objectContaining({ path: 'toolHintDispositions.search' })]),
    });
    expect(validateAgencyPromotionCandidate(draft, duplicate)).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([expect.objectContaining({ path: 'toolHintDispositions.read' })]),
    });
  });

  it('validates mapped and waived dispositions', () => {
    const draft = makeDraft();
    const invalid = makeCandidate({
      toolHintDispositions: [
        { hint: 'read', disposition: 'mapped', selectedTools: [], reviewerNote: '' },
        { hint: 'search', disposition: 'waived', selectedTools: ['grep'], reviewerNote: '' },
      ],
    });

    expect(validateAgencyPromotionCandidate(draft, invalid)).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ path: 'toolHintDispositions.read.selectedTools' }),
        expect.objectContaining({ path: 'toolHintDispositions.search.selectedTools' }),
        expect.objectContaining({ path: 'toolHintDispositions.search.reviewerNote' }),
      ]),
    });
  });

  it('rejects invalid selected tool identifiers and qualified evidence without refs', () => {
    const draft = makeDraft();
    const invalid = makeCandidate({
      toolHintDispositions: [
        { hint: 'read', disposition: 'mapped', selectedTools: ['bad tool'], reviewerNote: '' },
        { hint: 'search', disposition: 'waived', selectedTools: [], reviewerNote: 'Not needed.' },
      ],
      evidenceQualification: 'scenario-verified',
      evidenceRefs: [],
    });

    expect(validateAgencyPromotionCandidate(draft, invalid)).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ path: 'toolHintDispositions.read.selectedTools' }),
        expect.objectContaining({ path: 'evidenceRefs' }),
      ]),
    });
  });

  it('materializes only explicitly mapped tools and never derives authority', () => {
    const draft = makeDraft();
    const candidate = makeCandidate({
      evidenceQualification: 'release-qualified',
      evidenceRefs: ['artifact://role-eval/code-reviewer'],
      contract: {
        ...makeCandidate().contract,
        tools: ['bash', 'write'],
        permissions: { filesystem: 'read', network: 'none', commands: [] },
      },
    });

    const role = materializeAgencyRoleContract(draft, candidate);

    expect(role).not.toBe(draft.roleCandidate);
    expect(role.tools).toEqual(['read']);
    expect(role.permissions).toEqual({
      filesystem: 'read',
      network: 'none',
      commands: [],
      readPaths: [],
      writePaths: [],
    });
    expect(role.tags).toEqual(expect.arrayContaining(['agency-source', 'agency-source:engineering']));
    expect(role).not.toHaveProperty('lifecycle');
    expect(role).not.toHaveProperty('evidenceQualification');
    expect(canSpawnAgencyDraft(draft)).toBe(false);
  });

  it('rejects invalid candidate contracts before materialization', () => {
    const draft = makeDraft();
    const candidate = makeCandidate({
      contract: { ...makeCandidate().contract, name: 'Bad Name', rolePrompt: 'short' },
    });

    expect(validateAgencyPromotionCandidate(draft, candidate)).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ path: 'contract.name' }),
        expect.objectContaining({ path: 'contract.rolePrompt' }),
      ]),
    });
    expect(() => materializeAgencyRoleContract(draft, candidate)).toThrow('contract.name');
  });

  it('fingerprints normalized contracts deterministically across key insertion order', () => {
    const role = materializeAgencyRoleContract(makeDraft(), makeCandidate());
    const reordered = {
      tags: role.tags,
      handoff: role.handoff,
      outputSchema: role.outputSchema,
      effort: role.effort,
      model: role.model,
      permissions: role.permissions,
      tools: role.tools,
      rolePrompt: role.rolePrompt,
      description: role.description,
      displayName: role.displayName,
      name: role.name,
      capabilities: role.capabilities,
      toolRequirements: role.toolRequirements,
      riskProfile: role.riskProfile,
      canModifyScope: role.canModifyScope,
    };

    expect(fingerprintRoleContract(role)).toMatch(/^[a-f0-9]{64}$/);
    expect(fingerprintRoleContract(reordered)).toBe(fingerprintRoleContract(role));
  });
});
