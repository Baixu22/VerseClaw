import { describe, expect, it } from 'vitest';
import { subagentLifecycleIdentityKey } from '@shared/subagent-lifecycle';

describe('subagent lifecycle identity', () => {
  it('keeps duplicate roles independent through taskNodeId', () => {
    const first = subagentLifecycleIdentityKey({
      taskNodeId: 'task-1',
      roleInstanceId: 'role-instance-1',
      childRunId: 'child-1',
      roleName: 'reviewer',
      task: 'Review the change',
    });
    const second = subagentLifecycleIdentityKey({
      taskNodeId: 'task-2',
      roleInstanceId: 'role-instance-2',
      childRunId: 'child-2',
      roleName: 'reviewer',
      task: 'Review the change',
    });
    expect(first).toBe('task-1');
    expect(second).toBe('task-2');
    expect(first).not.toBe(second);
  });

  it('uses role instance, child run, then role and task for old payloads', () => {
    expect(subagentLifecycleIdentityKey({ roleInstanceId: 'role-1', childRunId: 'child-1' })).toBe('role-1');
    expect(subagentLifecycleIdentityKey({ childRunId: 'child-1', roleName: 'tester' })).toBe('child-1');
    expect(subagentLifecycleIdentityKey({ roleName: 'tester', task: 'Run tests' })).toBe('tester:Run tests');
  });
});
