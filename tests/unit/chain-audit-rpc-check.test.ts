// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  compileExpectError,
  evaluateRpcCheck,
  isAdminGatedMethod,
  validateRpcChecksConfig,
} from '../../scripts/chain-audit/lib/rpc-check.js';

/**
 * Issue #35 — chain-audit 的 RPC 检查面无法表达「预期错误」，也把 fork 探测绑在
 * 共享主会话上，导致 taskloop / fork 两组恒定断裂。
 *
 * 这两组此前是全量审计里唯一的结构性红灯，且红得与 runtime 健康无关——这意味着
 * rpcScore 长期偏低，真实退化反而被噪音盖住。本文件锁住修复后的契约：
 * 配置合法 + 预期错误计通过 + fork 探测不依赖共享会话大小。
 */
const rootDir = process.cwd();

function loadRpcConfig() {
  return JSON.parse(readFileSync(join(rootDir, 'scripts/chain-audit/config/rpc-checks.json'), 'utf8'));
}

function findGroup(config: ReturnType<typeof loadRpcConfig>, id: string) {
  return config.groups.find((g: { id: string }) => g.id === id);
}

describe('chain-audit rpc-checks config (issue #35)', () => {
  it('is structurally valid', () => {
    expect(validateRpcChecksConfig(loadRpcConfig())).toEqual([]);
  });

  it('scores task_loop.status as passing when it reports the expected unknown-loop error', () => {
    const group = findGroup(loadRpcConfig(), 'taskloop');
    expect(group).toBeDefined();

    const check = group.checks.find((c: { method: string }) => c.method === 'task_loop.status');
    expect(check).toBeDefined();
    expect(typeof check.expectError).toBe('string');

    // 真实 gateway 的响应形态：ok=false + error.message。
    const verdict = evaluateRpcCheck({
      result: { ok: false, error: { message: 'unknown task loop "nonexistent-probe"' } },
      check,
    });
    expect(verdict.passed).toBe(true);
    expect(verdict.expectErrorMatched).toBe(true);
  });

  it('still fails task_loop.status when the error is something else', () => {
    const group = findGroup(loadRpcConfig(), 'taskloop');
    const check = group.checks.find((c: { method: string }) => c.method === 'task_loop.status');

    const verdict = evaluateRpcCheck({
      result: { ok: false, error: { message: 'gateway is on fire' } },
      check,
    });
    expect(verdict.passed).toBe(false);
    expect(verdict.expectErrorMatched).toBe(false);
  });

  it('never probes fork against the shared main session', () => {
    const config = loadRpcConfig();
    const group = findGroup(config, 'fork');
    expect(group).toBeDefined();

    const sharedMain = config.sessionKey;
    for (const check of group.checks) {
      // fork 的 source session 必须是专用探测会话：共享主会话随使用增长，
      // 超过 contextWindow 后 fork 必然失败，与 fork 功能健康与否无关（#35）。
      expect(check.params?.key).not.toBe(sharedMain);
    }
  });

  it('creates its own probe session before forking, so the check is self-contained', () => {
    const group = findGroup(loadRpcConfig(), 'fork');
    const methods = group.checks.map((c: { method: string }) => c.method);
    expect(methods[0]).toBe('sessions.create');
    expect(methods).toContain('sessions.fork');
    // fork 的 key 必须与 create 的 key 一致，否则探测的是另一个会话。
    const createdKey = group.checks[0].params.key;
    const forkedKey = group.checks.find((c: { method: string }) => c.method === 'sessions.fork').params.key;
    expect(forkedKey).toBe(createdKey);
  });
});

