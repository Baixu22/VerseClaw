import { spawnSync } from 'node:child_process';
import { app } from 'electron';
import path from 'path';
import { existsSync, readFileSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { join } from 'path';

function fsPath(filePath: string): string {
  if (process.platform !== 'win32') return filePath;
  if (!filePath) return filePath;
  if (filePath.startsWith('\\\\?\\')) return filePath;
  const windowsPath = filePath.replace(/\//g, '\\');
  if (!path.win32.isAbsolute(windowsPath)) return windowsPath;
  if (windowsPath.startsWith('\\\\')) {
    return `\\\\?\\UNC\\${windowsPath.slice(2)}`;
  }
  return `\\\\?\\${windowsPath}`;
}
import { getAllSettings } from '../utils/store';
import { getAllProviders, getApiKey, getDefaultProvider, getProvider } from '../utils/secure-storage';
import { getProviderEnvVar, getKeyableProviderTypes } from '../utils/provider-registry';
import {
  getMultiInstanceProviderApiKeyEnvVar,
  getOpenClawProviderKeyForType,
  isMultiInstanceProviderType,
} from '../utils/provider-keys';
import {
  getOpenClawConfigDir,
  getOpenClawDir,
  getOpenClawEntryPath,
  getOpenClawRuntimeDir,
  getOpenClawRuntimeEntryPath,
  getOpenClawRuntimeTsxCliPath,
  getOpenClawResolvedDir,
  getOpenClawSkillsDir,
  isOpenClawRuntimeEnabled,
  isOpenClawPresent,
} from '../utils/paths';
import { getUvMirrorEnv } from '../utils/uv-env';
import { cleanupDanglingWeChatPluginState, listConfiguredChannelsFromConfig, readOpenClawConfig } from '../utils/channel-config';
import { sanitizeOpenClawConfig, batchSyncConfigFields } from '../utils/openclaw-auth';
import { buildProxyEnv, resolveProxySettings } from '../utils/proxy';
import { syncProxyConfigToOpenClaw } from '../utils/openclaw-proxy';
import { logger } from '../utils/logger';
import { applyDcsProdFlagsToGatewayEnv } from '../utils/dcs-prod-flags-env';
import {
  VERSESHELL_DEV_OVERRIDE_FLAG,
  VERSESHELL_DEV_OVERRIDE_PATH,
  buildVerseShellRuntimeEnv,
  resolveVerseShellRuntimeForLaunch,
} from '../utils/verseshell-runtime-bundle';
import { prependPathEntry } from '../utils/env-path';
import { copyPluginFromNodeModules, fixupPluginManifest, cpSyncSafe, buildCandidateSources } from '../utils/plugin-install';
import { VERSE_CLAW_OPENAI_IMAGE_PROVIDER_KEY } from '../utils/openclaw-image-relay-constants';
import { stripSystemdSupervisorEnv } from './config-sync-env';
import { cleanupAgentsSymlinkedSkills, cleanupStalePluginRuntimeDeps } from './skills-symlink-cleanup';
import { resolveMcpServersForContext } from '../services/mcp-api';
import { getActiveWorkspaceProfile } from '../services/workspaces-api';
import { syncDefaultProviderToRuntime } from '../services/providers/provider-runtime-sync';
import {
  buildPrelaunchMaintenanceCacheKey,
  directoryChildrenSignature,
  pathSignature,
  runCachedPrelaunchMaintenanceTask,
  type PrelaunchMaintenanceRunResult,
  type PrelaunchMaintenanceTaskName,
} from './prelaunch-maintenance-cache';


export interface GatewayLaunchContext {
  appSettings: Awaited<ReturnType<typeof getAllSettings>>;
  openclawDir: string;
  entryScript: string;
  entryScriptArgs: string[];
  execArgv: string[];
  gatewayArgs: string[];
  forkEnv: Record<string, string | undefined>;
  mode: 'dev' | 'packaged';
  runtimeMode: 'npm' | 'source';
  binPathExists: boolean;
  loadedProviderKeyCount: number;
  proxySummary: string;
  channelStartupSummary: string;
}

export interface GatewayPrelaunchSyncSummary {
  timingsMs: Record<string, number>;
  maintenance: Partial<Record<PrelaunchMaintenanceTaskName, PrelaunchMaintenanceRunResult>>;
  configuredChannels: string[];
}

// ── Auto-upgrade bundled plugins on startup ──────────────────────

const CHANNEL_PLUGIN_MAP: Record<string, { dirName: string; npmName: string }> = {
  dingtalk: { dirName: 'dingtalk', npmName: '@soimy/dingtalk' },
  wecom: { dirName: 'wecom', npmName: '@wecom/wecom-openclaw-plugin' },
  feishu: { dirName: 'feishu-openclaw-plugin', npmName: '@larksuite/openclaw-lark' },
  discord: { dirName: 'discord', npmName: '@openclaw/discord' },
  qqbot: { dirName: 'qqbot', npmName: '@openclaw/qqbot' },
  whatsapp: { dirName: 'whatsapp', npmName: '@openclaw/whatsapp' },

  'openclaw-weixin': { dirName: 'openclaw-weixin', npmName: '@tencent-weixin/openclaw-weixin' },
  [VERSE_CLAW_OPENAI_IMAGE_PROVIDER_KEY]: { dirName: VERSE_CLAW_OPENAI_IMAGE_PROVIDER_KEY, npmName: 'clawx-openai-image-plugin' },
};

/**
 * OpenClaw 3.22+ ships Discord, Telegram, and other channels as built-in
 * extensions.  If a previous Verse Claw version copied one of these into
 * ~/.openclaw/extensions/, the broken copy overrides the working built-in
 * plugin and must be removed.
 */
const BUILTIN_CHANNEL_EXTENSIONS = ['discord', 'telegram', 'qqbot'];

function cleanupStaleBuiltInExtensions(): void {
  for (const ext of BUILTIN_CHANNEL_EXTENSIONS) {
    const extDir = join(getOpenClawConfigDir(), 'extensions', ext);
    if (existsSync(fsPath(extDir))) {
      logger.info(`[plugin] Removing stale built-in extension copy: ${ext}`);
      try {
        rmSync(fsPath(extDir), { recursive: true, force: true });
      } catch (err) {
        logger.warn(`[plugin] Failed to remove stale extension ${ext}:`, err);
      }
    }
  }
}

function readPluginVersion(pkgJsonPath: string): string | null {
  try {
    const raw = readFileSync(fsPath(pkgJsonPath), 'utf-8');
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? null;
  } catch {
    return null;
  }
}

function measureSync<T>(timings: Record<string, number>, key: string, fn: () => T): T {
  const startedAt = Date.now();
  try {
    return fn();
  } finally {
    timings[key] = Date.now() - startedAt;
  }
}

async function measureAsync<T>(timings: Record<string, number>, key: string, fn: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  try {
    return await fn();
  } finally {
    timings[key] = Date.now() - startedAt;
  }
}

function appVersionForCache(): string {
  try {
    return app.getVersion();
  } catch {
    return 'unknown';
  }
}

/**
 * Auto-upgrade all configured channel plugins before Gateway start.
 * - Packaged mode: uses bundled plugins from resources/ (includes deps)
 * - Dev mode: falls back to node_modules/ with pnpm-aware dep collection
 */
function ensureConfiguredPluginsUpgraded(configuredChannels: string[]): boolean {
  let succeeded = true;
  for (const channelType of configuredChannels) {
    const pluginInfo = CHANNEL_PLUGIN_MAP[channelType];
    if (!pluginInfo) continue;
    const { dirName, npmName } = pluginInfo;

    const targetDir = join(getOpenClawConfigDir(), 'extensions', dirName);
    const targetManifest = join(targetDir, 'openclaw.plugin.json');
    const isInstalled = existsSync(fsPath(targetManifest));
    const installedVersion = isInstalled ? readPluginVersion(join(targetDir, 'package.json')) : null;

    // Try bundled sources first (packaged mode or if bundle-plugins was run)
    const bundledSources = buildCandidateSources(dirName);
    const bundledDir = bundledSources.find((dir) => existsSync(fsPath(join(dir, 'openclaw.plugin.json'))));

    if (bundledDir) {
      const sourceVersion = readPluginVersion(join(bundledDir, 'package.json'));
      // Install or upgrade if version differs or plugin not installed
      if (!isInstalled || (sourceVersion && installedVersion && sourceVersion !== installedVersion)) {
        logger.info(`[plugin] ${isInstalled ? 'Auto-upgrading' : 'Installing'} ${channelType} plugin${isInstalled ? `: ${installedVersion} → ${sourceVersion}` : `: ${sourceVersion}`} (bundled)`);
        try {
          mkdirSync(fsPath(join(getOpenClawConfigDir(), 'extensions')), { recursive: true });
          rmSync(fsPath(targetDir), { recursive: true, force: true });
          cpSyncSafe(bundledDir, targetDir);
          fixupPluginManifest(targetDir);
        } catch (err) {
          logger.warn(`[plugin] Failed to ${isInstalled ? 'auto-upgrade' : 'install'} ${channelType} plugin:`, err);
          succeeded = false;
        }
      } else if (isInstalled) {
        // Same version already installed — still patch manifest ID in case it was
        // never corrected (e.g. installed before MANIFEST_ID_FIXES included this plugin).
        fixupPluginManifest(targetDir);
      }
      continue;
    }

    // Dev mode fallback: copy from node_modules/ with pnpm dep resolution
    if (!app.isPackaged) {
      const npmPkgPath = join(process.cwd(), 'node_modules', ...npmName.split('/'));
      if (!existsSync(fsPath(join(npmPkgPath, 'openclaw.plugin.json')))) continue;
      const sourceVersion = readPluginVersion(join(npmPkgPath, 'package.json'));
      if (!sourceVersion) continue;
      // Skip only if installed AND same version — but still patch manifest ID.
      if (isInstalled && installedVersion && sourceVersion === installedVersion) {
        fixupPluginManifest(targetDir);
        continue;
      }

      logger.info(`[plugin] ${isInstalled ? 'Auto-upgrading' : 'Installing'} ${channelType} plugin${isInstalled ? `: ${installedVersion} → ${sourceVersion}` : `: ${sourceVersion}`} (dev/node_modules)`);

      try {
        mkdirSync(fsPath(join(getOpenClawConfigDir(), 'extensions')), { recursive: true });
        copyPluginFromNodeModules(npmPkgPath, targetDir, npmName);
        fixupPluginManifest(targetDir);
      } catch (err) {
        logger.warn(`[plugin] Failed to ${isInstalled ? 'auto-upgrade' : 'install'} ${channelType} plugin from node_modules:`, err);
        succeeded = false;
      }
    }
  }
  return succeeded;
}

/**
 * Remove channel plugin extensions from ~/.openclaw/extensions/ when their
 * corresponding channel is no longer configured.  This prevents the Gateway
 * from scanning residual plugin manifests that were installed by a previous
 * configuration but are no longer needed.
 */
function cleanupUnconfiguredChannelPlugins(configuredChannels: string[]): boolean {
  let succeeded = true;
  const configuredSet = new Set(configuredChannels);

  for (const [channelType, pluginInfo] of Object.entries(CHANNEL_PLUGIN_MAP)) {
    if (configuredSet.has(channelType)) continue;

    const { dirName } = pluginInfo;
    const targetDir = join(getOpenClawConfigDir(), 'extensions', dirName);
    if (!existsSync(fsPath(targetDir))) continue;

    logger.info(`[plugin] Removing unconfigured channel plugin: ${channelType} (${dirName})`);
    try {
      rmSync(fsPath(targetDir), { recursive: true, force: true });
    } catch (err) {
      logger.warn(`[plugin] Failed to remove unconfigured channel plugin ${channelType}:`, err);
      succeeded = false;
    }
  }
  return succeeded;
}

function resolveImageGenerationPrimary(config: unknown): string | null {
  if (!config || typeof config !== 'object') return null;
  const agents = (config as { agents?: unknown }).agents;
  if (!agents || typeof agents !== 'object') return null;
  const defaults = (agents as { defaults?: unknown }).defaults;
  if (!defaults || typeof defaults !== 'object') return null;
  const imageGenerationModel = (defaults as { imageGenerationModel?: unknown }).imageGenerationModel;
  if (typeof imageGenerationModel === 'string') return imageGenerationModel.trim() || null;
  if (imageGenerationModel && typeof imageGenerationModel === 'object') {
    const primary = (imageGenerationModel as { primary?: unknown }).primary;
    return typeof primary === 'string' && primary.trim() ? primary.trim() : null;
  }
  return null;
}

function withConfiguredImageGenerationPlugins(configuredChannels: string[], rawConfig: unknown): string[] {
  const next = [...configuredChannels];
  const primary = resolveImageGenerationPrimary(rawConfig);
  const provider = primary?.includes('/') ? primary.slice(0, primary.indexOf('/')).trim() : primary;
  if (provider === VERSE_CLAW_OPENAI_IMAGE_PROVIDER_KEY && !next.includes(VERSE_CLAW_OPENAI_IMAGE_PROVIDER_KEY)) {
    next.push(VERSE_CLAW_OPENAI_IMAGE_PROVIDER_KEY);
  }
  return next;
}

function buildPluginSourceSignatures(configuredChannels: string[]): Record<string, unknown> {
  const signatures: Record<string, unknown> = {};
  for (const channelType of [...configuredChannels].sort()) {
    const pluginInfo = CHANNEL_PLUGIN_MAP[channelType];
    if (!pluginInfo) continue;
    const bundledSources = buildCandidateSources(pluginInfo.dirName);
    const bundledDir = bundledSources.find((dir) => existsSync(fsPath(join(dir, 'openclaw.plugin.json'))));
    const devPkgPath = join(process.cwd(), 'node_modules', ...pluginInfo.npmName.split('/'));
    const sourceDir = bundledDir || (!app.isPackaged ? devPkgPath : '');
    signatures[channelType] = sourceDir
      ? {
        sourceDir,
        manifest: pathSignature(join(sourceDir, 'openclaw.plugin.json')),
        packageJson: pathSignature(join(sourceDir, 'package.json')),
      }
      : 'missing';
  }
  return signatures;
}

function buildPluginMaintenanceCacheKey(openclawDir: string, configuredChannels: string[]): string {
  return buildPrelaunchMaintenanceCacheKey({
    task: 'plugin-maintenance',
    appVersion: appVersionForCache(),
    openclawDir,
    cwd: process.cwd(),
    configuredChannels: [...configuredChannels].sort(),
    extensionsDir: directoryChildrenSignature(join(getOpenClawConfigDir(), 'extensions')),
    sourceSignatures: buildPluginSourceSignatures(configuredChannels),
  });
}

function buildSkillsSymlinkCleanupCacheKey(openclawDir: string): string {
  const workspaceSkillsDir = join(getOpenClawConfigDir(), 'workspace', 'skills');
  return buildPrelaunchMaintenanceCacheKey({
    task: 'skills-symlink-cleanup',
    appVersion: appVersionForCache(),
    openclawDir,
    skillsDir: getOpenClawSkillsDir(),
    skillsDirSignature: directoryChildrenSignature(getOpenClawSkillsDir()),
    workspaceSkillsDir,
    workspaceSkillsDirSignature: directoryChildrenSignature(workspaceSkillsDir),
  });
}

function buildRuntimeDepsCleanupCacheKey(openclawDir: string): string {
  const runtimeDepsDir = join(getOpenClawConfigDir(), 'plugin-runtime-deps');
  return buildPrelaunchMaintenanceCacheKey({
    task: 'runtime-deps-cleanup',
    appVersion: appVersionForCache(),
    openclawDir,
    currentOpenClawDir: getOpenClawResolvedDir(),
    runtimeDepsDir,
    runtimeDepsDirSignature: directoryChildrenSignature(runtimeDepsDir),
  });
}

/**
 * Ensure extension-specific packages are resolvable from shared dist/ chunks.
 *
 * OpenClaw's Rollup bundler creates shared chunks in dist/ (e.g.
 * sticker-cache-*.js) that eagerly `import "grammy"`.  ESM bare specifier
 * resolution walks from the importing file's directory upward:
 *   dist/node_modules/ → openclaw/node_modules/ → …
 * It does NOT search `dist/extensions/telegram/node_modules/`.
 *
 * NODE_PATH only works for CJS require(), NOT for ESM import statements.
 *
 * Fix: create symlinks in openclaw/node_modules/ pointing to packages in
 * dist/extensions/<ext>/node_modules/.  This makes the standard ESM
 * resolution algorithm find them.  Skip-if-exists avoids overwriting
 * openclaw's own deps (they take priority).
 */
let _extensionDepsLinked = false;

/**
 * Reset the extension-deps-linked cache so the next
 * ensureExtensionDepsResolvable() call re-scans and links.
 * Called before each Gateway launch to pick up newly installed extensions.
 */
export function resetExtensionDepsLinked(): void {
  _extensionDepsLinked = false;
}

function ensureExtensionDepsResolvable(openclawDir: string): void {
  if (_extensionDepsLinked) return;

  const extDir = join(openclawDir, 'dist', 'extensions');
  const topNM = join(openclawDir, 'node_modules');
  let linkedCount = 0;

  try {
    if (!existsSync(extDir)) return;

    for (const ext of readdirSync(extDir, { withFileTypes: true })) {
      if (!ext.isDirectory()) continue;
      const extNM = join(extDir, ext.name, 'node_modules');
      if (!existsSync(extNM)) continue;

      for (const pkg of readdirSync(extNM, { withFileTypes: true })) {
        if (pkg.name === '.bin') continue;

        if (pkg.name.startsWith('@')) {
          // Scoped package — iterate sub-entries
          const scopeDir = join(extNM, pkg.name);
          let scopeEntries;
          try { scopeEntries = readdirSync(scopeDir, { withFileTypes: true }); } catch { continue; }
          for (const sub of scopeEntries) {
            if (!sub.isDirectory()) continue;
            const dest = join(topNM, pkg.name, sub.name);
            if (existsSync(dest)) continue;
            try {
              mkdirSync(join(topNM, pkg.name), { recursive: true });
              symlinkSync(join(scopeDir, sub.name), dest);
              linkedCount++;
            } catch { /* skip on error — non-fatal */ }
          }
        } else {
          const dest = join(topNM, pkg.name);
          if (existsSync(dest)) continue;
          try {
            mkdirSync(topNM, { recursive: true });
            symlinkSync(join(extNM, pkg.name), dest);
            linkedCount++;
          } catch { /* skip on error — non-fatal */ }
        }
      }
    }
  } catch {
    // extensions dir may not exist or be unreadable — non-fatal
  }

  if (linkedCount > 0) {
    logger.info(`[extension-deps] Linked ${linkedCount} extension packages into ${topNM}`);
  }

  _extensionDepsLinked = true;
}

// ── Pre-launch sync ──────────────────────────────────────────────

export async function syncGatewayConfigBeforeLaunch(
  appSettings: Awaited<ReturnType<typeof getAllSettings>>,
  openclawDir: string,
): Promise<GatewayPrelaunchSyncSummary> {
  const timingsMs: Record<string, number> = {};
  const maintenance: GatewayPrelaunchSyncSummary['maintenance'] = {};
  let configuredChannels: string[] = [];

  // Reset the extension-deps cache so that newly installed extensions
  // (e.g. user added a channel while the app was running) get their
  // node_modules linked on the next Gateway spawn.
  resetExtensionDepsLinked();

  await measureAsync(timingsMs, 'proxySyncMs', async () => {
    await syncProxyConfigToOpenClaw(appSettings, { preserveExistingWhenDisabled: true });
  });

  try {
    await measureAsync(timingsMs, 'sanitizeMs', sanitizeOpenClawConfig);
  } catch (err) {
    logger.warn('Failed to sanitize openclaw.json:', err);
  }

  try {
    await measureAsync(timingsMs, 'wechatStateCleanupMs', cleanupDanglingWeChatPluginState);
  } catch (err) {
    logger.warn('Failed to clean dangling WeChat plugin state before launch:', err);
  }

  // Remove stale copies of built-in extensions (Discord, Telegram) that
  // override OpenClaw's working built-in plugins and break channel loading.
  try {
    measureSync(timingsMs, 'staleBuiltinExtensionCleanupMs', cleanupStaleBuiltInExtensions);
  } catch (err) {
    logger.warn('Failed to clean stale built-in extensions:', err);
  }

  // Remove stray symlinks under ~/.openclaw/skills whose realpath resolves
  // inside ~/.agents/skills.  OpenClaw's hardened skill loader rejects these
  // on every launch (reason=symlink-escape) and the underlying skills are
  // still discovered via the agents-skills-personal source, so the symlinks
  // are pure log noise.  Transitional workaround for openclaw/openclaw#59219.
  try {
    const result = measureSync(timingsMs, 'skillsCleanupMs', () => runCachedPrelaunchMaintenanceTask(
      'skills-symlink-cleanup',
      () => buildSkillsSymlinkCleanupCacheKey(openclawDir),
      () => (cleanupAgentsSymlinkedSkills().failed ?? 0) === 0,
    ));
    maintenance['skills-symlink-cleanup'] = result;
  } catch (err) {
    logger.warn('Failed to clean .agents/skills-targeted skill symlinks:', err);
  }

  // Remove stale OpenClaw runtime-deps cache roots that point at an older
  // worktree/package.  Those symlink trees can make Gateway plugin setup spend
  // a long time in synchronous fs.open/copy calls before the RPC router is
  // responsive.
  try {
    const result = measureSync(timingsMs, 'runtimeDepsCleanupMs', () => runCachedPrelaunchMaintenanceTask(
      'runtime-deps-cleanup',
      () => buildRuntimeDepsCleanupCacheKey(openclawDir),
      () => (cleanupStalePluginRuntimeDeps().failed ?? 0) === 0,
    ));
    maintenance['runtime-deps-cleanup'] = result;
  } catch (err) {
    logger.warn('Failed to clean stale OpenClaw plugin runtime deps:', err);
  }

  // Auto-upgrade installed plugins before Gateway starts so that
  // the plugin manifest ID matches what sanitize wrote to the config.
  // Only install/upgrade plugins for channels that are actually configured
  // in openclaw.json — do NOT expand the list from plugins.allow.
  try {
    configuredChannels = await measureAsync(timingsMs, 'configuredChannelsMs', async () => {
      const rawCfg = await readOpenClawConfig();
      return withConfiguredImageGenerationPlugins(
        await listConfiguredChannelsFromConfig(rawCfg),
        rawCfg,
      );
    });

    const result = measureSync(timingsMs, 'pluginMaintenanceMs', () => runCachedPrelaunchMaintenanceTask(
      'plugin-maintenance',
      () => buildPluginMaintenanceCacheKey(openclawDir, configuredChannels),
      () => {
        const upgradeOk = ensureConfiguredPluginsUpgraded(configuredChannels);
        const cleanupOk = cleanupUnconfiguredChannelPlugins(configuredChannels);
        return upgradeOk && cleanupOk;
      },
    ));
    maintenance['plugin-maintenance'] = result;
  } catch (err) {
    logger.warn('Failed to auto-upgrade plugins:', err);
  }

  // Batch gateway token, browser config, and session idle into one read+write cycle.
  try {
    await measureAsync(timingsMs, 'configFieldSyncMs', async () => {
      await batchSyncConfigFields(appSettings.gatewayToken);
    });
  } catch (err) {
    logger.warn('Failed to batch-sync config fields to openclaw.json:', err);
  }

  return {
    timingsMs,
    maintenance,
    configuredChannels,
  };
}

export async function syncDefaultProviderRuntimeBeforeLaunch(): Promise<void> {
  try {
    const defaultProviderId = await getDefaultProvider();
    if (!defaultProviderId) {
      return;
    }
    const outcome = await syncDefaultProviderToRuntime(defaultProviderId);
    if (outcome.degraded) {
      logger.warn(`Default provider model synced before Gateway launch, but per-agent models.json sync degraded: ${outcome.reason}`);
    }
  } catch (err) {
    logger.warn('Failed to sync default provider model before Gateway launch:', err);
  }
}

export async function loadProviderEnv(): Promise<{ providerEnv: Record<string, string>; loadedProviderKeyCount: number }> {
  const providerEnv: Record<string, string> = {};
  const providerTypes = getKeyableProviderTypes();
  let loadedProviderKeyCount = 0;

  try {
    const defaultProviderId = await getDefaultProvider();
    if (defaultProviderId) {
      const defaultProvider = await getProvider(defaultProviderId);
      const defaultProviderType = defaultProvider?.type;
      const defaultProviderKey = await getApiKey(defaultProviderId);
      if (defaultProviderType && defaultProviderKey) {
        const envVar = getProviderEnvVar(defaultProviderType);
        if (envVar) {
          providerEnv[envVar] = defaultProviderKey;
          loadedProviderKeyCount++;
        }
      }
    }
  } catch (err) {
    logger.warn('Failed to load default provider key for environment injection:', err);
  }

  for (const providerType of providerTypes) {
    try {
      const key = await getApiKey(providerType);
      if (key) {
        const envVar = getProviderEnvVar(providerType);
        if (envVar) {
          providerEnv[envVar] = key;
          loadedProviderKeyCount++;
        }
      }
    } catch (err) {
      logger.warn(`Failed to load API key for ${providerType}:`, err);
    }
  }

  // Custom/ollama accounts have no registry env var; their openclaw.json entry
  // carries an env SecretRef, so the matching variable must exist in the
  // Gateway environment or the source runtime reports "No API key found".
  try {
    for (const provider of await getAllProviders()) {
      if (!isMultiInstanceProviderType(provider.type)) continue;
      const key = await getApiKey(provider.id);
      if (!key) continue;
      const envVar = getMultiInstanceProviderApiKeyEnvVar(getOpenClawProviderKeyForType(provider.type, provider.id));
      if (providerEnv[envVar]) continue;
      providerEnv[envVar] = key;
      loadedProviderKeyCount++;
    }
  } catch (err) {
    logger.warn('Failed to load custom provider keys for environment injection:', err);
  }

  return { providerEnv, loadedProviderKeyCount };
}

async function resolveChannelStartupPolicy(): Promise<{
  skipChannels: boolean;
  channelStartupSummary: string;
}> {
  try {
    const rawCfg = await readOpenClawConfig();
    const configuredChannels = await listConfiguredChannelsFromConfig(rawCfg);
    if (configuredChannels.length === 0) {
      return {
        skipChannels: true,
        channelStartupSummary: 'skipped(no configured channels)',
      };
    }

    return {
      skipChannels: false,
      channelStartupSummary: `enabled(${configuredChannels.join(',')})`,
    };
  } catch (error) {
    logger.warn('Failed to determine configured channels for gateway launch:', error);
    return {
      skipChannels: false,
      channelStartupSummary: 'enabled(unknown)',
    };
  }
}

async function loadMcpRuntimeEnv(): Promise<Record<string, string>> {
  // VERSE_CLAW_MCP_CONFIG_JSON is a legacy sidecar environment variable. The
  // OpenClaw gateway runtime does NOT consume it (verified against the
  // bundled dist — no reference to the variable exists there). MCP server
  // persistence is owned by the Verse Claw electron-store `mcp-servers.json`;
  // this env var only exposes the same resolved snapshot to out-of-tree
  // Verse Claw plugins that still opt into the legacy payload.
  try {
    const workspace = await getActiveWorkspaceProfile();
    const agentId = workspace?.selectedAgentId || workspace?.agentId || null;
    const servers = await resolveMcpServersForContext({
      workspaceId: workspace?.id ?? null,
      agentId,
    });
    return {
      VERSE_CLAW_MCP_CONFIG_JSON: JSON.stringify({
        legacy: true,
        workspaceId: workspace?.id ?? null,
        agentId,
        servers,
        updatedAt: Date.now(),
      }),
    };
  } catch (error) {
    logger.warn('Failed to resolve MCP runtime config:', error);
    return {
      VERSE_CLAW_MCP_CONFIG_JSON: JSON.stringify({ legacy: true, servers: [], updatedAt: Date.now() }),
    };
  }
}

function hasDockerSandboxImage(): boolean {
  const result = spawnSync('docker', ['image', 'inspect', 'openclaw-sandbox:bookworm-slim'], {
    encoding: 'utf-8',
    windowsHide: true,
    timeout: 5000,
  });
  return result.status === 0;
}

function forceSandboxOffRecord(value: unknown): Record<string, unknown> {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const { autoDisabledReason: _autoDisabledReason, ...schemaSafeRecord } = record;
  return {
    ...schemaSafeRecord,
    mode: 'off',
  };
}

export function stripSourceRuntimeIncompatibleConfigKeys(config: Record<string, unknown>): Record<string, unknown> {
  const agents = config.agents && typeof config.agents === 'object' && !Array.isArray(config.agents)
    ? config.agents as Record<string, unknown>
    : null;
  if (!agents || !Array.isArray(agents.list)) {
    return config;
  }

  let changed = false;
  const list = agents.list.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return entry;
    }

    const agentEntry = entry as Record<string, unknown>;
    if (!('reasoningEffort' in agentEntry)) {
      return entry;
    }

    const { reasoningEffort: _reasoningEffort, ...schemaSafeEntry } = agentEntry;
    changed = true;
    return schemaSafeEntry;
  });

  if (!changed) {
    return config;
  }

  return {
    ...config,
    agents: {
      ...agents,
      list,
    },
  };
}

