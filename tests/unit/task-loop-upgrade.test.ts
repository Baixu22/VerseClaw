import { describe, expect, it, vi } from 'vitest';
import { createTaskLoopUpgradeSuggestion } from '@shared/product-semantics';
import {
  detectTaskLoopUpgradeSuggestion,
  startTaskLoopUpgradeRun,
} from '@/pages/Chat/task-loop-upgrade';

describe('detectTaskLoopUpgradeSuggestion', () => {
  it('suggests an explicit Task Loop upgrade for constrained project implementation work', () => {
    const suggestion = detectTaskLoopUpgradeSuggestion({
      text: '请按照顺序修复鉴权矩阵问题，补充单元测试和 e2e，跑 typecheck，失败要修复到通过再继续。',
      sessionId: 'agent:main:main',
    });

    expect(suggestion).toMatchObject({
      kind: 'task-loop-upgrade-suggestion',
      sessionId: 'agent:main:main',
      requiresUserConfirmation: true,
      createsTaskLedgerRoot: true,
      startsRun: 'after-user-confirmation',
    });
    expect(suggestion?.taskTitle).toContain('修复鉴权矩阵问题');
  });

  it('does not suggest Task Loop for ordinary short chat questions', () => {
    const suggestion = detectTaskLoopUpgradeSuggestion({
      text: '解释一下这个函数做什么？',
      sessionId: 'agent:main:main',
    });

    expect(suggestion).toBeNull();
  });
});

describe('startTaskLoopUpgradeRun', () => {
  it('starts task_loop.run with the full confirmed task context', async () => {
    const rpc = vi.fn().mockResolvedValue({
      loop: {
        loopRunId: 'loop-1',
        status: 'running',
      },
    });
    const suggestion = createTaskLoopUpgradeSuggestion({
      sessionId: 'agent:main:main',
      taskTitle: '修复鉴权矩阵问题',
      reason: 'Complex implementation task',
    });

    const result = await startTaskLoopUpgradeRun({
      rpc,
      suggestion,
      taskText: '请按照顺序修复鉴权矩阵问题，补充单元测试和 e2e，跑 typecheck。',
      sessionKey: 'agent:main:main',
      agentId: 'main',
      workspaceId: 'workspace-1',
    });

    expect(rpc).toHaveBeenCalledWith('task_loop.run', {
      task: '请按照顺序修复鉴权矩阵问题，补充单元测试和 e2e，跑 typecheck。',
      sessionKey: 'agent:main:main',
      agentId: 'main',
      workspaceId: 'workspace-1',
    }, 600000);
    expect(result.loopRunId).toBe('loop-1');
    expect(result.status).toBe('running');
  });

  it('surfaces gateway rejection instead of treating ordinary Chat as repaired', async () => {
    const rpc = vi.fn().mockResolvedValue({
      success: false,
      error: 'Task Loop requires approval',
    });
    const suggestion = createTaskLoopUpgradeSuggestion({
      sessionId: 'agent:main:main',
      taskTitle: 'Fix auth matrix',
      reason: 'Complex implementation task',
    });

    await expect(startTaskLoopUpgradeRun({
      rpc,
      suggestion,
      taskText: 'Fix auth matrix with tests',
      sessionKey: 'agent:main:main',
      agentId: 'main',
      workspaceId: null,
    })).rejects.toThrow('Task Loop requires approval');
  });
});
