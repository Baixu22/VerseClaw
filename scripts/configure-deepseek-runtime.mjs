#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const appData =
  process.env.APPDATA ||
  path.join(os.homedir(), 'AppData', 'Roaming');
const electronDataDir = path.join(appData, 'Electron');
const providerStorePath = path.join(electronDataDir, 'clawx-providers.json');
const runtimeConfigPath = path.join(electronDataDir, 'openclaw-source-state', 'openclaw.json');

const accountId = process.env.CLAWX_DEEPSEEK_ACCOUNT_ID || 'deepseek';
const providerId = 'deepseek';
const modelId = process.argv[2] || process.env.CLAWX_DEEPSEEK_MODEL || 'deepseek-v4-flash';
const modelRef = modelId.includes('/') ? modelId : `${providerId}/${modelId}`;
const bareModelId = modelRef.slice(modelRef.indexOf('/') + 1);
const baseUrl = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1';
const apiKey = process.env.DEEPSEEK_API_KEY || process.env.CLAWX_DEEPSEEK_API_KEY;

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return structuredClone(fallback);
    throw error;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, filePath);
}

function uniqueModels(models, id) {
  const list = Array.isArray(models) ? models.filter((entry) => entry && typeof entry === 'object') : [];
  const filtered = list.filter((entry) => entry.id !== id);
  return [{ id, name: id }, ...filtered];
}

function configureProviderStore() {
  const now = new Date().toISOString();
  const store = readJson(providerStorePath, {
    schemaVersion: 2,
    providers: {},
    providerAccounts: {},
    apiKeys: {},
    providerSecrets: {},
    defaultProvider: null,
    defaultProviderAccountId: null,
  });
  store.schemaVersion = 2;
  store.providers = store.providers && typeof store.providers === 'object' ? store.providers : {};
  store.providerAccounts =
    store.providerAccounts && typeof store.providerAccounts === 'object'
      ? store.providerAccounts
      : {};
  store.apiKeys = store.apiKeys && typeof store.apiKeys === 'object' ? store.apiKeys : {};
  store.providerSecrets =
    store.providerSecrets && typeof store.providerSecrets === 'object'
      ? store.providerSecrets
      : {};

  const previous = store.providerAccounts[accountId] || {};
  store.providerAccounts[accountId] = {
    id: accountId,
    vendorId: providerId,
    label: previous.label || 'DeepSeek',
    authMode: 'api_key',
    baseUrl,
    apiProtocol: 'openai-completions',
    model: modelRef,
    enabled: true,
    isDefault: true,
    createdAt: previous.createdAt || now,
    updatedAt: now,
  };
  for (const account of Object.values(store.providerAccounts)) {
    if (account && typeof account === 'object') {
      account.isDefault = account.id === accountId;
    }
  }
  if (apiKey) {
    store.apiKeys[accountId] = apiKey.trim();
  }
  store.defaultProvider = providerId;
  store.defaultProviderAccountId = accountId;
  writeJson(providerStorePath, store);
}

function configureRuntime() {
  const config = readJson(runtimeConfigPath, {});
  config.gateway = config.gateway && typeof config.gateway === 'object' ? config.gateway : {};
  config.gateway.mode ||= 'local';
  config.gateway.controlUi = config.gateway.controlUi && typeof config.gateway.controlUi === 'object'
    ? config.gateway.controlUi
    : { enabled: false };

  config.update = config.update && typeof config.update === 'object' ? config.update : {};
  config.update.checkOnStart = false;

  config.agents = config.agents && typeof config.agents === 'object' ? config.agents : {};
  config.agents.defaults =
    config.agents.defaults && typeof config.agents.defaults === 'object' ? config.agents.defaults : {};
  config.agents.defaults.model = { primary: modelRef, fallbacks: [] };
  config.agents.defaults.sandbox ||= {
    mode: 'off',
    backend: 'openshell',
    scope: 'session',
    workspaceAccess: 'none',
  };
  config.agents.list = Array.isArray(config.agents.list) ? config.agents.list : [];
  if (config.agents.list.length === 0) {
    config.agents.list.push({
      id: 'main',
      name: 'Main Agent',
      default: true,
      workspace: '~/.openclaw/workspace',
      agentDir: '~/.openclaw/agents/main/agent',
      thinkingDefault: 'low',
      sandbox: { mode: 'off' },
    });
  }
  for (const agent of config.agents.list) {
    if (!agent || typeof agent !== 'object') continue;
    agent.model = { ...(agent.model && typeof agent.model === 'object' ? agent.model : {}), primary: modelRef };
    agent.sandbox ||= { mode: 'off' };
    delete agent.reasoningEffort;
  }

  config.models = config.models && typeof config.models === 'object' ? config.models : {};
  config.models.providers =
    config.models.providers && typeof config.models.providers === 'object'
      ? config.models.providers
      : {};
  const provider = config.models.providers[providerId] || {};
  config.models.providers[providerId] = {
    ...provider,
    baseUrl,
    api: 'openai-completions',
    models: uniqueModels(provider.models, bareModelId),
    ...(apiKey ? { apiKey: apiKey.trim() } : {}),
  };

  config.plugins = config.plugins && typeof config.plugins === 'object' ? config.plugins : {};
  config.plugins.entries =
    config.plugins.entries && typeof config.plugins.entries === 'object' ? config.plugins.entries : {};
  config.plugins.entries.deepseek = { ...(config.plugins.entries.deepseek || {}), enabled: true };
  config.channels = config.channels && typeof config.channels === 'object' ? config.channels : {};

  // SEKB/shadow stay opt-in: DeepSeek setup must not force capture flags on.
  // Pass --enable-sekb-shadow to enable master+shadow for local A.5 capture.
  const enableSekbShadow = process.argv.includes('--enable-sekb-shadow');
  let sekbEnabled = null;
  let shadowEnabled = null;
  if (enableSekbShadow) {
    config.runtime = config.runtime && typeof config.runtime === 'object' ? config.runtime : {};
    config.runtime.contextBlock =
      config.runtime.contextBlock && typeof config.runtime.contextBlock === 'object'
        ? config.runtime.contextBlock
        : {};
    const previousSekb =
      config.runtime.contextBlock.sekb && typeof config.runtime.contextBlock.sekb === 'object'
        ? config.runtime.contextBlock.sekb
        : {};
    config.runtime.contextBlock.sekb = {
      ...previousSekb,
      enabled: true,
      shadowEvaluation: { enabled: true },
    };
    sekbEnabled = true;
    shadowEnabled = true;
  }
  writeJson(runtimeConfigPath, config);
  return { sekbEnabled, shadowEnabled, enableSekbShadow };
}

configureProviderStore();
const sekbResult = configureRuntime();

console.log(JSON.stringify({
  ok: true,
  provider: providerId,
  accountId,
  modelRef,
  providerStorePath,
  runtimeConfigPath,
  apiKeySource: apiKey ? 'environment-or-existing-script-input' : 'not-set-by-script',
  sekbShadowOptIn: Boolean(sekbResult?.enableSekbShadow),
  sekbEnabled: sekbResult?.sekbEnabled,
  shadowEvaluationEnabled: sekbResult?.shadowEnabled,
  note: sekbResult?.enableSekbShadow
    ? 'SEKB master + shadowEvaluation enabled via --enable-sekb-shadow'
    : 'SEKB flags left unchanged (pass --enable-sekb-shadow to enable local A.5 capture)',
}, null, 2));
