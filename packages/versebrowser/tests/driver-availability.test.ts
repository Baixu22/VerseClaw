/**
 * P6 回归：驱动启动失败必须区分「依赖缺失（SKIP）」与「真实启动失败（FAIL）」。
 *
 * 最小反例来自实测缺陷：受限进程里 chromium 明明已安装，playwright 抛
 * `browserType.launch: spawn EPERM`，而 `smoke:live` 的旧正则把 `browserType.launch`
 * 也算作「未安装」，于是输出 SKIP、退出码 0 —— 真实故障被记成依赖缺失（SKIP 不算通过）。
 */
import { describe, expect, it } from 'vitest';
import { classifyDriverStartFailure } from '../src/engine/driver-availability.ts';
import { profileFromHostApi, driverSupports } from '../src/engine/driver-profile.ts';

describe('driver start failure classification (P6)', () => {
  it('实测反例：EPERM 启动失败不得判成 SKIP', () => {
    const real =
      'browserType.launch: spawn EPERM\nCall log:\n  - <launching> C:\\ms-playwright\\chromium-1243\\chrome-win\\chrome.exe --headless';
    const verdict = classifyDriverStartFailure(real);
    expect(verdict.verdict).toBe('fail');
    expect(verdict.reason).toContain('真实启动失败');
    expect(verdict.reason).toContain('spawn EPERM');
  });

  it('依赖确实缺失时才 SKIP（可执行文件不存在 / 未安装）', () => {
    for (const message of [
      "Executable doesn't exist at C:\\ms-playwright\\chromium-1243\\chrome-win\\chrome.exe",
      'Please run the following command to download new browsers: npx playwright install chromium',
      'Cannot find module \'electron\'',
    ]) {
      expect(classifyDriverStartFailure(message).verdict, message).toBe('skip');
    }
  });

  it('调用方已确认依赖存在时，连「可执行文件不存在」也判 FAIL', () => {
    const verdict = classifyDriverStartFailure("Executable doesn't exist", {
      dependencyInstalled: true,
    });
    expect(verdict.verdict).toBe('fail');
  });

  it('调用方已确认依赖不存在时可直接 SKIP（无消息也算）', () => {
    expect(classifyDriverStartFailure('', { dependencyInstalled: false }).verdict).toBe('skip');
  });

  it('留出集：另一类真实启动失败模板同样判 FAIL', () => {
    // 这些模板没有参与修复设计，用于确认规则不是只对 EPERM 一条串生效。
    for (const message of [
      'failed to launch electron: app exited with code 1',
      'Target page, context or browser has been closed',
      'Timeout 30000ms exceeded while launching browser',
      'browser has been closed unexpectedly',
    ]) {
      const verdict = classifyDriverStartFailure(message);
      expect(verdict.verdict, message).toBe('fail');
    }
  });

  it('空消息不得被当成 SKIP（没有依据就说依赖缺失是掩盖故障）', () => {
    const verdict = classifyDriverStartFailure('   ');
    expect(verdict.verdict).toBe('fail');
    expect(verdict.reason.length).toBeGreaterThan(0);
  });

  it('调用方层面「真的没有可用驱动」才 SKIP（form 循环扫尾）', () => {
    for (const message of [
      'E_NO_SESSION_API — live tools disabled',
      'no driver available for this workspace',
      'playwright-core unavailable in this environment',
    ]) {
      expect(classifyDriverStartFailure(message).verdict, message).toBe('skip');
    }
  });

  it('facade 创建期的普通异常不得被当成 SKIP（form 循环原来无条件跳过）', () => {
    for (const message of [
      'TypeError: result.facade is not a function',
      'Cannot read properties of undefined (reading "createStandaloneFacade")',
      'unexpected state: session map missing',
    ]) {
      expect(classifyDriverStartFailure(message).verdict, message).toBe('fail');
    }
  });
});

/**
 * TF-0162: a thin driver must not be able to pass in place of a full one.
 *
 * The electron-loop driver declares the whole host-api contract and then refuses most of it:
 * those methods exist but always throw E_NOT_IMPLEMENTED. Counting them as served let one
 * driver stand in for another, which is exactly what the acceptance wording forbids. The profile
 * now separates declared-but-refused methods from what the driver really serves.
 */
describe('thin driver declaration (TF-0162)', () => {
  // Mirror the thin driver's own declaration shape: it wires each refused method straight to
  // notImplemented(name). The profile matches that shape, so the test must use it too.
  function notImplemented(name: string): never {
    const error = new Error(`${name} is not available on the electron-loop driver (Drive is thin).`) as Error & { code?: string };
    error.code = 'E_NOT_IMPLEMENTED';
    throw error;
  }

  it('separates refused methods from served ones', () => {
    const thin = profileFromHostApi({
      vault: () => notImplemented('vault'),
      click: () => notImplemented('click'),
      navigate: async () => ({}),
    });
    const full = profileFromHostApi({ vault: async () => ({}), click: async () => ({}), navigate: async () => ({}) });

    expect(driverSupports(thin, 'vault')).toBe(false);
    expect(driverSupports(thin, 'click')).toBe(false);
    expect(driverSupports(thin, 'navigate')).toBe(true);

    // the same shape on a driver that really serves them stays supported
    expect(driverSupports(full, 'vault')).toBe(true);
    expect(driverSupports(full, 'click')).toBe(true);
    expect([...(full.unavailableMethods ?? [])]).toEqual([]);
    expect([...(thin.unavailableMethods ?? [])].sort()).toEqual(['click', 'vault']);
  });

  it('does not mark a method that merely mentions the code as unavailable', () => {
    // a real implementation may legitimately talk about E_NOT_IMPLEMENTED in its body
    const real = profileFromHostApi({
      click: async () => {
        // surfacing E_NOT_IMPLEMENTED to the caller is normal here
        if (Date.now() < 0) throw Object.assign(new Error('x'), { code: 'E_NOT_IMPLEMENTED' });
        return { ok: true };
      },
    });
    expect(driverSupports(real, 'click')).toBe(true);
  });
});
