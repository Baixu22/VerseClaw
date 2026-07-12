/**
 * Readonly OpenClaw adapter for the imported Agent Reach configuration API.
 *
 * Values are hydrated once at the plugin boundary. Platform readers retain
 * their original synchronous get/isConfigured calling structure.
 */
import {
  resolveConfiguredSecretInputString,
} from 'openclaw/plugin-sdk/secret-input-runtime';

const ENV_BY_KEY: Record<string, string> = {
  xueqiu_cookie: 'XUEQIU_COOKIE',
  twitter_auth_token: 'TWITTER_AUTH_TOKEN',
  twitter_ct0: 'TWITTER_CT0',
};

const DEFAULTS: Record<string, unknown> = {
  browser_fallback: 'auto',
  browser_profile: 'default',
};

const FEATURE_REQUIREMENTS: Record<string, string[]> = {
  exa_search: ['exa_api_key'],
  twitter_xreach: ['twitter_auth_token', 'twitter_ct0'],
  groq_whisper: ['groq_api_key'],
  openai_whisper: ['openai_api_key'],
  github_token: ['github_token'],
};

export class Config {
  private readonly data: Readonly<Record<string, unknown>>;
  private readonly env: Readonly<Record<string, string | undefined>>;

  constructor(options: {
    values?: Readonly<Record<string, unknown>>;
    env?: Readonly<Record<string, string | undefined>>;
  } = {}) {
    this.data = Object.freeze({ ...(options.values ?? {}) });
    this.env = options.env ?? process.env;
  }

  get<T = unknown>(key: string, def?: T): T | undefined {
    if (key in this.data) return this.data[key] as T;
    const envVal = this.env[ENV_BY_KEY[key] ?? key.toUpperCase()];
    if (envVal) return envVal as unknown as T;
    return (DEFAULTS[key] as T | undefined) ?? def;
  }

  isConfigured(feature: string): boolean {
    const required = FEATURE_REQUIREMENTS[feature] ?? [];
    return required.every((key) => Boolean(this.get(key)));
  }

  configuredFeatures(): Record<string, boolean> {
    return Object.fromEntries(
      Object.keys(FEATURE_REQUIREMENTS).map((feature) => [feature, this.isConfigured(feature)]),
    );
  }

  toDict(): Record<string, unknown> {
    const sensitiveMarkers = [
      'key', 'token', 'password', 'proxy', 'cookie', 'secret', 'session',
      'sessdata', 'csrf', 'auth', 'cred', 'ct0',
    ];
    return Object.fromEntries(
      Object.entries(this.data).map(([key, value]) => [
        key,
        sensitiveMarkers.some((marker) => key.toLowerCase().includes(marker))
          ? value ? 'configured' : 'missing'
          : value,
      ]),
    );
  }
}

let config: Config | undefined;

export function getConfig(): Config {
  config ??= new Config();
  return config;
}

export function setConfigSnapshot(values: Readonly<Record<string, unknown>>): void {
  config = new Config({ values });
}

type SecretResolver = typeof resolveConfiguredSecretInputString;

export async function hydrateReachConfig(params: {
  config: Parameters<SecretResolver>[0]['config'];
  pluginConfig?: Readonly<Record<string, unknown>>;
  env?: NodeJS.ProcessEnv;
  resolveSecret?: SecretResolver;
}): Promise<Config> {
  const pluginConfig = params.pluginConfig ?? {};
  const credentials =
    pluginConfig.credentials && typeof pluginConfig.credentials === 'object'
      ? pluginConfig.credentials as Record<string, unknown>
      : {};
  const values: Record<string, unknown> = {
    browser_fallback: pluginConfig.browserFallback,
    browser_profile: pluginConfig.browserProfile,
    bilibili_backends:
      (pluginConfig.backends as Record<string, unknown> | undefined)?.bilibili,
    twitter_backends:
      (pluginConfig.backends as Record<string, unknown> | undefined)?.twitter,
    xiaohongshu_backends:
      (pluginConfig.backends as Record<string, unknown> | undefined)?.xiaohongshu,
  };
  const resolver = params.resolveSecret ?? resolveConfiguredSecretInputString;
  const secretMappings = [
    ['xueqiuCookie', 'xueqiu_cookie'],
    ['twitterAuthToken', 'twitter_auth_token'],
    ['twitterCt0', 'twitter_ct0'],
  ] as const;
  for (const [configKey, snapshotKey] of secretMappings) {
    if (credentials[configKey] === undefined) continue;
    const resolved = await resolver({
      config: params.config,
      env: params.env ?? process.env,
      value: credentials[configKey],
      path: `plugins.entries.reach-readers.config.credentials.${configKey}`,
    });
    if (resolved.value) values[snapshotKey] = resolved.value;
  }
  for (const key of Object.keys(values)) {
    if (values[key] === undefined) delete values[key];
  }
  config = new Config({ values, env: params.env });
  return config;
}