export function applySourceRuntimeSandboxAutoFallback(config: Record<string, unknown>): Record<string, unknown> {
  if (hasDockerSandboxImage()) {
    return config;
  }
  const agents = config.agents && typeof config.agents === 'object' && !Array.isArray(config.agents)
    ? config.agents as Record<string, unknown>
    : {};
  const defaults = agents.defaults && typeof agents.defaults === 'object' && !Array.isArray(agents.defaults)
    ? agents.defaults as Record<string, unknown>
    : {};
  const list = Array.isArray(agents.list) ? agents.list : [];
  const nextList = list.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return entry;
    }
    const agentEntry = entry as Record<string, unknown>;
    return {
      ...agentEntry,
      sandbox: forceSandboxOffRecord(agentEntry.sandbox),
    };
  });

  const nextConfig = {
    ...config,
    agents: {
      ...agents,
      defaults: {
        ...defaults,
        sandbox: forceSandboxOffRecord(defaults.sandbox),
      },
      ...(Array.isArray(agents.list) ? { list: nextList } : {}),
    },
  };
  logger.warn('Source runtime Docker sandbox image is unavailable; sandbox.mode=off for the isolated source runtime config.');
  return nextConfig;
}

/** Pure source-runtime isolation env. Does not force-disable plugin tools. */
export function buildSourceRuntimeIsolationEnv(params: {
  stateDir: string;
  homeDir: string;
  configPath: string;
}): Record<string, string> {
  // Desktop source isolation defers post-ready sidecars so chat can attach quickly.
  // Playwright E2E needs startup-gated RPCs (tools.effective) available before
  // assertions; with defer enabled, tools.effective stays unavailable until
  // sidecars finish - and a hung/slow plugin service never unblocks it. Under
  // VERSE_CLAW_E2E we therefore skip defer entirely so sidecars complete on
  // the ready path (production keeps the long defer).
  const isE2E = process.env.VERSE_CLAW_E2E === '1';
  return {
    OPENCLAW_STATE_DIR: params.stateDir,
    OPENCLAW_CONFIG_PATH: params.configPath,
    OPENCLAW_HOME: params.homeDir,
    OPENCLAW_SKIP_LEGACY_STATE_MIGRATION: '1',
    OPENCLAW_NO_AUTO_UPDATE: '1',
    ...(isE2E
      ? {}
      : {
          OPENCLAW_DEFER_STARTUP_SIDECARS: '1',
          OPENCLAW_DEFERRED_SIDECAR_START_DELAY_MS: '600000',
        }),
  };
}

