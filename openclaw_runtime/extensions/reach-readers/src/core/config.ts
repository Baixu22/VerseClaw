/**
 * 配置 —— 重构自 agent_reach/config.py。
 *
 * Python 版用 YAML，shadow 改用 JSON（ClawX 生态更偏好 JSON，迁移时无障碍）。
 * 文件位置 ~/.agent-reach/config.json（与 Python 版同目录，便于共存期读老 key）。
 *
 * 严格对齐 Python 的特性：
 *   - get(key) 先看文件，再看大写 env 变量
 *   - 文件权限 0o600（Windows 跳过 chmod）
 *   - is_configured(feature) 检查 FEATURE_REQUIREMENTS 里的所有 key
 */
import { mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const CONFIG_DIR = path.join(homedir(), '.agent-reach');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

/** Python 版 config.py: FEATURE_REQUIREMENTS —— 完整保留。 */
const FEATURE_REQUIREMENTS: Record<string, string[]> = {
  exa_search: ['exa_api_key'],
  twitter_xreach: ['twitter_auth_token', 'twitter_ct0'],
  groq_whisper: ['groq_api_key'],
  openai_whisper: ['openai_api_key'],
  github_token: ['github_token'],
};

export class Config {
  private data: Record<string, unknown> = {};
  readonly configPath: string;

  constructor(configPath: string = CONFIG_FILE) {
    this.configPath = configPath;
    this.ensureDir();
    this.load();
  }

  private ensureDir(): void {
    try {
      mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
      if (process.platform !== 'win32') chmodSync(CONFIG_DIR, 0o700);
    } catch {
      // ignore —— 只读场景也允许
    }
  }

  load(): void {
    try {
      const text = readFileSync(this.configPath, 'utf8');
      this.data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      this.data = {};
    }
  }

  save(): void {
    try {
      const text = JSON.stringify(this.data, null, 2);
      writeFileSync(this.configPath, text, { mode: 0o600 });
      if (process.platform !== 'win32') chmodSync(this.configPath, 0o600);
    } catch {
      // shadow 版只读不写也能跑
    }
  }

  /** 取值：先文件，再大写 env。对齐 Python get()。 */
  get<T = unknown>(key: string, def?: T): T | undefined {
    if (key in this.data) return this.data[key] as T;
    const envVal = process.env[key.toUpperCase()];
    if (envVal) return envVal as unknown as T;
    return def;
  }

  set(key: string, value: unknown): void {
    this.data[key] = value;
    this.save();
  }

  delete(key: string): void {
    delete this.data[key];
    this.save();
  }

  isConfigured(feature: string): boolean {
    const required = FEATURE_REQUIREMENTS[feature] ?? [];
    return required.every((k) => this.get(k));
  }

  configuredFeatures(): Record<string, boolean> {
    const out: Record<string, boolean> = {};
    for (const f of Object.keys(FEATURE_REQUIREMENTS)) out[f] = this.isConfigured(f);
    return out;
  }

  /**
   * 返回脱敏后的配置 dict —— 对齐 Python config.py:108-129 的 to_dict。
   *
   * 按 sensitive_markers（key/token/password/proxy/cookie/secret/session/
   * sessdata/csrf/auth/cred/ct0）匹配键名，敏感值只保留前 8 字符 + "..."。
   */
  toDict(): Record<string, unknown> {
    const SENSITIVE_MARKERS = [
      'key', 'token', 'password', 'proxy', 'cookie',
      'secret', 'session', 'sessdata', 'csrf', 'auth', 'cred', 'ct0',
    ];
    const masked: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(this.data)) {
      const lowerKey = k.toLowerCase();
      if (SENSITIVE_MARKERS.some((s) => lowerKey.includes(s))) {
        masked[k] = v ? `${String(v).slice(0, 8)}...` : null;
      } else {
        masked[k] = v;
      }
    }
    return masked;
  }
}

/** 单例 —— 供工具按需共享，避免每次 new 都重新读盘。 */
let _config: Config | undefined;
export function getConfig(): Config {
  if (!_config) _config = new Config();
  return _config;
}
