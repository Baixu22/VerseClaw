import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import {
  canSpawnAgencyDraft,
  reviewAgencyDraftPromotion,
  validateAgencyDraftPromotion,
} from '../../openclaw_runtime/src/agents/agency-draft-catalog';
import {
  importAgencyDraftRoles,
  importAgencyDraftRolesFromRepository,
  parseAgencyAgentMarkdown,
} from '../../openclaw_runtime/src/agents/agency-role-importer';

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

    const reviewed = importAgencyDraftRoles({
      agents: [{
        name: 'Release Reviewer',
        description: 'Review release readiness, verify acceptance evidence, and report blockers.',
        capabilities: ['review'],
        handoff: ['Return a readiness verdict to the lead.'],
      }],
    })[0]!;

    const validPromotion = validateAgencyDraftPromotion(reviewed);

    expect(validPromotion).toEqual({ ok: true, issues: [] });
    expect(reviewed.status).toBe('draft');
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

  it('keeps draft catalog entries permanently non-runnable', () => {
    const entry = importAgencyDraftRoles({
      agents: [{
        name: 'Evidence Reviewer',
        description: 'Review evidence quality and report whether promotion criteria are satisfied.',
      }],
    })[0]!;

    expect(entry.status).toBe('draft');
    expect(canSpawnAgencyDraft(entry)).toBe(false);
  });

  it('creates a promotion review record without activating Agency drafts', () => {
    const [draft] = importAgencyDraftRoles({
      divisions: [{
        id: 'engineering',
        agents: [{
          id: 'reviewer',
          name: 'Reviewer',
          description: 'Review implementation evidence and report blockers.',
        }],
      }],
    });

    const reviewed = {
      ...draft!,
      roleCandidate: {
        name: 'agency-reviewer-candidate',
        displayName: 'Agency Reviewer Candidate',
        description: 'Review implementation evidence and report blockers.',
        rolePrompt: 'Review implementation evidence and report blockers.',
        tools: ['read'],
        capabilities: [],
        toolRequirements: [],
        effort: 'medium',
        model: { default: null, fallback: [] },
        outputSchema: { format: 'markdown', sections: ['findings', 'evidence'] },
        handoff: { to: [], from: [], requiresReview: true },
        permissions: { filesystem: 'read', network: 'none', commands: [] },
      },
    };

    const review = reviewAgencyDraftPromotion(reviewed, {
      reviewer: 'operator',
      reviewedAt: '2026-07-08T00:00:00.000Z',
    });

    expect(review).toMatchObject({
      draftId: reviewed.id,
      approvedForRuntime: false,
      validation: { ok: true },
    });
    expect(canSpawnAgencyDraft(reviewed)).toBe(false);
  });

  it('parses real Agency markdown frontmatter into draft-only metadata', () => {
    const parsed = parseAgencyAgentMarkdown('engineering/engineering-code-reviewer.md', `---
name: Code Reviewer
description: Expert code reviewer who provides constructive, actionable feedback focused on correctness, maintainability, security, and performance.
color: purple
emoji: review
---

# Code Reviewer Agent

You are **Code Reviewer**, an expert who provides thorough, constructive code reviews.
`);

    const entries = importAgencyDraftRoles({
      divisions: [{
        name: parsed.division,
        agents: [parsed.agent],
      }],
    });

    expect(entries[0]).toMatchObject({
      id: 'agency:engineering:engineering-code-reviewer',
      status: 'draft',
      sourceDivision: 'engineering',
      sourceAgentName: 'Code Reviewer',
      roleName: 'engineering-code-reviewer',
      description: 'Expert code reviewer who provides constructive, actionable feedback focused on correctness, maintainability, security, and performance.',
    });
    expect(entries[0]?.roleCandidate?.tools).toEqual([]);
    expect(canSpawnAgencyDraft(entries[0]!)).toBe(false);
  });

  const agencyRepo = process.env.AGENCY_AGENTS_REPO
    ? resolve(process.env.AGENCY_AGENTS_REPO)
    : resolve('C:/Users/27933/Desktop/verseshell/agency-agents-main');

  it.skipIf(!existsSync(resolve(agencyRepo, 'divisions.json')))(
    'imports the real local agency-agents-main repository as draft catalog entries without runtime authorization',
    () => {
      const catalog = importAgencyDraftRolesFromRepository(agencyRepo);

      expect(catalog.entries).toHaveLength(235);
      expect(catalog.divisions).toMatchObject({
        engineering: expect.objectContaining({ label: 'Engineering' }),
        testing: expect.objectContaining({ label: 'Testing' }),
      });
      expect(catalog.tools).toMatchObject({
        openclaw: expect.objectContaining({ label: 'OpenClaw', format: 'openclaw-workspace' }),
      });
      expect(catalog.runbooks.map((runbook) => runbook.slug)).toEqual(
        expect.arrayContaining(['startup-mvp', 'enterprise-feature', 'incident-response']),
      );

      const codeReviewer = catalog.entries.find((entry) => entry.id === 'agency:engineering:engineering-code-reviewer');
      expect(codeReviewer).toMatchObject({
        status: 'draft',
        sourceDivision: 'engineering',
        sourceAgentName: 'Code Reviewer',
        roleName: 'engineering-code-reviewer',
        sourceRef: {
          relativePath: 'engineering/engineering-code-reviewer.md',
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
      });
      expect(codeReviewer?.roleCandidate?.tools).toEqual([]);
      expect(codeReviewer?.roleCandidate?.toolRequirements).toEqual([]);
      expect(codeReviewer && canSpawnAgencyDraft(codeReviewer)).toBe(false);

      const realityChecker = catalog.entries.find((entry) => entry.id === 'agency:testing:testing-reality-checker');
      expect(realityChecker).toMatchObject({
        status: 'draft',
        sourceDivision: 'testing',
        sourceAgentName: 'Reality Checker',
        roleName: 'testing-reality-checker',
      });
      expect(realityChecker?.roleCandidate?.tools).toEqual([]);

      const nestedUnrealAgent = catalog.entries.find((entry) => entry.id === 'agency:game-development:unreal-world-builder');
      expect(nestedUnrealAgent).toMatchObject({
        status: 'draft',
        sourceDivision: 'game-development',
        roleName: 'unreal-world-builder',
        sourceRef: {
          relativePath: 'game-development/unreal-engine/unreal-world-builder.md',
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
      });
      expect(nestedUnrealAgent?.roleCandidate?.tools).toEqual([]);
    },
  );
});
