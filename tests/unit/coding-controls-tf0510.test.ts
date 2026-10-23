// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CODING_CONTROL_COMPONENTS,
  codingControlComplete,
  codingControlGaps,
} from '../../openclaw_runtime/src/agents/coding-control-dispositions';

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

describe('TF-0510 coding control dispositions', () => {
  it('covers all five required components exactly once', () => {
    const ids = CODING_CONTROL_COMPONENTS.map((component) => component.id).sort();
    expect(ids).toEqual([
      'isolation-request',
      'patch-flow',
      'stale-write-guard',
      'symbol-lease',
      'worktree-backend',
    ]);
  });

  it('records the full record shape for every component', () => {
    for (const component of CODING_CONTROL_COMPONENTS) {
      expect(component.currentConsumer, component.id).toBeTruthy();
      expect(['internal', 'advanced', 'experiment', 'retired']).toContain(component.disposition);
      expect(['implemented', 'implemented-opt-in', 'implemented-api-only', 'partial']).toContain(component.implementationState);
      expect(component.verificationArtifact.length, component.id).toBeGreaterThan(0);
      expect(Array.isArray(component.remainingGap), component.id).toBe(true);
    }
  });

  it('points every verification artifact at a file that exists on disk', () => {
    for (const component of CODING_CONTROL_COMPONENTS) {
      for (const artifact of component.verificationArtifact) {
        expect(fs.existsSync(path.join(root, artifact)), component.id + ' -> ' + artifact).toBe(true);
      }
    }
  });

  it('does not substitute classification, ownership or expiry for completion', () => {
    // A component only counts as complete when its remaining gap is empty AND it is
    // implemented or retired; experiment/partial states can never close on their own.
    for (const component of CODING_CONTROL_COMPONENTS.filter((entry) => entry.remainingGap.length === 0)) {
      expect(['implemented', 'implemented-opt-in', 'implemented-api-only'], component.id).toContain(component.implementationState);
    }
    const blocked = CODING_CONTROL_COMPONENTS.filter((entry) => entry.remainingGap.length > 0).map((entry) => entry.id);
    expect(blocked.sort()).toEqual(codingControlGaps().map((entry) => entry.id).sort());
    expect(codingControlComplete()).toBe(blocked.length === 0);
  });

  it('patch-flow can reach a real gate outcome instead of a permanent keep-off', () => {
    const source = read('openclaw_runtime/src/agents/patch-flow-graduation.ts');
    // The old hard-coded gate is gone; the decision surface can report a real verdict.
    expect(source).not.toContain('meetsGate: false, // hard');
    expect(source).toContain('meetsGate,');
    expect(source).toContain('recommendation,');
    // It still never flips the runtime default.
    expect(source).toContain('patchFlowDefault: false');
  });

  it('keeps patch-flow reachable from a model tool parameter, not only an env flag', () => {
    const schema = read('openclaw_runtime/src/agents/tools/team-orchestrate-tool.ts');
    expect(schema).toContain('patchFlowExecution: Type.Optional(Type.Boolean())');
    const orchestrator = read('openclaw_runtime/src/agents/orchestrator-run-observed.ts');
    expect(orchestrator).toContain('patchFlowExecution === true');
  });

  it('keeps isolation defaults shared and worktree as an explicit request', () => {
    const source = read('openclaw_runtime/src/agents/isolation-mode-matrix.ts');
    expect(source).toMatch(/shared/u);
    const worktree = read('openclaw_runtime/src/agents/worktree-service.ts');
    expect(worktree).toContain('inprocess');
  });

  it('keeps the coding controls on the operator/developer plane only', () => {
    const control = read('shared/dcs/prod-flags-control.ts');
    // stale-write-guard and symbol-lease are developer-plane writable switches (default off).
    expect(control.includes("id: 'stale-write-guard'")).toBe(true);
    expect(control.includes("id: 'symbol-lease'")).toBe(true);
    // patch-flow has no writable control-plane entry: it is reached through the model
    // tool parameter / operator config, so it can never become a hidden product toggle.
    expect(control.includes("id: 'patch-flow'")).toBe(false);
    // The internal execution/evidence substrate stays off the control plane.
    expect(control.includes("id: 'verseshell'")).toBe(false);
    expect(control.includes("id: 'rc03'")).toBe(false);
  });

  it('records the honest remaining gaps instead of claiming completion', () => {
    const gaps = codingControlGaps();
    const blocked = gaps.map((entry) => entry.id).sort();
    // Both remaining components are blocked on evidence that does not exist yet and on
    // an owning record outside this node's write scope (shared/dcs/**).
    expect(blocked).toEqual(['patch-flow', 'symbol-lease']);
    for (const gap of gaps) {
      expect(gap.remainingGap.length).toBeGreaterThan(0);
      expect(gap.remainingGap.join(' ')).toMatch(/experiment|evidence|shared\//u);
    }
    expect(codingControlComplete()).toBe(false);
  });
});