/**
 * Keys copied from ~/.openclaw/openclaw.json into the isolated source-runtime
 * config (userData/openclaw-source-state/openclaw.json).
 *
 * - agents/models/plugins: keep existing sync so the source gateway resolves the
 *   same providers the desktop UI configured.
 * - runtime: whole-key sync (not contextBlock/sekb subkey whitelist).
 *   Rationale: DCS flags live under runtime.contextBlock.* and runtime sekb;
 *   whole-key keeps nesting intact and avoids half-merged defaults. Defaults stay
 *   all-false unless the user explicitly writes them in openclaw.json.
 *
 * Merge rule (applySourceRuntimeIsolationUserConfig):
 * 1. When user config has a non-null value for a sync key and it differs from the
 *    isolated config, copy user -> isolated.
 * 2. When the user config omits the key (or value is null/undefined), leave the
 *    isolated value unchanged. Never wipe an existing isolated runtime block.
 * 3. stripSourceRuntimeIncompatibleConfigKeys still only removes agents.list[].reasoningEffort
 *    and must not touch runtime.* keys.
 */
export const SOURCE_RUNTIME_ISOLATION_SYNC_KEYS = ['agents', 'models', 'plugins', 'runtime', 'tools'] as const;
export type SourceRuntimeIsolationSyncKey = typeof SOURCE_RUNTIME_ISOLATION_SYNC_KEYS[number];

