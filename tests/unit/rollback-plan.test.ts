import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildRollbackPlan, hasRollbackPlanSidebarTrigger } from '@/pages/Chat/rollback-plan';

function readChatLocale(locale: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(process.cwd(), 'shared', 'i18n', 'locales', locale, 'chat.json'), 'utf8')) as Record<string, unknown>;
}

function collectVisibleStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(collectVisibleStrings);
  return Object.values(value).flatMap(collectVisibleStrings);
}

describe('rollback plan', () => {
  it('uses recovery-assist wording in rollbackPlan locale copy without promising rollback semantics', () => {
    const forbidden = {
      en: /\brollback\b|\blossless\b|automatic full|full rollback|all side effects|completely equivalent/iu,
      zh: /回滚|无损|自动全|全量|所有副作用|完全等同/iu,
      ja: /ロールバック|完全|自動.*復旧|無損|すべての副作用/iu,
      ru: /откат|автоматическ.*полн|без потерь|все побочные|полностью эквивалент/iu,
    };
    const expectedTitles = {
      en: 'Recovery assist',
      zh: '恢复辅助',
      ja: '復旧支援',
      ru: 'Помощь восстановления',
    };

    for (const locale of ['en', 'zh', 'ja', 'ru'] as const) {
      const chat = readChatLocale(locale);
      const planCopy = (chat.composer as { rollbackPlan: Record<string, unknown> }).rollbackPlan;
      const visibleCopy = collectVisibleStrings(planCopy).join('\n');
      expect(planCopy.title).toBe(expectedTitles[locale]);
      expect(visibleCopy).not.toMatch(forbidden[locale]);
      expect((planCopy.actions as Record<string, Record<string, string>>)['checkpoint-handoff'].detailEvidenceBacked).toBeTruthy();
      expect((planCopy.actions as Record<string, Record<string, string>>)['checkpoint-handoff'].detailNoEvidence).toBeTruthy();
    }
  });

  it('labels checkpoint handoff as evidence-backed when fingerprints and tool results are available', () => {
    const plan = buildRollbackPlan({
      activeRun: false,
      gatewayAvailable: true,
      queueDrainBusy: false,
      compactionBusy: false,
      handoffDisabled: false,
      contextRange: null,
      compactionStatus: null,
      longTaskControlStatus: {
        available: true,
        queueCount: 0,
        warnings: [],
        latestCheckpoint: {
          id: 'checkpoint-evidence',
          sessionKey: 'agent:main:main',
          trigger: 'manual_review',
          status: 'active',
          checkpoint: {
            schemaVersion: 1,
            trigger: 'manual_review',
            openBlockers: [],
            decisions: [],
            deviations: [],
            filesTouched: ['src/a.ts', 'src/b.ts'],
            testsRun: [],
            reviewNeededItems: [],
            evidenceRefs: [{ type: 'session', ref: 'agent:main:main' }],
            createdAt: '2026-06-23T00:00:00.000Z',
            metadata: {
              fileHashes: {
                'src/a.ts': 'a'.repeat(64),
                'src/b.ts': 'b'.repeat(64),
              },
              toolResults: [{ callId: 'task_loop.subagent:run_acceptance', status: 'success' }],
            },
          },
          createdAt: 1,
          updatedAt: 1,
        },
      },
    });

    expect(plan.actions.find((action) => action.kind === 'checkpoint-handoff')).toMatchObject({
      detailKey: 'composer.rollbackPlan.actions.checkpoint-handoff.detailEvidenceBacked',
      detailValues: { trigger: 'manual_review', fileCount: 2, toolCount: 1 },
      risk: 'safe',
    });
  });

  it('degrades checkpoint handoff copy when fingerprint or tool evidence is missing', () => {
    const plan = buildRollbackPlan({
      activeRun: false,
      gatewayAvailable: true,
      queueDrainBusy: false,
      compactionBusy: false,
      handoffDisabled: false,
      contextRange: null,
      compactionStatus: null,
      longTaskControlStatus: {
        available: true,
        queueCount: 0,
        warnings: [],
        latestCheckpoint: {
          id: 'checkpoint-legacy',
          sessionKey: 'agent:main:main',
          trigger: 'interrupt',
          status: 'active',
          checkpoint: {
            schemaVersion: 1,
            trigger: 'interrupt',
            openBlockers: [],
            decisions: [],
            deviations: [],
            filesTouched: [],
            testsRun: [],
            reviewNeededItems: [],
            evidenceRefs: [{ type: 'session', ref: 'agent:main:main' }],
            createdAt: '2026-06-23T00:00:00.000Z',
          },
          createdAt: 1,
          updatedAt: 1,
        },
      },
    });

    expect(plan.actions.find((action) => action.kind === 'checkpoint-handoff')).toMatchObject({
      detailKey: 'composer.rollbackPlan.actions.checkpoint-handoff.detailNoEvidence',
      detailValues: { trigger: 'interrupt', fileCount: 0, toolCount: 0 },
    });
  });

  it('prioritizes active-run interruption and checkpoint handoff before destructive rollback', () => {
    const plan = buildRollbackPlan({
      activeRun: true,
      gatewayAvailable: true,
      queueDrainBusy: false,
      compactionBusy: false,
      handoffDisabled: false,
      contextRange: null,
      compactionStatus: null,
      longTaskControlStatus: {
        available: true,
        queueCount: 2,
        warnings: [],
        latestCheckpoint: {
          id: 'checkpoint-1',
          sessionKey: 'agent:main:main',
          trigger: 'interrupt',
          status: 'active',
          checkpoint: {
            schemaVersion: 1,
            trigger: 'interrupt',
            openBlockers: [],
            decisions: [],
            deviations: [],
            filesTouched: [],
            testsRun: [],
            reviewNeededItems: [],
            evidenceRefs: [{ type: 'session', ref: 'agent:main:main' }],
            createdAt: '2026-06-23T00:00:00.000Z',
          },
          createdAt: 1,
          updatedAt: 1,
        },
      },
    });

    expect(plan.available).toBe(true);
    expect(plan.summaryKey).toBe('composer.rollbackPlan.summary.checkpoint');
    expect(plan.summaryValues).toEqual({ trigger: 'interrupt' });
    expect(plan.actions.map((action) => action.kind).slice(0, 3)).toEqual([
      'terminal-interrupt',
      'checkpoint-handoff',
      'drain-queue',
    ]);
    expect(plan.actions.find((action) => action.kind === 'terminal-interrupt')).toMatchObject({
      risk: 'dangerous',
      command: 'interruptTerminal',
    });
    expect(plan.actions.find((action) => action.kind === 'review-git')).toBeUndefined();
    expect(hasRollbackPlanSidebarTrigger(plan)).toBe(true);
    expect(plan.riskCounts).toEqual({ safe: 2, review: 0, dangerous: 1 });
    expect(plan.signals).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'checkpoint', active: true, risk: 'safe' }),
      expect.objectContaining({ kind: 'queue', active: true, risk: 'safe' }),
      expect.objectContaining({ kind: 'terminal', active: true, risk: 'dangerous' }),
      expect.objectContaining({ kind: 'memory', active: false, risk: 'review' }),
    ]));
  });

  it('offers compaction when idle context pressure is high', () => {
    const plan = buildRollbackPlan({
      activeRun: false,
      gatewayAvailable: true,
      queueDrainBusy: false,
      compactionBusy: false,
      handoffDisabled: true,
      contextRange: {
        sessionKey: 'agent:main:main',
        usedTokens: 90000,
        maxTokens: 128000,
        truncatedMessageCount: 3,
        status: 'bestEffort',
      },
      compactionStatus: {
        success: true,
        available: true,
        canCompact: true,
        inProgress: false,
        pressure: 'high',
        usedTokens: 90000,
        maxTokens: 128000,
        remainingTokens: 38000,
        truncatedMessageCount: 3,
        warnings: [],
      },
      longTaskControlStatus: null,
    });

    expect(plan.summaryKey).toBe('composer.rollbackPlan.summary.truncated');
    expect(plan.summaryValues).toEqual({ count: 3 });
    expect(plan.actions).toEqual([expect.objectContaining({
      kind: 'manual-compact',
      risk: 'review',
      command: 'compact',
    })]);
    expect(plan.signals).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'checkpoint', active: false }),
      expect.objectContaining({ kind: 'context', active: true, risk: 'review' }),
      expect.objectContaining({ kind: 'git', active: false }),
    ]));
    expect(hasRollbackPlanSidebarTrigger(plan)).toBe(true);
  });

  it('does not request the chat side rail for generic recovery shortcuts only', () => {
    const plan = buildRollbackPlan({
      activeRun: false,
      gatewayAvailable: true,
      queueDrainBusy: false,
      compactionBusy: false,
      handoffDisabled: true,
      contextRange: {
        sessionKey: 'agent:main:main',
        usedTokens: 1000,
        maxTokens: 128000,
        truncatedMessageCount: 0,
        status: 'bestEffort',
      },
      compactionStatus: {
        success: true,
        available: true,
        canCompact: false,
        inProgress: false,
        pressure: 'low',
        usedTokens: 1000,
        maxTokens: 128000,
        remainingTokens: 127000,
        truncatedMessageCount: 0,
        warnings: [],
      },
      longTaskControlStatus: {
        available: true,
        queueCount: 0,
        warnings: [],
      },
    });

    expect(plan.actions).toEqual([]);
    expect(plan.available).toBe(false);
    expect(hasRollbackPlanSidebarTrigger(plan)).toBe(false);
  });
});
