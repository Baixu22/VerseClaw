import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  completionView,
  normalizeAutonomyObjectReference,
  normalizeAutonomySessionScope,
  resolveProjectIdForWorkspace,
  resolveWorkspaceIdForProject,
  validateProductSemanticRelations,
  type AutonomyObjectReference,
  type AutonomyRoleScope,
  type AutonomySessionScope,
  type ProjectId,
  type SessionKey,
  type WorkspaceId,
} from '@shared/product-semantics';
import { COMPONENT_AUTHORITY_MANIFEST, validateComponentAuthorityManifest } from '@shared/component-authority-manifest';
import { decideGatewayRpc, decideWorkspaceCommand, decideWorkspaceFileWrite, requireWorkspace } from '@electron/services/workspace-permissions';
import type { WorkspaceProfile } from '@shared/types/workspace';

const scope: AutonomySessionScope = {
  workspaceId: ' workspace-A ' as WorkspaceId,
  projectId: resolveProjectIdForWorkspace(' workspace-A ' as WorkspaceId),
  sessionKey: 'agent:main:conversation' as SessionKey,
  sessionGeneration: 'generation-A',
};
const run = { runId: 'run-A', scope: { workspaceId: scope.workspaceId, projectId: scope.projectId, sessionKey: scope.sessionKey } };
const references = [
  { kind: 'project', owner: 'workspaces', scope },
  { kind: 'workspace', owner: 'workspaces', scope },
  { kind: 'session', owner: 'sessions', scope },
  { kind: 'run', owner: 'runtime', scope, run },
  { kind: 'action', owner: 'host-api', scope, actionId: ' action-A ' },
  { kind: 'effect', owner: 'coding-execution-backend', scope, effectId: ' effect-A ', run },
  { kind: 'evidence', owner: 'task-loop', scope, evidenceRef: ' evidence-A ' },
  { kind: 'resource', owner: 'resource-tracker', scope, resourceId: ' resource-A ' },
];

