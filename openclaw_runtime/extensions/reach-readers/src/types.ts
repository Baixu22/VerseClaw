/**
 * 共享类型 —— 重构自 Agent Reach 的 dataclass 与 channel base。
 */

/** 后端探活结果 —— 对齐 agent_reach/probe.py: ProbeResult。 */
export type ProbeStatus = 'ok' | 'missing' | 'broken' | 'timeout' | 'error';

export interface ProbeResult {
  status: ProbeStatus;
  output: string;
  hint: string;
}

export const probeOk = (r: ProbeResult): boolean => r.status === 'ok';

/** 健康检查状态 —— 对齐 channels/base.py 的 check() 返回。 */
export type HealthStatus = 'ok' | 'warn' | 'off' | 'error';

/** 后端探测结果 —— 对齐 channels/*.py 里 check() 内部的 (backend, status, message)。 */
export interface BackendFinding {
  backend: string;
  status: HealthStatus;
  message: string;
}

/** URL 域名匹配规则。 */
export interface DomainRule {
  /** netloc 子串匹配，如 'github.com'。 */
  domain: string;
}

/** 工具的可用性自报。 */
export interface Availability {
  channel: string;
  status: HealthStatus;
  activeBackend: string | undefined;
  message: string;
}
