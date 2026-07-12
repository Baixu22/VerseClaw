/**
 * 路由 —— 重构自 agent_reach/channels/base.py。
 *
 * Python 的 Channel 类拆成两个纯函数：
 *   - canHandle(url, domains) —— 原 can_handle
 *   - orderedBackends(channel, config) —— 原 ordered_backends（含用户 override）
 *
 * 健康检查的两段式选后端逻辑（先收集 findings，再按 ok→warn 优先级选）
 * 抽成 selectBackend()，所有工具共享。
 */
import type { BackendFinding, HealthStatus } from '../types.js';

/**
 * URL 域名匹配 —— 有意增强版，替代 Python 各 channel 的 can_handle(url) 子串匹配。
 *
 * Python 用 `"v2ex.com" in host`（子串），会误匹配 evilbilibili.com 等钓鱼域。
 * TS 用后缀精确匹配（host === d || host.endsWith('.d')），更安全。
 * 对合法 URL 两者等价，对边缘/攻击域 TS 更严格。这是有意分歧，非对齐缺陷。
 */
export function canHandle(url: string, domains: readonly string[]): boolean {
  const host = safeHostname(url);
  if (!host) return false;
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}

/** 通用兜底：web channel 的 can_handle 永远 true。 */
export const canHandleAny = (_url: string): boolean => true;

/** RSS 风格的 URL 路径匹配 —— 对齐 rss.py 的 can_handle。 */
export function canHandleRss(url: string): boolean {
  const lower = url.toLowerCase();
  return ['/feed', '/rss', '.xml', 'atom'].some((x) => lower.includes(x));
}

export function safeHostname(url: string): string {
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    return u.hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * 有序后端列表，应用用户 override —— 对齐 channels/base.py: ordered_backends。
 *
 * config key `<channel>_backend`（或 env `<CHANNEL>_BACKEND`）把指定后端提到首位；
 * 未知值忽略，避免 stale override 隐藏可用后端。
 */
export function orderedBackends(
  channel: string,
  defaultBackends: readonly string[],
  configGet?: (key: string) => string | undefined,
): string[] {
  const candidates = [...defaultBackends];
  if (!configGet) return candidates;
  const override = configGet(`${channel}_backend`);
  if (!override) return candidates;
  const idx = candidates.findIndex((b) => b === override || b.startsWith(override));
  if (idx <= 0) return candidates; // 未知值忽略；已在首位则不动
  const removed = candidates.splice(idx, 1);
  if (removed[0]) candidates.unshift(removed[0]);
  return candidates;
}

/**
 * 两段式选后端 —— 对齐 channels/twitter.py / xiaohongshu.py / bilibili.py / reddit.py
 * 里反复出现的 findings 收集 + "先 ok 再 warn" 优先级循环。
 *
 * 增强：当选中 ok/warn 后端时，若同时存在 error 状态候选，把 `[备选后端异常]`
 * 处方追加到 message —— 对齐 bilibili.py:62-71 的 broken_notes 增强。
 * 这样 doctor 输出能同时提示"主后端可用 + 断链后端需重装"。
 *
 * @param findings 已收集的后端探测结果（None 已过滤掉）
 * @returns (activeBackend, status, message) 或 undefined（无任何候选）
 */
export function selectBackend(findings: BackendFinding[]): {
  activeBackend: string | undefined;
  status: HealthStatus;
  message: string;
} | undefined {
  if (findings.length === 0) return undefined;
  // 收集 error 状态的处方 —— 对齐 bilibili.py:63 的 broken_notes
  const brokenNotes = findings.filter((f) => f.status === 'error').map((f) => f.message);
  for (const wanted of ['ok', 'warn'] as const) {
    for (const f of findings) {
      if (f.status === wanted) {
        let message = f.message;
        // 追加断链后端处方 —— 对齐 bilibili.py:69-70
        if (brokenNotes.length > 0) {
          message += `\n[备选后端异常] ${brokenNotes.join('；')}`;
        }
        return { activeBackend: f.backend, status: f.status, message };
      }
    }
  }
  // 只剩 error 候选
  return {
    activeBackend: undefined,
    status: 'error',
    message: findings.map((f) => f.message).join('\n'),
  };
}
