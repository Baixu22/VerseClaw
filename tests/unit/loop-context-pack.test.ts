import { describe, expect, it } from 'vitest';
import {
  LOOP_CONTEXT_SECTION_ORDER,
  buildLoopContextPack,
  formatLoopContextPackForPrompt,
  getLoopContextSection,
} from '../../openclaw_runtime/src/agents/loop-context-pack';
import {
  buildTaskLoopContextPack,
  formatTaskLoopContextPackForReviewer,
} from '../../openclaw_runtime/src/agents/task-loop-context';

describe('LoopContextPack', () => {
  it('keeps the fixed resume priority order', () => {
    const pack = buildLoopContextPack({
      systemAppRules: ['system rule'],
      projectRules: ['project rule'],
      initialConstraints: ['initial constraint'],
      userInterventions: ['user changed scope'],
      architecturePrinciples: ['architecture principle'],
      taskLedgerState: ['ledger state'],
      resumeCheckpoint: 'checkpoint state',
      relevantKnowledge: ['knowledge note'],
      roleMemory: ['role memory'],
      transcriptSummary: ['transcript summary'],
    });

    expect(pack.priorityOrder).toEqual([...LOOP_CONTEXT_SECTION_ORDER]);
    expect(pack.sections.map((section) => section.id)).toEqual([...LOOP_CONTEXT_SECTION_ORDER]);
    expect(formatLoopContextPackForPrompt(pack)).toContain('System/App Rules > Project Rules > /loop initial constraints');
  });

  it('truncates lower priority context within budget without dropping P0 recovery facts', () => {
    const pack = buildLoopContextPack({
      initialConstraints: ['initial constraint must survive'],
      userInterventions: ['user intervention must survive'],
      architecturePrinciples: ['architecture principle must survive'],
      keyDesignDecisions: [{ decision: 'keep host-api boundary', rationale: 'renderer must not own backend transport' }],
      currentTask: {
        goal: 'finish LoopContextPack',
        acceptance: ['focused vitest passes'],
      },
      taskLedgerState: ['ledger '.repeat(400)],
      relevantKnowledge: ['knowledge '.repeat(400)],
      roleMemory: ['memory '.repeat(400)],
      transcriptSummary: ['transcript '.repeat(400)],
      budget: {
        totalTokens: 20,
        itemTokens: 5,
        sectionTokens: {
          taskLedgerCurrentState: 5,
          relevantKnowledge: 5,
          roleMemory: 5,
          transcriptSummary: 5,
        },
      },
    });

    const rendered = formatLoopContextPackForPrompt(pack);
    expect(pack.p0Preserved).toBe(true);
    expect(pack.overflowTokens).toBeGreaterThan(0);
    expect(rendered).toContain('initial constraint must survive');
    expect(rendered).toContain('user intervention must survive');
    expect(rendered).toContain('architecture principle must survive');
    expect(rendered).toContain('keep host-api boundary');
    expect(rendered).toContain('renderer must not own backend transport');
    expect(rendered).toContain('Current task goal: finish LoopContextPack');
    expect(rendered).toContain('Acceptance: focused vitest passes');
    expect(getLoopContextSection(pack, 'relevantKnowledge').omittedItems.length).toBeGreaterThan(0);
    expect(getLoopContextSection(pack, 'roleMemory').omittedItems.length).toBeGreaterThan(0);
  });

  it('places user interventions before stale task-ledger plans', () => {
    const pack = buildLoopContextPack({
      userInterventions: [{
        text: 'User changed acceptance to require the new LoopContextPack entry.',
        supersedes: 'plan-v1',
      }],
      taskLedgerState: ['old task-ledger plan says each surface may build its own long context'],
    });
    const rendered = formatLoopContextPackForPrompt(pack);

    expect(rendered.indexOf('User changed acceptance')).toBeLessThan(rendered.indexOf('old task-ledger plan'));
    expect(rendered).toContain('supersedes=plan-v1');
  });

  it('keeps rules ahead of knowledge and role memory when budget is tight', () => {
    const pack = buildLoopContextPack({
      systemAppRules: ['System rule: renderer/Main boundary is mandatory.'],
      projectRules: ['Project rule: use host-api and no parallel rules source of truth.'],
      relevantKnowledge: ['knowledge '.repeat(200)],
      roleMemory: ['memory '.repeat(200)],
      budget: {
        totalTokens: 35,
        sectionTokens: {
          relevantKnowledge: 5,
          roleMemory: 5,
        },
      },
    });
    const rendered = formatLoopContextPackForPrompt(pack);

    expect(rendered).toContain('System rule: renderer/Main boundary is mandatory.');
    expect(rendered).toContain('Project rule: use host-api and no parallel rules source of truth.');
    expect(getLoopContextSection(pack, 'relevantKnowledge').omittedItems).toHaveLength(1);
    expect(getLoopContextSection(pack, 'roleMemory').omittedItems).toHaveLength(1);
  });

  it('formats task-loop reviewer recovery context from LoopContextPack sections', () => {
    const pack = buildTaskLoopContextPack({
      objective: 'ship bounded recovery',
      iteration: 2,
      planSummary: 'old plan: each subsystem concatenates its own context',
      previousContextSummary: 'previous reviewer summary from the old field',
      repairBrief: 'repair only through LoopContextPack',
      loopContext: {
        systemAppRules: ['System rule: renderer/Main boundary is mandatory.'],
        projectRules: ['Project rule: AGENTS.md plus harness specs outrank memory.'],
        userInterventions: [{
          text: 'User intervention: stop following the stale plan.',
          supersedes: 'plan-v1',
        }],
        relevantKnowledge: ['Knowledge note: may be stale.'],
        roleMemory: ['Role memory: lower priority than rules.'],
      },
    });
    const formatted = formatTaskLoopContextPackForReviewer(pack);

    expect(formatted).toContain('legacyCompatibility:');
    expect(formatted).toContain('formatted from LoopContextPack sections only');
    expect(formatted).toContain('planSummary:\n- [P1; task_ledger] Current task-loop plan: old plan');
    expect(formatted).toContain('previousContextSummary:\n- [P2; transcript_summary] previous reviewer summary from the old field');
    expect(formatted).toContain('repairBrief:\n- [P0; loop_initial_constraints] Repair brief: repair only through LoopContextPack');
    expect(formatted.indexOf('User intervention: stop following the stale plan.'))
      .toBeLessThan(formatted.indexOf('old plan: each subsystem'));
    expect(formatted.indexOf('Project rule: AGENTS.md plus harness specs outrank memory.'))
      .toBeLessThan(formatted.indexOf('Knowledge note: may be stale.'));
    expect(formatted.indexOf('Project rule: AGENTS.md plus harness specs outrank memory.'))
      .toBeLessThan(formatted.indexOf('Role memory: lower priority than rules.'));
  });
});