describe('evaluateRpcCheck', () => {
  it('treats a successful call as passing', () => {
    expect(evaluateRpcCheck({ result: { ok: true } }).passed).toBe(true);
  });

  it('treats an unexpected error as failing', () => {
    const verdict = evaluateRpcCheck({
      result: { ok: false, error: { message: 'boom' } },
      check: { method: 'health' },
    });
    expect(verdict.passed).toBe(false);
    expect(verdict.error).toBe('boom');
  });

  it('treats missing-scope as passing only for adminOnly methods', () => {
    const result = { ok: false, error: { message: 'missing scope: operator.admin' } };
    expect(evaluateRpcCheck({ result, check: {}, adminGated: true }).passed).toBe(true);
    expect(evaluateRpcCheck({ result, check: {}, adminGated: false }).passed).toBe(false);
  });

  it('does not let expectError rescue a call that succeeded', () => {
    // 调用成功说明错误处理路径没被走到——对「验证错误处理」的探测而言这是失败。
    const verdict = evaluateRpcCheck({
      result: { ok: true },
      check: { expectError: 'unknown task loop' },
    });
    expect(verdict.passed).toBe(true);
    expect(verdict.expectErrorMatched).toBe(false);
  });

  it('ignores a blank expectError rather than matching everything', () => {
    expect(compileExpectError('')).toBeNull();
    expect(compileExpectError(undefined)).toBeNull();
    // 空 expectError 不得退化为「匹配任意错误」。
    const verdict = evaluateRpcCheck({
      result: { ok: false, error: { message: 'anything at all' } },
      check: { expectError: '' },
    });
    expect(verdict.passed).toBe(false);
  });

  it('compiles expectError as a case-insensitive literal, not a regex', () => {
    const pattern = compileExpectError('unknown task loop');
    expect(pattern?.test('Unknown Task Loop "x"')).toBe(true);
    // 字面量必须被转义：`.` 不能当通配符用。
    expect(compileExpectError('a.b')?.test('axb')).toBe(false);
    expect(compileExpectError('a.b')?.test('a.b')).toBe(true);
  });
});

describe('isAdminGatedMethod', () => {
  it('matches only methods listed in group.adminOnly', () => {
    const group = { adminOnly: [{ method: 'config.apply' }] };
    expect(isAdminGatedMethod(group, 'config.apply')).toBe(true);
    expect(isAdminGatedMethod(group, 'health')).toBe(false);
  });

  it('is false for groups without an adminOnly list', () => {
    expect(isAdminGatedMethod({ checks: [{ method: 'health' }] }, 'health')).toBe(false);
  });
});

describe('validateRpcChecksConfig', () => {
  it('accepts a minimal well-formed config', () => {
    expect(validateRpcChecksConfig({
      groups: [{ id: 'core', name: '核心', checks: [{ method: 'health', params: {} }] }],
    })).toEqual([]);
  });

  it('rejects a missing groups array', () => {
    expect(validateRpcChecksConfig({})).toContain('config.groups 缺失或不是数组');
  });

  it('rejects a check without a method', () => {
    const problems = validateRpcChecksConfig({ groups: [{ id: 'g', checks: [{ params: {} }] }] });
    expect(problems.some((p: string) => p.includes('method 缺失'))).toBe(true);
  });

  it('rejects a blank expectError, which would silently match nothing', () => {
    const problems = validateRpcChecksConfig({
      groups: [{ id: 'g', checks: [{ method: 'm', expectError: '   ' }] }],
    });
    expect(problems.some((p: string) => p.includes('expectError 必须是非空字符串'))).toBe(true);
  });

  it('rejects duplicate group ids', () => {
    const problems = validateRpcChecksConfig({
      groups: [
        { id: 'dup', checks: [{ method: 'a' }] },
        { id: 'dup', checks: [{ method: 'b' }] },
      ],
    });
    expect(problems.some((p: string) => p.includes('id 重复'))).toBe(true);
  });

  it('rejects a group with no checks at all', () => {
    const problems = validateRpcChecksConfig({ groups: [{ id: 'empty', checks: [] }] });
    expect(problems.some((p: string) => p.includes('没有任何 checks'))).toBe(true);
  });
});