describe('autonomous object owner contract', () => {
  it('keeps identity brands and existing role references distinct', () => {
    expectTypeOf<AutonomySessionScope['projectId']>().not.toExtend<WorkspaceId>();
    expectTypeOf<AutonomyRoleScope['agentId']>().toEqualTypeOf<string>();
    expectTypeOf<{ responsibility: 'project'; agentId: string }>().not.toExtend<AutonomyRoleScope>();
    expectTypeOf<{ responsibility: 'session'; agentId: string; roleContract: { name: string } }>().not.toExtend<AutonomyRoleScope>();
    expectTypeOf<{ kind: 'effect'; owner: 'host-api'; scope: AutonomySessionScope; effectId: string }>().not.toExtend<AutonomyObjectReference>();
    expect(resolveWorkspaceIdForProject(scope.projectId, scope.workspaceId)).toBe(scope.workspaceId);
    expect(() => resolveWorkspaceIdForProject('arbitrary-project' as ProjectId, scope.workspaceId)).toThrow(/does not match/);
  });

  it.each(references)('preserves the $kind pointer and ID bytes without changing its input', (input) => {
    const before = JSON.stringify(input);
    expect(normalizeAutonomyObjectReference(input, scope)).toEqual(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it.each(['workspaceId', 'projectId', 'sessionKey', 'sessionGeneration'] as const)('rejects changed %s against the current owner', (field) => {
    for (const reference of references) {
      expect(() => normalizeAutonomyObjectReference({ ...reference, scope: { ...scope, [field]: 'other' } }, scope)).toThrow(new RegExp(`${field} mismatch`));
    }
  });

  it.each(['workspaceId', 'projectId', 'sessionKey', 'sessionGeneration'] as const)('rejects absent %s rather than inventing scope', (field) => {
    const missing = { ...scope } as Record<string, unknown>;
    delete missing[field];
    expect(() => normalizeAutonomySessionScope(missing, scope)).toThrow(TypeError);
  });

  it.each([null, [], {}, { ...scope, sessionGeneration: '' }, { ...scope, workspaceKey: 'other' }, Object.create(scope)])('rejects malformed scope: %j', (input) => {
    expect(() => normalizeAutonomySessionScope(input, scope)).toThrow(TypeError);
  });

  it('does not invent an owner when the current owner is unavailable', () => {
    expect(() => normalizeAutonomyObjectReference(references[0], null)).toThrow(/unavailable/);
    expect(() => requireWorkspace(null)).toThrow(/No active workspace/);
  });

  it.each(['owner', 'actionId'])('requires the action %s', (field) => {
    const input = { ...references[4] } as Record<string, unknown>;
    delete input[field];
    expect(() => normalizeAutonomyObjectReference(input, scope)).toThrow(TypeError);
  });

  it.each([
    { kind: 'action', owner: 'task-ledger', scope, actionId: 'a' },
    { kind: 'resource', owner: 'task-loop', scope, resourceId: 'r' },
    { kind: 'task', owner: 'runtime', scope, taskId: 'bare' },
    { kind: 'toString', owner: 'runtime', scope },
    { ...references[4], allowed: true },
    { ...references[4], grant: 'fullAccess' },
    { ...references[5], taskStatus: 'done' },
    { ...references[6], passed: true },
    { ...references[7], leaseState: 'idle' },
    { ...references[3], run: { ...run, scope: { ...run.scope, workspaceId: 'other' } } },
    { ...references[5], run: { ...run, scope: { ...run.scope, projectId: 'other' } } },
    { ...references[3], run: { ...run, scope: { workspaceId: scope.workspaceId, projectId: scope.projectId } } },
    { ...references[3], run: { ...run, scope: { ...run.scope, workspaceKey: scope.workspaceId } } },
  ])('rejects mixed, forged or unscoped reference: %j', (input) => {
    expect(() => normalizeAutonomyObjectReference(input, scope)).toThrow(TypeError);
  });

  it('static owner/allow mutations do not change actual Main write or Gateway permissions', () => {
    const forged = structuredClone(COMPONENT_AUTHORITY_MANIFEST);
    const renderer = forged.components.find((entry) => entry.id === 'renderer-ui-surface')!;
    renderer.authorizationRole = 'owner';
    renderer.effects = ['authorize', 'execute'];
    renderer.allowedWrites = ['execution.tool-effect'];
    expect(validateComponentAuthorityManifest(forged).ok).toBe(false);
    expect(decideGatewayRpc('tools.exec', 'readOnly', { command: 'write' }).allowed).toBe(false);
    expect(decideWorkspaceCommand('pnpm install', 'readOnly').allowed).toBe(false);
    const workspace = { rootPath: 'D:/project', permissionMode: 'readOnly' } as WorkspaceProfile;
    expect(decideWorkspaceFileWrite('D:/project/a.txt', workspace).allowed).toBe(false);
    expect(() => normalizeAutonomyObjectReference({ ...references[4], owner: 'renderer-ui-surface', allowed: true }, scope)).toThrow(TypeError);
  });

  it('rejects static grant metadata and keeps Run completion distinct from Task acceptance', () => {
    const result = validateProductSemanticRelations([{
      from: 'chat', kind: 'projects', to: 'task-ledger', authorityBoundary: 'read-only-projection',
      evidenceRefs: ['docs/clawx-product-semantics.md'], grants: ['execute'],
    }]);
    expect(result.diagnostics.some((entry) => entry.rule === 'forged-grant-field')).toBe(true);
    expect(completionView({ authority: 'run', runStatus: 'completed', taskStatus: 'completed', verification: 'passed' }).taskStatus).toBe('unavailable');
  });

  it('maps all nine objects to source owners and actual contract/runtime consumers', () => {
    const map = JSON.parse(readFileSync(resolve('harness/specs/fixtures/autonomous-project-system/a1/object-owner-consumer-map.json'), 'utf8'));
    expect(map.driven_by).toBe('agent');
    expect(map.objects.map((entry: { object: string }) => entry.object)).toEqual(['Project', 'Workspace', 'SessionKey/generation', 'ScopedRunId', 'TaskRef', 'Action', 'Effect', 'Evidence', 'ResourceRef']);
    for (const entry of map.objects) {
      expect(entry.owner.length).toBeGreaterThan(0);
      expect(entry.sourceAnchors.length).toBeGreaterThan(0);
      expect(entry.consumers.length).toBeGreaterThan(0);
      for (const anchor of [...entry.sourceAnchors, ...entry.consumers]) {
        expect(readFileSync(resolve(anchor.path), 'utf8'), `${entry.object}: ${anchor.path}`).toContain(anchor.contains);
      }
    }
  });
});
