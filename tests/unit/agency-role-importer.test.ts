import { describe, expect, it } from 'vitest';
import {
  canSpawnAgencyDraft,
  validateAgencyDraftPromotion,
  type AgencyDraftRoleEntry,
} from '../../openclaw_runtime/src/agents/agency-draft-catalog';
import { importAgencyDraftRoles } from '../../openclaw_runtime/src/agents/agency-role-importer';

describe('Agency draft role importer', () => {
  it('imports Agency-like agents as draft-only catalog entries', () => {
    const entries = importAgencyDraftRoles({
      divisions: [{
        name: 'Research',
        agents: [{
          name: 'Code Analyst',
          description: 'Analyze repository structure and report implementation risks.',
          tools: ['bash', 'write'],
          capabilities: ['analysis', 'code-review'],
          handoff: ['Send findings back to lead only.'],
        }],
      }],
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: 'agency:research:code-analyst',
      status: 'draft',
      source: 'agency',
      sourceDivision: 'Research',
      sourceAgentName: 'Code Analyst',
      roleName: 'code-analyst',
      displayName: 'Code Analyst',
      capabilityHints: ['analysis', 'code-review'],
      toolHints: ['bash', 'write'],
      handoffHints: ['Send findings back to lead only.'],
    });
    expect(canSpawnAgencyDraft(entries[0]!)).toBe(false);
    expect(entries[0]?.roleCandidate?.tools).toEqual([]);
    expect(entries[0]?.validationIssues).toEqual([]);
  });

  it('keeps incomplete Agency entries in draft with validation issues', () => {
    const entries = importAgencyDraftRoles({
      agents: [{ name: 'Unsafe Shell', tools: ['bash'] }],
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      status: 'draft',
      roleName: 'unsafe-shell',
      toolHints: ['bash'],
    });
    expect(entries[0]?.validationIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'rolePrompt' }),
      ]),
    );
    expect(canSpawnAgencyDraft(entries[0]!)).toBe(false);
  });

  it('requires RoleContract validation before promotion and never mutates draft status', () => {
    const incomplete = importAgencyDraftRoles({
      agents: [{ name: 'Short Prompt', description: 'tiny' }],
    })[0]!;

    const invalidPromotion = validateAgencyDraftPromotion(incomplete);

    expect(invalidPromotion.ok).toBe(false);
    expect(incomplete.status).toBe('draft');

    const reviewed: AgencyDraftRoleEntry = {
      ...importAgencyDraftRoles({
        agents: [{
          name: 'Release Reviewer',
          description: 'Review release readiness, verify acceptance evidence, and report blockers.',
          capabilities: ['review'],
          handoff: ['Return a readiness verdict to the lead.'],
        }],
      })[0]!,
      status: 'reviewed',
    };

    const validPromotion = validateAgencyDraftPromotion(reviewed);

    expect(validPromotion).toEqual({ ok: true, issues: [] });
    expect(reviewed.status).toBe('reviewed');
    expect(canSpawnAgencyDraft(reviewed)).toBe(false);
  });

  it('imports top-level Agency arrays and keeps imported tool requirements as hints only', () => {
    const entries = importAgencyDraftRoles([
      {
        name: 'Build Bot',
        description: 'Prepare build verification plans and report release blocking evidence.',
        toolRequirements: ['bash', 'write'],
      },
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: 'agency:build-bot',
      status: 'draft',
      sourceAgentName: 'Build Bot',
      roleName: 'build-bot',
      toolHints: ['bash', 'write'],
    });
    expect(entries[0]?.roleCandidate?.tools).toEqual([]);
    expect(entries[0]?.roleCandidate?.toolRequirements).toEqual([]);
  });

  it('does not allow reviewed or active draft catalog entries to spawn directly', () => {
    const entry = importAgencyDraftRoles({
      agents: [{
        name: 'Evidence Reviewer',
        description: 'Review evidence quality and report whether promotion criteria are satisfied.',
      }],
    })[0]!;

    expect(canSpawnAgencyDraft({ ...entry, status: 'reviewed' })).toBe(false);
    expect(canSpawnAgencyDraft({ ...entry, status: 'active' })).toBe(false);
  });
});