export function applySourceRuntimeIsolationUserConfig(
  isolatedConfig: Record<string, unknown>,
  userConfig: Record<string, unknown>,
  keys: readonly SourceRuntimeIsolationSyncKey[] = SOURCE_RUNTIME_ISOLATION_SYNC_KEYS,
): { config: Record<string, unknown>; changed: boolean } {
  let changed = false;
  const nextConfig: Record<string, unknown> = { ...isolatedConfig };
  for (const key of keys) {
    const userValue = userConfig[key];
    if (userValue == null) {
      // Preserve existing isolated value when the user did not set this key.
      continue;
    }
    const isolatedValue = nextConfig[key];
    const userSerialized = JSON.stringify(userValue);
    const isolatedSerialized = isolatedValue != null ? JSON.stringify(isolatedValue) : null;
    if (userSerialized !== isolatedSerialized) {
      nextConfig[key] = userValue;
      changed = true;
    }
  }
  return { config: nextConfig, changed };
}

export function buildInitialSourceRuntimeIsolationConfig(
  userConfig: Record<string, unknown>,
): Record<string, unknown> {
  return {
    gateway: {
      mode: 'local',
      controlUi: { enabled: false },
    },
    update: { checkOnStart: false },
    agents: userConfig.agents ?? {},
    models: userConfig.models ?? { providers: {} },
    plugins: userConfig.plugins ?? { enabled: false },
    // Carry DCS/runtime flags from the desktop-facing config when present.
    ...(userConfig.runtime != null ? { runtime: userConfig.runtime } : {}),
    // tools.exec carries the workspace permission mode (security/ask). Without it
    // the source runtime treats every chat exec as provenance-missing, downgrades
    // to allowlist/on-miss and parks the call on an approval ClawX never answers.
    ...(userConfig.tools != null ? { tools: userConfig.tools } : {}),
    channels: {},
  };
}

