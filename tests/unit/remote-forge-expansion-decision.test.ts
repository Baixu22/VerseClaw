import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

type EvidenceDimension = {
  status?: string;
  level?: string;
  facts: string[];
  sources: string[];
};

type ReviewTrigger = {
  id: string;
  condition: string;
  evidenceRequired: string;
};

type Verdict = {
  surface: string;
  verdict: 'continue' | 'shrink' | 'stop';
  retainedScope: string;
  rationale: string;
  evidence: Record<string, EvidenceDimension>;
  reviewTriggers: ReviewTrigger[];
  securityConstraints?: Record<string, boolean>;
  requiredSemantics?: Record<string, boolean>;
  readOnlyBoundary?: {
    statusOnly: boolean;
    unknownOrStaleFailsClosed: boolean;
    forbiddenMutations: string[];
  };
};

type ExpansionDecision = {
  schema: string;
  taskId: string;
  authority: string;
  scope: {
    codeChanges: string;
    implementationAuthorized: boolean;
    taskForestProposalRequiredBeforeImplementation: boolean;
    taskForestProposalCreated: boolean;
    remoteEffects: boolean;
  };
  evidenceLimits: Record<string, unknown>;
  verdicts: Verdict[];
  frozenBoundaries: {
    liveReady: boolean;
    productApproved: boolean;
    defaultOn: boolean;
    agentMerge: string;
  };
  docsReview: {
    readmeChanged: boolean;
    reason: string;
  };
};

const root = process.cwd();
const decisionPath = join(root, 'artifacts/first-product-preview/FP-P4-08/decision.json');
const decision = JSON.parse(readFileSync(decisionPath, 'utf8')) as ExpansionDecision;
const verdictBySurface = new Map(decision.verdicts.map((item) => [item.surface, item]));

describe('FP-P4-08 Remote Forge expansion decision', () => {
  it('contains exactly four independently locked verdicts', () => {
    expect(decision.schema).toBe('first-product-preview/fp-p4-08-expansion-decision/v1');
    expect(decision.taskId).toBe('FP-P4-08');
    expect(decision.authority).toBe('engineering-validation-only');
    expect([...verdictBySurface.keys()].sort()).toEqual([
      'gitee',
      'gitlab',
      'merge-queue-train',
      'stacked-pr-dependency-dag',
    ]);
    expect(verdictBySurface.get('gitlab')?.verdict).toBe('shrink');
    expect(verdictBySurface.get('gitee')?.verdict).toBe('stop');
    expect(verdictBySurface.get('stacked-pr-dependency-dag')?.verdict).toBe('shrink');
    expect(verdictBySurface.get('merge-queue-train')?.verdict).toBe('shrink');
    expect(decision.verdicts.some((item) => item.verdict === 'continue')).toBe(false);
  });

  it('grounds every verdict in the same five evidence dimensions and objective review triggers', () => {
    const requiredDimensions = ['apiFit', 'demand', 'maintenanceCost', 'permissionModel', 'securityBoundary'];

    for (const verdict of decision.verdicts) {
      expect(verdict.retainedScope.length).toBeGreaterThan(20);
      expect(verdict.rationale.length).toBeGreaterThan(40);
      expect(Object.keys(verdict.evidence).sort()).toEqual(requiredDimensions);

      for (const dimension of Object.values(verdict.evidence)) {
        expect(dimension.status ?? dimension.level).toBeTruthy();
        expect(dimension.facts.length).toBeGreaterThan(0);
        expect(dimension.sources.length).toBeGreaterThan(0);
        for (const source of dimension.sources) {
          expect(source).toMatch(/^(artifacts|docs|harness)\//u);
        }
      }

      expect(verdict.reviewTriggers.length).toBeGreaterThan(0);
      for (const trigger of verdict.reviewTriggers) {
        expect(trigger.id).toMatch(/^[a-z0-9-]+$/u);
        expect(trigger.condition.length).toBeGreaterThan(30);
        expect(trigger.evidenceRequired.length).toBeGreaterThan(30);
      }
    }
  });

  it('keeps implementation, remote effects, and product locks closed', () => {
    expect(decision.scope).toEqual({
      codeChanges: 'none',
      implementationAuthorized: false,
      taskForestProposalRequiredBeforeImplementation: true,
      taskForestProposalCreated: false,
      remoteEffects: false,
    });
    expect(decision.frozenBoundaries).toEqual({
      liveReady: false,
      productApproved: false,
      defaultOn: false,
      agentMerge: 'off',
    });
    expect(decision.docsReview.readmeChanged).toBe(false);
    expect(decision.docsReview.reason).toContain('no product behavior');
  });

  it('makes the Gitee query-token veto explicit', () => {
    expect(verdictBySurface.get('gitee')?.securityConstraints).toEqual({
      queryTokenInGenericUrl: false,
      queryTokenInLogs: false,
      queryTokenInTraces: false,
      queryTokenInErrors: false,
      queryTokenInSupportBundles: false,
    });
  });

  it('preserves fail-closed DAG semantics without branch authority', () => {
    expect(verdictBySurface.get('stacked-pr-dependency-dag')?.requiredSemantics).toEqual({
      repositoryIdentity: true,
      cycle: true,
      truncated: true,
      blockingParent: true,
      incompleteFailsClosed: true,
      branchMutationAuthority: false,
    });
  });

  it('limits queue and train work to read-only status', () => {
    expect(verdictBySurface.get('merge-queue-train')?.readOnlyBoundary).toEqual({
      statusOnly: true,
      unknownOrStaleFailsClosed: true,
      forbiddenMutations: ['enqueue', 'dequeue', 'reorder', 'retry', 'approve', 'merge'],
    });
  });

  it('keeps the human and live-provider evidence deficit visible', () => {
    expect(decision.evidenceLimits).toMatchObject({
      humanGitLabRuns: 0,
      humanGiteeRuns: 0,
      humanStackedPullRequestRuns: 0,
      humanQueueOrTrainRuns: 0,
      realProviderCredentialsUsed: false,
      realRemoteEffectsPerformed: false,
      cleanVmReleaseCompleted: false,
    });
  });
});
