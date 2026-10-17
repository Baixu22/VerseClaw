/**
 * 驱动启动失败的判定：**缺依赖**（可以 SKIP）与**真实启动失败**（必须 FAIL）分开。
 *
 * 背景（P6，实测缺陷）：`smoke:live` 曾把 `/Executable doesn't exist|playwright install|browserType\.launch/`
 * 一律当成「chromium 未安装」→ 输出 SKIP、退出码 0。`browserType.launch` 会命中**任何**启动错误
 * （权限/沙箱/崩溃），于是真实故障被静默记成依赖缺失。SKIP 不算通过，这条错误分类会掩盖失败。
 *
 * 规则：
 * - 只有在**明确**的信号（可执行文件不存在 / 未安装 / 找不到模块）下才判 `skip`；
 * - 调用方已经确认依赖存在（例如 `import('electron')` 成功）时，任何启动错误都判 `fail`；
 * - 其余（含 EPERM/沙箱/崩溃/超时）一律 `fail`，reason 保留原始错误首行，便于追。
 */
export type DriverStartVerdict = 'skip' | 'fail';

export type DriverStartClassification = {
  verdict: DriverStartVerdict;
  reason: string;
};

/** 明确的「依赖没有装 / 起不了驱动」信号；**不包含** `browserType.launch` 这类通用启动错误。 */
export const DRIVER_DEPENDENCY_MISSING_PATTERNS: readonly RegExp[] = [
  /Executable doesn't exist/iu,
  /playwright install/iu,
  /browser is not installed/iu,
  /electron (?:is )?not installed/iu,
  /Cannot find module ['"]electron['"]/iu,
  /ENOENT[^\n]*electron/iu,
  // 调用方层面的「真的没有可用驱动」（standalone 工厂的显式拒码与提示）：
  /E_NO_SESSION_API/iu,
  /no (?:usable )?driver (?:is )?available/iu,
  /driver unavailable/iu,
  /playwright-core (?:is )?unavailable/iu,
];

export function classifyDriverStartFailure(
  message: string,
  options: { dependencyInstalled?: boolean | null } = {},
): DriverStartClassification {
  const text = (message ?? '').trim();
  if (options.dependencyInstalled === false) {
    return { verdict: 'skip', reason: '依赖未安装（调用方已确认）' };
  }
  const normalized = text.toLowerCase();
  const hit = DRIVER_DEPENDENCY_MISSING_PATTERNS.find((pattern) =>
    pattern.test(normalized),
  );
  if (hit && options.dependencyInstalled !== true) {
    return { verdict: 'skip', reason: `依赖缺失信号：${hit.source}` };
  }
  const firstLine = text.length > 0 ? text.split('\n')[0]! : '';
  return {
    verdict: 'fail',
    reason:
      firstLine.length > 0
        ? `真实启动失败（不得记成 SKIP）：${firstLine}`
        : '真实启动失败但没有错误信息（不得记成 SKIP）',
  };
}
