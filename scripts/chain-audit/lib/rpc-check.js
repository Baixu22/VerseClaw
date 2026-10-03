#!/usr/bin/env node
/**
 * RPC 检查面判定逻辑（scripts/chain-audit/config/rpc-checks.json 的执行契约）
 *
 * 抽成独立模块的原因（issue #35）：判定规则原本内联在 run-chain-audit.mjs 里，
 * 无法在不启动真实 gateway 的情况下验证。而 #35 的两组失败恰恰要求「预期错误算通过」
 * 这条规则本身可被测试——否则配置改对了也没人能证明它对。
 *
 * 本模块是纯函数：不 import ws、不碰网络、不读环境变量，可直接在 vitest 中调用。
 */

/** 非空字符串 → 大小写不敏感的字面量正则；其余情况返回 null。 */
export function compileExpectError(expectError) {
  if (typeof expectError !== "string" || expectError.length === 0) return null;
  return new RegExp(expectError.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
}

/** 该方法是否属于组内的 adminOnly 白名单（此类方法预期返回 missing scope）。 */
export function isAdminGatedMethod(group, method) {
  if (!group || !Array.isArray(group.adminOnly)) return false;
  return group.adminOnly.some((entry) => entry && entry.method === method);
}

/**
 * 判定单次 RPC 调用是否通过。
 *
 * 三条通过路径，按 #35 的语义各自独立：
 *  1. 调用本身成功；
 *  2. adminOnly 方法因缺少 scope 被拒——这是预期行为，不是故障；
 *  3. check.expectError 命中错误文本——该探测的目的就是验证错误处理路径，
 *     报这个错恰恰说明错误处理生效（#35 的 taskloop 组）。
 *
 * @param {object} args
 * @param {{ ok?: boolean, error?: { message?: string } }} args.result RpcClient.call 的返回
 * @param {{ expectError?: string }} [args.check] rpc-checks.json 中该条检查的定义
 * @param {boolean} [args.adminGated] 该检查是否属于 group.adminOnly
 */
export function evaluateRpcCheck({ result, check = {}, adminGated = false }) {
  const errorText = result?.error?.message ?? "";
  const okFromResult = result?.ok === true;
  const adminGatedPass = adminGated && /missing scope/.test(errorText);

  const expectErrorPattern = compileExpectError(check.expectError);
  const expectErrorMatched = Boolean(
    expectErrorPattern && !okFromResult && expectErrorPattern.test(errorText),
  );

  const ok = okFromResult || adminGatedPass || expectErrorMatched;
  return {
    ok,
    passed: ok,
    adminGated: adminGated && !okFromResult,
    expectErrorMatched,
    error: okFromResult ? undefined : errorText.slice(0, 100),
  };
}

/**
 * 配置合法性校验。返回问题描述数组，空数组表示配置合法。
 * 目的是让「配置写错」在启动审计前就暴露，而不是等跑完 31 组看到一堆无意义红灯。
 */
export function validateRpcChecksConfig(config) {
  const problems = [];
  if (!config || typeof config !== "object") {
    return ["配置根节点不是对象"];
  }
  if (!Array.isArray(config.groups)) {
    return ["config.groups 缺失或不是数组"];
  }

  const seenGroupIds = new Set();
  config.groups.forEach((group, groupIndex) => {
    const where = `groups[${groupIndex}]`;
    if (!group || typeof group !== "object") {
      problems.push(`${where} 不是对象`);
      return;
    }
    if (typeof group.id !== "string" || group.id.length === 0) {
      problems.push(`${where}.id 缺失`);
    } else {
      if (seenGroupIds.has(group.id)) problems.push(`${where}.id 重复: ${group.id}`);
      seenGroupIds.add(group.id);
    }

    const checks = [
      ...(Array.isArray(group.checks) ? group.checks : []),
      ...(Array.isArray(group.adminOnly) ? group.adminOnly : []),
    ];
    if (checks.length === 0) {
      problems.push(`${where} (${group.id ?? "?"}) 没有任何 checks`);
    }
    checks.forEach((check, checkIndex) => {
      const at = `${where}.checks[${checkIndex}]`;
      if (!check || typeof check !== "object") {
        problems.push(`${at} 不是对象`);
        return;
      }
      if (typeof check.method !== "string" || check.method.length === 0) {
        problems.push(`${at}.method 缺失`);
      }
      if (check.expectError !== undefined) {
        if (typeof check.expectError !== "string" || check.expectError.trim().length === 0) {
          problems.push(`${at}.expectError 必须是非空字符串（当前: ${JSON.stringify(check.expectError)}）`);
        } else {
          try {
            compileExpectError(check.expectError);
          } catch (error) {
            problems.push(`${at}.expectError 无法编译为正则: ${error.message}`);
          }
        }
      }
    });
  });

  return problems;
}
