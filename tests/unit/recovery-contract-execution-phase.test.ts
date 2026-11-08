import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  EXECUTION_PHASES,
  EXECUTION_PHASE_TRANSITIONS,
  TERMINAL_EXECUTION_PHASES,
  canTransition,
  classifyPhaseCommit,
  classifyReplay,
  isIdempotentCommit,
  isTerminalPhase,
  type ExecutionPhase,
} from '../../shared/recovery-contract/execution-phase';

const LEGAL_TRANSITIONS = EXECUTION_PHASE_TRANSITIONS.map(([from, to]) => `${from}->${to}`);
const LEGAL_TRANSITION_SET = new Set(LEGAL_TRANSITIONS);

describe('recovery contract / execution phase', () => {
  it('publishes the eight durable phases in lifecycle order', () => {
    expect(EXECUTION_PHASES).toEqual([
      'admitted',
      'dispatched',
      'effect_pending',
      'effect_committed',
      'verified',
      'terminal',
      'failed',
      'aborted',
    ]);
  });

  it('accepts exactly the declared forward transitions', () => {
    expect(EXECUTION_PHASE_TRANSITIONS).toHaveLength(12);
    for (const from of EXECUTION_PHASES) {
      for (const to of EXECUTION_PHASES) {
        expect(canTransition(from, to), `${from}->${to}`).toBe(
          LEGAL_TRANSITION_SET.has(`${from}->${to}`),
        );
      }
    }
  });

  it('rejects representative illegal jumps and backwards transitions', () => {
    const illegal: ReadonlyArray<readonly [ExecutionPhase, ExecutionPhase]> = [
      ['admitted', 'effect_pending'],
      ['admitted', 'effect_committed'],
      ['admitted', 'verified'],
      ['admitted', 'terminal'],
      ['dispatched', 'effect_committed'],
      ['dispatched', 'verified'],
      ['effect_pending', 'dispatched'],
      ['effect_pending', 'verified'],
      ['effect_committed', 'effect_pending'],
      ['effect_committed', 'terminal'],
      ['verified', 'effect_committed'],
      ['verified', 'failed'],
      ['terminal', 'admitted'],
      ['failed', 'terminal'],
      ['aborted', 'failed'],
    ];
    for (const [from, to] of illegal) {
      expect(canTransition(from, to), `${from}->${to}`).toBe(false);
      expect(classifyPhaseCommit(from, to)).toBe('reject');
    }
  });

  it('never allows a self-loop through the transition graph', () => {
    for (const phase of EXECUTION_PHASES) {
      expect(canTransition(phase, phase), phase).toBe(false);
    }
  });

  it('treats terminal, failed and aborted as the terminal family', () => {
    expect(TERMINAL_EXECUTION_PHASES).toEqual(['terminal', 'failed', 'aborted']);
    for (const phase of EXECUTION_PHASES) {
      expect(isTerminalPhase(phase), phase).toBe(
        phase === 'terminal' || phase === 'failed' || phase === 'aborted',
      );
    }
  });

  it('has no outgoing transition from any terminal phase', () => {
    for (const terminal of TERMINAL_EXECUTION_PHASES) {
      for (const to of EXECUTION_PHASES) {
        expect(canTransition(terminal, to), `${terminal}->${to}`).toBe(false);
        expect(classifyPhaseCommit(terminal, to), `${terminal}->${to}`).toBe(
          terminal === to ? 'noop' : 'reject',
        );
      }
    }
  });

  it('classifies replay per durable phase', () => {
    expect(
      Object.fromEntries(EXECUTION_PHASES.map((phase) => [phase, classifyReplay(phase)])),
    ).toEqual({
      admitted: 'safe',
      dispatched: 'reconcile',
      effect_pending: 'reconcile',
      effect_committed: 'unsafe',
      verified: 'safe',
      terminal: 'safe',
      failed: 'unsafe',
      aborted: 'safe',
    });
  });

  it('requires effect_pending recovery to reconcile instead of rerunning', () => {
    expect(classifyReplay('effect_pending')).toBe('reconcile');
    expect(classifyReplay('effect_pending')).not.toBe('safe');
    expect(classifyReplay('effect_pending')).not.toBe('unsafe');
  });

  it('never marks effect_committed or failed as safe to replay', () => {
    expect(classifyReplay('effect_committed')).toBe('unsafe');
    expect(classifyReplay('failed')).toBe('unsafe');
  });

  it('treats a same-phase commit as an idempotent no-op, not a transition', () => {
    for (const phase of EXECUTION_PHASES) {
      expect(classifyPhaseCommit(phase, phase), phase).toBe('noop');
      expect(isIdempotentCommit(phase, phase), phase).toBe(true);
      expect(canTransition(phase, phase), phase).toBe(false);
    }
  });

  it('classifies a legal forward commit as apply and an illegal commit as reject', () => {
    expect(classifyPhaseCommit('admitted', 'dispatched')).toBe('apply');
    expect(classifyPhaseCommit('effect_pending', 'effect_committed')).toBe('apply');
    expect(classifyPhaseCommit('verified', 'terminal')).toBe('apply');
    expect(classifyPhaseCommit('terminal', 'dispatched')).toBe('reject');
    expect(isIdempotentCommit('terminal', 'dispatched')).toBe(false);
  });

  it('stays a pure module with no imports of production runtime code', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'shared/recovery-contract/execution-phase.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/^\s*import\s/m);
  });
});