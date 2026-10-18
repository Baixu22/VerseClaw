import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { OpenClawConfig } from '../../openclaw_runtime/src/config/types.openclaw.js';
import { loadHookEntriesFromDir } from '../../openclaw_runtime/src/hooks/workspace.js';
import { shouldIncludeHook } from '../../openclaw_runtime/src/hooks/config.js';
import { appendHookTrustAudit, hashHookFile, hookTrustAllowsExecution, resolveHookTrust } from '../../openclaw_runtime/src/hooks/trust.js';

const tempDirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'clawx-hook-trust-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('hook trust', () => {
  it('rejects untrusted workspace hooks and hash changes while allowing managed hooks', () => {
    expect(resolveHookTrust({
      source: 'workspace', enabledByConfig: true, trusted: false, trustedHash: null, hash: 'a'.repeat(64),
    })).toMatchObject({ state: 'untrusted', managed: false });
    expect(resolveHookTrust({
      source: 'workspace', enabledByConfig: true, trusted: true, trustedHash: 'b'.repeat(64), hash: 'a'.repeat(64),
    })).toMatchObject({ state: 'changed', managed: false });
    expect(resolveHookTrust({
      source: 'managed', enabledByConfig: true, trusted: false, trustedHash: null, hash: 'a'.repeat(64),
    })).toMatchObject({ state: 'trusted', managed: true });
  });

  it('writes trust audit events as JSONL', async () => {
    const dir = await tempDir();
    const audit = join(dir, 'trust-audit.jsonl');
    appendHookTrustAudit(audit, {
      ts: '2026-10-18T00:00:00.000Z',
      action: 'trust',
      hookKey: 'demo',
      source: 'workspace',
      previousHash: null,
      newHash: 'a'.repeat(64),
      actor: 'user',
    });
    expect(JSON.parse((await readFile(audit, 'utf8')).trim())).toMatchObject({ action: 'trust', hookKey: 'demo' });
  });

  it('denies discovered workspace hook execution until an exact hash is trusted', async () => {
    const workspaceDir = await tempDir();
    const hookDir = join(workspaceDir, 'hooks', 'demo');
    await mkdir(hookDir, { recursive: true });
    const handlerPath = join(hookDir, 'handler.js');
    await writeFile(join(workspaceDir, 'package.json'), '{"type":"module"}\n', 'utf8');
    await writeFile(handlerPath, `export default async function handler() {}\n`, 'utf8');
    await writeFile(join(hookDir, 'HOOK.md'), [
      '---',
      'name: demo',
      'description: Trust gate fixture',
      'metadata:',
      '  { "openclaw": { "events": ["command:new"] } }',
      '---',
      '',
      '# Demo',
    ].join(`\n`), 'utf8');

    const discovered = loadHookEntriesFromDir({ dir: join(workspaceDir, 'hooks'), source: 'openclaw-workspace' });
    expect(discovered).toHaveLength(1);
    expect(discovered[0].metadata?.events).toContain('command:new');

    const config = {
      hooks: { internal: { enabled: true, entries: { demo: { enabled: true } } } },
    } as unknown as OpenClawConfig;

    const baseDecision = () => {
      const entryConfig = config.hooks!.internal!.entries!.demo;
      return resolveHookTrust({
        source: 'workspace',
        enabledByConfig: entryConfig.enabled !== false,
        trusted: entryConfig.trusted === true,
        trustedHash: entryConfig.trustedHash ?? null,
        hash: hashHookFile(handlerPath),
      });
    };
    expect(shouldIncludeHook({ entry: discovered[0], config })).toBe(true);
    expect(hookTrustAllowsExecution(baseDecision())).toBe(false);

    const hash = hashHookFile(handlerPath);
    config.hooks!.internal!.entries!.demo.trusted = true;
    config.hooks!.internal!.entries!.demo.trustedHash = hash ?? undefined;
    expect(hookTrustAllowsExecution(baseDecision())).toBe(true);

    config.hooks!.internal!.entries!.demo.trustedHash = '0'.repeat(64);
    expect(hookTrustAllowsExecution(baseDecision())).toBe(false);
  });
});
