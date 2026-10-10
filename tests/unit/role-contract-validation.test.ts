// @vitest-environment node
/**
 * Regression for issue #109.
 *
 * A role contract that declares a read-only filesystem together with `write`/
 * `edit` tools, or a `handoff.to` pointing at a role that does not exist, used to
 * pass validation and register with an empty `issues` list. The declared
 * capability was then silently contradicted by the permission-derived tool deny
 * list at spawn time.
 *
 * These tests pin the replacement behaviour: those contradictions are reported
 * at validation/registration time, naming the field, the conflicting item and the
 * role, while a previously-accepted configuration still loads (the new findings
 * are warnings, not errors, so no role is silently dropped or de-privileged).
 */
import { describe, expect, it } from 'vitest';
import {
  normalizeRoleContract,
  validateRoleContract,
} from '../../openclaw_runtime/src/agents/role-contract';
import { buildRoleRegistry } from '../../openclaw_runtime/src/agents/role-registry';

function roleFrom(overrides: Record<string, unknown>) {
  return normalizeRoleContract({
    name: 'audit-reviewer',
    display_name: 'Audit Reviewer',
    role_prompt: 'Review the supplied evidence and report findings without changing files.',
    ...overrides,
  });
}

function warningsOf(result: ReturnType<typeof validateRoleContract>) {
  return result.issues.filter((issue) => issue.severity === 'warning');
}

function errorsOf(result: ReturnType<typeof validateRoleContract>) {
  return result.issues.filter((issue) => (issue.severity ?? 'error') === 'error');
}

describe('role contract cross-field validation (#109)', () => {
  it('reports read-only filesystem with write/edit tools as a tools conflict', () => {
    const role = roleFrom({
      permissions: { filesystem: 'read', network: 'none' },
      tools: ['write', 'edit'],
    });

    const result = validateRoleContract(role);

    expect(result.ok).toBe(true);
    expect(errorsOf(result)).toEqual([]);
    const conflict = warningsOf(result).find((issue) => issue.path === 'tools');
    expect(conflict).toBeDefined();
    expect(conflict?.message).toContain('write, edit');
    expect(conflict?.message).toContain('filesystem=read');
  });

  it('reports filesystem none with filesystem tools as a tools conflict', () => {
    const role = roleFrom({
      permissions: { filesystem: 'none', network: 'none' },
      tools: ['read', 'glob'],
    });

    const conflict = warningsOf(validateRoleContract(role)).find(
      (issue) => issue.path === 'tools',
    );

    expect(conflict?.message).toContain('read, glob');
    expect(conflict?.message).toContain('filesystem=none');
  });

  it('reports network none with network tools as a tools conflict', () => {
    const role = roleFrom({
      permissions: { filesystem: 'write', network: 'none' },
      tools: ['browser', 'web_fetch'],
    });

    const conflict = warningsOf(validateRoleContract(role)).find(
      (issue) => issue.path === 'tools',
    );

    expect(conflict?.message).toContain('browser, web_fetch');
    expect(conflict?.message).toContain('network=none');
  });

  it('leaves a consistent role free of tool conflicts', () => {
    const role = roleFrom({
      permissions: { filesystem: 'read', network: 'none', commands: [] },
      tools: ['read', 'glob', 'grep'],
      handoff: { to: ['reviewer'], from: ['planner'] },
    });

    const result = validateRoleContract(role);

    expect(result.ok).toBe(true);
    expect(warningsOf(result)).toEqual([]);
  });

  it('keeps structural problems as errors that still block the contract', () => {
    const role = roleFrom({ name: 'Bad Name' });

    const result = validateRoleContract(role);

    expect(result.ok).toBe(false);
    expect(errorsOf(result).map((issue) => issue.path)).toContain('name');
  });
});