function prepareSourceRuntimeIsolation(): {
  stateDir: string;
  homeDir: string;
  configPath: string;
  env: Record<string, string>;
} {
  const stateDir = join(app.getPath('userData'), 'openclaw-source-state');
  const homeDir = join(app.getPath('userData'), 'openclaw-source-home');
  const configPath = join(stateDir, 'openclaw.json');

  mkdirSync(fsPath(stateDir), { recursive: true });
  mkdirSync(fsPath(homeDir), { recursive: true });

  // Read the user's actual config so we can inherit model, agent, and plugin
  // settings. The isolation sandbox must still be able to resolve the same
  // models the user configured in Verse Claw.
  const userConfigPath = join(getOpenClawConfigDir(), 'openclaw.json');
  let userConfig: Record<string, unknown> = {};
  if (existsSync(userConfigPath)) {
    try {
      userConfig = JSON.parse(readFileSync(userConfigPath, 'utf-8')) as Record<string, unknown>;
      userConfig = stripSourceRuntimeIncompatibleConfigKeys(userConfig);
    } catch {
      logger.warn('Failed to read user config for source runtime isolation');
    }
  }

  if (!existsSync(fsPath(configPath))) {
    const minimalConfig = buildInitialSourceRuntimeIsolationConfig(userConfig);
    const isolatedConfig = applySourceRuntimeSandboxAutoFallback(stripSourceRuntimeIncompatibleConfigKeys(minimalConfig));
    writeFileSync(fsPath(configPath), `${JSON.stringify(isolatedConfig, null, 2)}\n`, 'utf-8');
  } else {
    try {
      const existing = JSON.parse(readFileSync(fsPath(configPath), 'utf-8')) as Record<string, unknown>;
      const updateConfig = existing.update && typeof existing.update === 'object'
        ? existing.update as Record<string, unknown>
        : {};

      let needsWrite = false;
      let nextConfig = { ...existing };

      if (updateConfig.checkOnStart !== false) {
        nextConfig.update = { ...updateConfig, checkOnStart: false };
        needsWrite = true;
      }

      // Sync the user's model/agent/plugin/runtime settings into the isolated config
      // so the source runtime always uses the models the user configured in
      // Verse Claw, and DCS runtime.contextBlock flags reach the gateway when set.
      // See applySourceRuntimeIsolationUserConfig for the no-overwrite-when-absent rule.
      const synced = applySourceRuntimeIsolationUserConfig(nextConfig, userConfig);
      if (synced.changed) {
        nextConfig = synced.config;
        needsWrite = true;
      }

      const schemaAdjustedConfig = stripSourceRuntimeIncompatibleConfigKeys(nextConfig);
      if (JSON.stringify(schemaAdjustedConfig) !== JSON.stringify(nextConfig)) {
        nextConfig = schemaAdjustedConfig;
        needsWrite = true;
      }

      const sandboxAdjustedConfig = applySourceRuntimeSandboxAutoFallback(nextConfig);
      if (JSON.stringify(sandboxAdjustedConfig) !== JSON.stringify(nextConfig)) {
        nextConfig = sandboxAdjustedConfig;
        needsWrite = true;
      }

      if (needsWrite) {
        writeFileSync(fsPath(configPath), `${JSON.stringify(nextConfig, null, 2)}\n`, 'utf-8');
      }
    } catch (error) {
      logger.warn('Failed to disable source runtime update checks:', error);
    }
  }

  return {
    stateDir,
    homeDir,
    configPath,
    env: buildSourceRuntimeIsolationEnv({ stateDir, homeDir, configPath }),
  };
}

