import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import { appendHookTrustAudit, hashHookFile, normalizeHookTrustSource, resolveHookTrust } from '../../openclaw_runtime/src/hooks/trust';
import { getOpenClawConfigDir } from '../utils/paths';
import { readOpenClawConfig, writeOpenClawConfig } from '../utils/channel-config';
import { withConfigLock } from '../utils/config-mutex';
import { getActiveWorkspaceProfile } from './workspaces-api';
import type { HookListResult, HookSetTrustedPayload, HookTrustEntryView, HookTrustMutationResult } from '@shared/host-api/contract';

type HookConfigEntry = { enabled?: boolean; trusted?: boolean; trustedHash?: string };
type HookConfigDocument = {
  hooks?: { internal?: { entries?: Record<string, HookConfigEntry> } };
};

type ScannedHook = {
  hookKey: string;
  name: string;
  source: 'openclaw-bundled' | 'openclaw-managed' | 'openclaw-workspace' | 'openclaw-plugin';
  handlerPath: string;
};

function readHookName(hookDir: string): string | null {
  try {
    const hookMd = readFileSync(join(hookDir, 'HOOK.md'), 'utf8');
    const name = hookMd.match(/^name:\s*(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '');
    const hookKey = hookMd.match(/"hookKey"\s*:\s*"([^"]+)"/)?.[1]?.trim();
    return hookKey || name || null;
  } catch {
    return null;
  }
}

function findHandlerPath(hookDir: string): string | null {
  for (const candidate of ['handler.ts', 'handler.js', 'index.ts', 'index.js']) {
    const full = join(hookDir, candidate);
    if (existsSync(full)) return full;
  }
  return null;
}

function scanHooksDir(dir: string, source: ScannedHook['source']): ScannedHook[] {
  if (!existsSync(dir)) return [];
  const hooks: ScannedHook[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const hookDir = join(dir, entry.name);
    const hookKey = readHookName(hookDir);
    const handlerPath = findHandlerPath(hookDir);
    if (!hookKey || !handlerPath) continue;
    hooks.push({ hookKey, name: hookKey, source, handlerPath });
  }
  return hooks;
}

function normalizePayload(payload: unknown): HookSetTrustedPayload {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('hooks.setTrusted requires a payload');
  }
  const body = payload as Record<string, unknown>;
  if (typeof body.hookKey !== 'string' || !body.hookKey.trim()) {
    throw new Error('hooks.setTrusted requires hookKey');
  }
  return {
    hookKey: body.hookKey.trim(),
    ...(body.trusted === undefined ? {} : { trusted: body.trusted === true }),
    ...(body.enabled === undefined ? {} : { enabled: body.enabled === true }),
  };
}

async function listHooks(): Promise<HookListResult> {
  const config = await readOpenClawConfig() as unknown as HookConfigDocument;
  const entries = config.hooks?.internal?.entries ?? {};
  const workspace = await getActiveWorkspaceProfile();
  const workspaceHooks = workspace?.rootPath
    ? scanHooksDir(join(workspace.rootPath, 'hooks'), 'openclaw-workspace')
    : [];
  const managedHooks = scanHooksDir(join(getOpenClawConfigDir(), 'hooks'), 'openclaw-managed');
  const seen = new Set<string>();
  const hooks: HookTrustEntryView[] = [];
  for (const scanned of [...managedHooks, ...workspaceHooks]) {
    if (seen.has(scanned.hookKey)) continue;
    seen.add(scanned.hookKey);
    const managed = scanned.source !== 'openclaw-workspace';
    const entry = entries[scanned.hookKey];
    const enabled = managed ? entry?.enabled !== false : entry?.enabled === true;
    const hash = hashHookFile(scanned.handlerPath);
    const trust = resolveHookTrust({
      source: normalizeHookTrustSource(scanned.source),
      enabledByConfig: enabled,
      trusted: entry?.trusted === true,
      trustedHash: typeof entry?.trustedHash === 'string' ? entry.trustedHash : null,
      hash,
    });
    hooks.push({
      hookKey: scanned.hookKey,
      name: scanned.name,
      source: scanned.source,
      managed: trust.managed,
      trustState: trust.state,
      hash: trust.hash,
      expectedHash: trust.expectedHash,
      enabled,
      loadable: enabled && trust.state === 'trusted',
      reason: trust.reason,
      filePath: scanned.handlerPath,
    });
  }
  return { success: true, hooks };
}

function auditPath(): string {
  return join(getOpenClawConfigDir(), 'hooks', 'trust-audit.jsonl');
}

export function createHooksApi(): CompleteHostServiceRegistry['hooks'] {
  return {
    list: listHooks,
    setTrusted: async (payload): Promise<HookTrustMutationResult> => {
      const body = normalizePayload(payload);
      const before = await listHooks();
      const target = before.hooks.find((entry) => entry.hookKey === body.hookKey);
      if (!target) throw new Error(`Unknown hook: ${body.hookKey}`);
      if (body.enabled === false && target.managed) {
        throw new Error(`Managed hook cannot be disabled: ${body.hookKey}`);
      }

      await withConfigLock(async () => {
        const config = await readOpenClawConfig() as unknown as HookConfigDocument;
        if (!config.hooks) config.hooks = {};
        if (!config.hooks.internal) config.hooks.internal = {};
        if (!config.hooks.internal.entries) config.hooks.internal.entries = {};
        const entries = config.hooks.internal.entries;
        const next = { ...(entries[body.hookKey] ?? {}) };
        if (body.enabled !== undefined) next.enabled = body.enabled;
        if (body.trusted !== undefined) {
          next.trusted = body.trusted;
          if (body.trusted) {
            const trustedHash = hashHookFile(target.filePath);
            if (trustedHash) next.trustedHash = trustedHash;
            else delete next.trustedHash;
          } else {
            delete next.trustedHash;
          }
        }
        entries[body.hookKey] = next;
        await writeOpenClawConfig(config as never);
      });

      const after = await listHooks();
      const updated = after.hooks.find((entry) => entry.hookKey === body.hookKey);
      if (!updated) throw new Error(`Hook disappeared after update: ${body.hookKey}`);
      const action = body.enabled === false
        ? 'disable'
        : body.enabled === true
          ? 'enable'
          : body.trusted === true
            ? 'trust'
            : 'untrust';
      appendHookTrustAudit(auditPath(), {
        ts: new Date().toISOString(),
        action,
        hookKey: body.hookKey,
        source: normalizeHookTrustSource(target.source as never),
        previousHash: target.hash,
        newHash: updated.hash,
        actor: 'user',
      });
      return { ...after, hookKey: body.hookKey, trustState: updated.trustState };
    },
  };
}