describe('role registry diagnostics (#109)', () => {
  it('reproduces the issue report: conflicts and a dangling handoff are surfaced without dropping the role', () => {
    const registry = buildRoleRegistry({
      agents: {
        roles: [
          {
            name: 'audit-reviewer',
            display_name: 'Audit Reviewer',
            role_prompt: 'Review the supplied evidence without changing files.',
            permissions: { filesystem: 'read', network: 'none' },
            tools: ['write', 'edit'],
            handoff: { to: ['no-such-audit-role'], from: [] },
          },
        ],
      },
    });

    // The role is still registered (nothing is silently deleted) ...
    expect(registry.byName.get('audit-reviewer')).toBeDefined();
    expect(registry.configRoleNames).toContain('audit-reviewer');

    // ... and both problems are reported with field, item and role name.
    const toolIssue = registry.issues.find(
      (issue) => issue.name === 'audit-reviewer' && issue.path === 'tools',
    );
    expect(toolIssue).toMatchObject({ index: 0, severity: 'warning' });
    expect(toolIssue?.message).toContain('write');

    const handoffIssue = registry.issues.find(
      (issue) => issue.name === 'audit-reviewer' && issue.path === 'handoff.to',
    );
    expect(handoffIssue).toMatchObject({ index: 0, severity: 'warning' });
    expect(handoffIssue?.message).toContain('no-such-audit-role');

    expect(registry.issues.some((issue) => (issue.severity ?? 'error') === 'error')).toBe(false);
  });

  it('accepts forward references inside the same config batch and built-in targets', () => {
    const registry = buildRoleRegistry({
      agents: {
        roles: [
          {
            name: 'first-role',
            display_name: 'First Role',
            role_prompt: 'Hand work off to the role defined later in this same list.',
            permissions: { filesystem: 'read', network: 'none' },
            tools: ['read'],
            handoff: { to: ['second-role'], from: ['reviewer'] },
          },
          {
            name: 'second-role',
            display_name: 'Second Role',
            role_prompt: 'Receive work that the first role forwards, then report back.',
            permissions: { filesystem: 'read', network: 'none' },
            tools: ['read'],
            handoff: { to: [], from: ['first-role'] },
          },
        ],
      },
    });

    // Only config-entry findings (index >= 0) matter here: the built-in
    // knowledge-librarian contract has its own dangling target and is asserted
    // separately below.
    const handoffIssues = registry.issues.filter(
      (issue) => issue.path.startsWith('handoff.') && issue.index >= 0,
    );
    expect(handoffIssues).toEqual([]);
  });

  it('reports a dangling handoff.from target too', () => {
    const registry = buildRoleRegistry({
      agents: {
        roles: [
          {
            name: 'receiver-role',
            display_name: 'Receiver Role',
            role_prompt: 'Receive work from a role that does not exist in this registry.',
            permissions: { filesystem: 'read', network: 'none' },
            tools: ['read'],
            handoff: { to: [], from: ['ghost-role'] },
          },
        ],
      },
    });

    const issue = registry.issues.find((entry) => entry.path === 'handoff.from');
    expect(issue).toMatchObject({ index: 0, name: 'receiver-role', severity: 'warning' });
    expect(issue?.message).toContain('ghost-role');
  });

  it('surfaces the shipped built-in knowledge-librarian handoff target that has no contract', () => {
    // Newly surfaced by this validation: the built-in contract hands off to a
    // role name that exists nowhere in the registry. Reported with index -1 so a
    // maintainer can tell a built-in finding from a config finding.
    const registry = buildRoleRegistry();

    const issue = registry.issues.find(
      (entry) => entry.name === 'knowledge-librarian' && entry.path === 'handoff.to',
    );
    expect(issue).toMatchObject({ index: -1, severity: 'warning' });
    expect(issue?.message).toContain('researcher');
  });

  it('still skips a config entry whose validation fails with errors', () => {
    const registry = buildRoleRegistry({
      agents: { roles: [{ name: 'Bad Name', role_prompt: 'x' }] },
    });

    expect(registry.byName.has('Bad Name')).toBe(false);
    expect(registry.issues.some((issue) => (issue.severity ?? 'error') === 'error')).toBe(true);
  });
});
