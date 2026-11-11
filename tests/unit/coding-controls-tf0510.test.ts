// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CODING_CONTROL_COMPONENTS,
  codingControlComplete,
  codingControlGaps,
} from '../../openclaw_runtime/src/agents/coding-control-dispositions';
import { COMPONENT_DISPOSITION_ENTRIES } from '../../shared/dcs/component-disposition-catalog';

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

  it('removes the retired patch-flow entry point from the model tool surface', () => {
    const schema = read('openclaw_runtime/src/agents/tools/team-orchestrate-tool.ts');
    // TF-0510 retired patch-flow, so the model can no longer request it by parameter.
    expect(schema).not.toContain('patchFlowExecution: Type.Optional(Type.Boolean())');
  });
  it('keeps isolation defaults shared and worktree as an explicit request', () => {
    const source = read('openclaw_runtime/src/agents/isolation-mode-matrix.ts');
    expect(source).toMatch(/shared/u);
    const worktree = read('openclaw_runtime/src/agents/worktree-service.ts');
    expect(worktree).toContain('inprocess');
  });

  it('keeps the coding controls on the operator/developer plane only', () => {
    const control = read('shared/dcs/prod-flags-control.ts');
    // stale-write-guard remains a developer-plane writable switch (default off).
    expect(control.includes("id: 'stale-write-guard'")).toBe(true);
    // TF-0510 retired symbol-lease: its writable switch is gone.
    expect(control.includes("id: 'symbol-lease'")).toBe(false);
    // Patch Flow retirement covers model, request and configuration entry points.
    expect(control.includes("id: 'patch-flow'")).toBe(false);
    // The internal execution/evidence substrate stays off the control plane.
    expect(control.includes("id: 'verseshell'")).toBe(false);
    expect(control.includes("id: 'rc03'")).toBe(false);
  });

  it('closes with zero gaps and both experiments retired, not merely reclassified', () => {
    const gaps = codingControlGaps();
    expect(gaps).toEqual([]);
    expect(codingControlComplete()).toBe(true);

    // Retirement must be a real disposition change with a retirement node and no
    // product entry - not an "internal" relabel that keeps the surface alive.
    for (const id of ['feature.symbol-lease', 'feature.patch-flow']) {
      const entry = COMPONENT_DISPOSITION_ENTRIES.find((candidate) => candidate.id === id);
      expect(entry, id).toBeTruthy();
      expect(entry!.disposition, id).toBe('retired');
      expect(entry!.retirementNodeId, id).toBe('TF-0510');
      expect(entry!.implementationNodeId, id).toBeNull();
      expect(entry!.userEntry, id).toBeNull();
      expect(entry!.visibility, id).toBe('retired');
      // The experiment window must no longer apply to a retired record.
      expect(entry!.expiry, id).toBeUndefined();
    }

    // And the retired components must not be re-enablable from any entry point.
    const flags = read('openclaw_runtime/src/context-engine/coding-runtime-flags.ts');
    expect(flags).toContain('SYMBOL_LEASE_RETIRED = true');
    expect(flags).toContain('PATCH_FLOW_RETIRED = true');
  });});