async function readEffectiveGatewayConfig(sourceRuntimeConfigPath?: string): Promise<Record<string, unknown>> {
  if (!sourceRuntimeConfigPath) return await readOpenClawConfig();
  try {
    return JSON.parse(readFileSync(fsPath(sourceRuntimeConfigPath), 'utf-8')) as Record<string, unknown>;
  } catch (error) {
    logger.warn('Failed to read the effective source runtime config for VerseShell resolution:', error);
    return {};
  }
}

export async function prepareGatewayLaunchContext(port: number): Promise<GatewayLaunchContext> {
  const timingsMs: Record<string, number> = {};
  const totalStartedAt = Date.now();
  const requestedRuntimeMode = process.env.VERSE_CLAW_OPENCLAW_RUNTIME?.trim().toLowerCase();
  let runtimeMode: GatewayLaunchContext['runtimeMode'] = isOpenClawRuntimeEnabled() ? 'source' : 'npm';
  let openclawDir = runtimeMode === 'source' ? getOpenClawRuntimeDir() : getOpenClawDir();
  let entryScript = runtimeMode === 'source' ? getOpenClawRuntimeEntryPath() : getOpenClawEntryPath();
  const entryScriptArgs: string[] = [];
  const execArgv: string[] = [];

  if (runtimeMode === 'source' && app.isPackaged && requestedRuntimeMode !== 'source') {
    const runtimePkgPath = join(openclawDir, 'package.json');
    if (!existsSync(fsPath(openclawDir)) || !existsSync(fsPath(runtimePkgPath))) {
      logger.warn('Source runtime not available in packaged build, falling back to npm');
      runtimeMode = 'npm';
      openclawDir = getOpenClawDir();
      entryScript = getOpenClawEntryPath();
    }
  }

  if (runtimeMode === 'source') {
    const runtimePkgPath = join(openclawDir, 'package.json');
    if (!existsSync(fsPath(runtimePkgPath))) {
      throw new Error(`OpenClaw source runtime not found at: ${openclawDir}`);
    }
    const sourceEntryScript = entryScript;
    if (sourceEntryScript.endsWith('.ts')) {
      const tsxCliPath = getOpenClawRuntimeTsxCliPath();
      if (!existsSync(fsPath(tsxCliPath))) {
        throw new Error(`OpenClaw source runtime tsx CLI not found at: ${tsxCliPath}`);
      }
      entryScript = tsxCliPath;
      entryScriptArgs.push(sourceEntryScript);
    }
  } else if (!isOpenClawPresent()) {
    throw new Error(`OpenClaw package not found at: ${openclawDir}`);
  }

  const appSettings = await measureAsync(timingsMs, 'settingsMs', getAllSettings);
  await measureAsync(timingsMs, 'defaultProviderRuntimeSyncMs', syncDefaultProviderRuntimeBeforeLaunch);
  const prelaunchSummary: GatewayPrelaunchSyncSummary = runtimeMode === 'source'
    ? { timingsMs: {}, maintenance: {}, configuredChannels: [] }
    : await measureAsync(timingsMs, 'prelaunchSyncMs', async () => (
      await syncGatewayConfigBeforeLaunch(appSettings, openclawDir)
    ));

  if (!existsSync(fsPath(entryScript))) {
    throw new Error(`OpenClaw entry script not found at: ${entryScript}`);
  }

  const gatewayArgs = ['gateway', '--port', String(port), '--token', appSettings.gatewayToken, '--allow-unconfigured'];
  const mode = app.isPackaged ? 'packaged' : 'dev';

  const platform = process.platform;
  const arch = process.arch;
  const target = `${platform}-${arch}`;
  const binPath = app.isPackaged
    ? path.join(process.resourcesPath, 'bin')
    : path.join(process.cwd(), 'resources', 'bin', target);
  const binPathExists = existsSync(binPath);

  const { providerEnv, loadedProviderKeyCount } = await measureAsync(timingsMs, 'providerEnvMs', loadProviderEnv);
  const { skipChannels, channelStartupSummary } = runtimeMode === 'source'
    ? {
      skipChannels: true,
      channelStartupSummary: 'skipped(source runtime isolated config)',
    }
    : await measureAsync(
      timingsMs,
      'channelStartupPolicyMs',
      resolveChannelStartupPolicy,
    );
  const uvEnv = await measureAsync(timingsMs, 'uvEnvMs', getUvMirrorEnv);
  const mcpEnv = await measureAsync(timingsMs, 'mcpEnvMs', loadMcpRuntimeEnv);
  const sourceRuntimeIsolation = runtimeMode === 'source' ? prepareSourceRuntimeIsolation() : null;
  const verseShellDevOverrideRequested =
    ['1', 'true', 'yes', 'on'].includes(
      process.env[VERSESHELL_DEV_OVERRIDE_FLAG]?.trim().toLowerCase() ?? '',
    )
    || Boolean(process.env[VERSESHELL_DEV_OVERRIDE_PATH]?.trim());
  const effectiveGatewayConfig = await measureAsync(timingsMs, 'runtimeConfigReadMs', () => (
    readEffectiveGatewayConfig(sourceRuntimeIsolation?.configPath)
  ));
  const verseShellRuntime = await measureAsync(timingsMs, 'verseShellBundleMs', () => (
    resolveVerseShellRuntimeForLaunch({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      cwd: process.cwd(),
      platform,
      arch,
      env: process.env,
      rolloutConfig: effectiveGatewayConfig,
      devOverrideRequested: verseShellDevOverrideRequested,
    })
  ));
  const proxyEnv = buildProxyEnv(appSettings);
  const resolvedProxy = resolveProxySettings(appSettings);
  const proxySummary = appSettings.proxyEnabled
    ? `http=${resolvedProxy.httpProxy || '-'}, https=${resolvedProxy.httpsProxy || '-'}, all=${resolvedProxy.allProxy || '-'}`
    : 'disabled';

  const { NODE_OPTIONS: _nodeOptions, ...baseEnv } = process.env;
  const baseEnvRecord = baseEnv as Record<string, string | undefined>;
  const baseEnvWithBin = binPathExists
    ? prependPathEntry(baseEnvRecord, binPath).env
    : baseEnvRecord;
  const sourceRuntimeBinPath = join(openclawDir, 'node_modules', '.bin');
  const baseEnvPatched = runtimeMode === 'source' && existsSync(fsPath(sourceRuntimeBinPath))
    ? prependPathEntry(baseEnvWithBin, sourceRuntimeBinPath).env
    : baseEnvWithBin;
  // Verse Token Working Context assembly (gateway production path).
  // Package root points the gateway stdio worker at packages/vtoken (or packaged resources).
  const vtokenPackageRoot = (() => {
    try {
      // Prefer monorepo packages/vtoken in dev; packaged resources/vtoken in production.
      if (app?.isPackaged) {
        const packaged = join(process.resourcesPath, 'vtoken');
        if (existsSync(join(packaged, 'src', 'vtoken'))) return packaged;
      }
      const dev = join(process.cwd(), 'packages', 'vtoken');
      if (existsSync(join(dev, 'src', 'vtoken'))) return dev;
    } catch {
      // ignore
    }
    return process.env.VERSE_VTOKEN_PACKAGE_ROOT?.trim() || '';
  })();

  const forkEnvBase: Record<string, string | undefined> = {
    ...stripSystemdSupervisorEnv(baseEnvPatched),
    ...(sourceRuntimeIsolation?.env ?? {}),
    ...providerEnv,
    ...uvEnv,
    ...mcpEnv,
    ...proxyEnv,
    OPENCLAW_GATEWAY_TOKEN: appSettings.gatewayToken,
    OPENCLAW_ROLE_MEMORY_ENABLED: appSettings.roleMemoryEnabled === false ? '0' : '1',
    OPENCLAW_SKIP_CHANNELS: skipChannels ? '1' : '',
    CLAWDBOT_SKIP_CHANNELS: skipChannels ? '1' : '',
    OPENCLAW_NO_RESPAWN: '1',
    ...(verseShellRuntime ? buildVerseShellRuntimeEnv(verseShellRuntime) : {}),
    // FP-P0-01: VERSE_VTOKEN_ASSEMBLY_ENABLED is intentionally NOT set here.
    // Product default is OFF (opt-in) per docs/dev/default-config-matrix.md; the
    // runtime resolver reads unset as OFF, explicit truthy as canary opt-in and
    // explicit 0/false/off as a kill that outranks config opt-in.  Whatever the
    // operator exported in the shell is inherited verbatim through the
    // `baseEnvPatched` spread above, so both opt-in and kill still work.
    ...(vtokenPackageRoot
      ? { VERSE_VTOKEN_PACKAGE_ROOT: vtokenPackageRoot }
      : {}),
    ...(process.resourcesPath
      ? { VERSE_RESOURCES_PATH: process.resourcesPath }
      : {}),
  };
  // TASK-P0-01: Settings-controlled DCS env flags (view tools, etc.)
  const forkEnv = applyDcsProdFlagsToGatewayEnv(forkEnvBase, appSettings);

  // Ensure extension-specific packages (e.g. grammy from the telegram
  // extension) are resolvable by shared dist/ chunks via symlinks in
  // openclaw/node_modules/.  NODE_PATH does NOT work for ESM imports.
  if (runtimeMode !== 'source') {
    measureSync(timingsMs, 'extensionDepsMs', () => ensureExtensionDepsResolvable(openclawDir));
  }
  timingsMs.totalMs = Date.now() - totalStartedAt;

  logger.info('[metric] gateway.prelaunch', {
    ...prelaunchSummary.timingsMs,
    ...timingsMs,
    maintenance: prelaunchSummary.maintenance,
    configuredChannelCount: prelaunchSummary.configuredChannels.length,
  });

  return {
    appSettings,
    openclawDir,
    entryScript,
    entryScriptArgs,
    execArgv,
    gatewayArgs,
    forkEnv,
    mode,
    runtimeMode,
    binPathExists,
    loadedProviderKeyCount,
    proxySummary,
    channelStartupSummary,
  };
}
