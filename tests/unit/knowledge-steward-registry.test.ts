import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { closeOpenClawStateDatabaseForTest } from '../../openclaw_runtime/src/state/openclaw-state-db';
import { tmpdir } from 'node:os';
import type { KnowledgeRoleRegistryFile } from '@shared/host-api/contract';

// Area 5 §3.1 — KB Role Registry tests. The registry loader is exercised
// through the host API surface so tests stay aligned with the real read path.
// Missing/corrupt file → DEFAULT_REGISTRY (byte-identical to today's
// DEFAULT_STEWARD_CONFIG); hand-edited canApplyDirectly: true is rejected at
// load (§9 boundary).

vi.mock('electron', () => ({
  shell: { openPath: vi.fn(async () => '') },
}));

// Each test file gets a single root temp dir; per-test isolation is achieved
// by rmSync in beforeEach. Mocked once at file load — same pattern as the
// existing knowledge-api.test.ts.
const root = join(tmpdir(), `clawx-kb-steward-test-${Date.now()}`);

vi.mock('@electron/utils/paths', () => ({
  expandPath: (path: string) => path,
  getOpenClawConfigDir: () => root,
  getDataDir: () => join(root, 'userData'),
}));

function writeRegistryFile(content: unknown) {
  const filePath = join(root, 'knowledge', 'steward-roles.json');
  mkdirSync(join(root, 'knowledge'), { recursive: true });
  writeFileSync(filePath, typeof content === 'string' ? content : JSON.stringify(content, null, 2), 'utf8');
}

function deleteRegistryFile() {
  const filePath = join(root, 'knowledge', 'steward-roles.json');
  if (existsSync(filePath)) rmSync(filePath, { force: true });
}

async function getApi() {
  const mod = await import('@electron/services/knowledge-api');
  // Reset the in-memory registry cache so each test reads from disk fresh.
  mod.__resetRoleRegistryCacheForTests();
  // createKnowledgeApi returns the knowledge namespace object directly.
  return mod.createKnowledgeApi({ gatewayManager: null as never });
}

describe('Area 5 §3.1 — KB Role Registry', () => {
  beforeEach(async () => {
    closeOpenClawStateDatabaseForTest();
    const mod = await import('@electron/services/knowledge-api');
    mod.__resetKnowledgeGovernanceForTests();
    mod.__resetGovernanceWriterQueueForTests();
    mod.__resetHostGovernedAdaptersForTests();
    rmSync(root, { recursive: true, force: true });
    mkdirSync(root, { recursive: true });
  });

  afterEach(async () => {
    const mod = await import('@electron/services/knowledge-api');
    mod.stopAllKnowledgeSourceWatches();
    closeOpenClawStateDatabaseForTest();
    rmSync(root, { recursive: true, force: true });
  });

  describe('DEFAULT_REGISTRY fallback (§3.1, §8)', () => {
    it('returns byte-identical DEFAULT_STEWARD_CONFIG when registry file is missing', async () => {
      deleteRegistryFile();
      const api = await getApi();
      const result = await api.stewardConfigGet();
      expect(result.success).toBe(true);
      expect(result.registry.version).toBe(1);
      expect(result.registry.defaultRoleId).toBe('knowledge-steward');
      expect(result.registry.roles).toHaveLength(1);
      const role = result.registry.roles[0];
      expect(role.roleId).toBe('knowledge-steward');
      expect(role.capabilities.canApplyDirectly).toBe(false);
      expect(role.classification).toBe('heuristic');
      expect(result.activeRole?.roleId).toBe('knowledge-steward');
    });

    it('falls back to DEFAULT_REGISTRY when registry file is corrupt JSON', async () => {
      writeRegistryFile('not valid json {{{');
      const api = await getApi();
      const result = await api.stewardConfigGet();
      expect(result.success).toBe(true);
      expect(result.registry.defaultRoleId).toBe('knowledge-steward');
      expect(result.registry.roles).toHaveLength(1);
    });

    it('falls back to DEFAULT_REGISTRY when registry is not an object', async () => {
      writeRegistryFile(['not', 'an', 'object']);
      const api = await getApi();
      const result = await api.stewardConfigGet();
      expect(result.registry.defaultRoleId).toBe('knowledge-steward');
      expect(result.registry.roles).toHaveLength(1);
    });

    it('falls back to DEFAULT_REGISTRY when version is unsupported', async () => {
      writeRegistryFile({ version: 99, defaultRoleId: 'x', roles: [] });
      const api = await getApi();
      const result = await api.stewardConfigGet();
      expect(result.registry.defaultRoleId).toBe('knowledge-steward');
    });

    it('falls back to DEFAULT_REGISTRY when defaultRoleId is missing', async () => {
      writeRegistryFile({
        version: 1,
        roles: [{ roleId: 'knowledge-steward', enabled: true, capabilities: { canApplyDirectly: false }, scope: {} }],
      });
      const api = await getApi();
      const result = await api.stewardConfigGet();
      expect(result.registry.defaultRoleId).toBe('knowledge-steward');
    });

    it('falls back to DEFAULT_REGISTRY when roles array is empty', async () => {
      writeRegistryFile({ version: 1, defaultRoleId: 'knowledge-steward', roles: [] });
      const api = await getApi();
      const result = await api.stewardConfigGet();
      expect(result.registry.roles).toHaveLength(1);
      expect(result.registry.roles[0].roleId).toBe('knowledge-steward');
    });
  });

  describe('Boundary preservation — canApplyDirectly literal false (§9)', () => {
    it('rejects a hand-edited entry with canApplyDirectly: true and skips it', async () => {
      writeRegistryFile({
        version: 1,
        defaultRoleId: 'knowledge-steward',
        roles: [
          {
            roleId: 'knowledge-steward',
            enabled: true,
            capabilities: {
              canSearch: true,
              canRead: true,
              canProposeDraft: true,
              canClassify: true,
              canSuggestMerge: true,
              canSuggestArchive: true,
              canApplyDirectly: true, // §9 boundary violation
            },
            scope: { workspace: true, agent: false, global: false },
          },
        ],
      });
      const api = await getApi();
      const result = await api.stewardConfigGet();
      // Rejected entry → no accepted roles → DEFAULT_REGISTRY fallback
      expect(result.registry.defaultRoleId).toBe('knowledge-steward');
      expect(result.registry.roles).toHaveLength(1);
      expect(result.registry.roles[0].capabilities.canApplyDirectly).toBe(false);
    });

    it('rejects canApplyDirectly: "false" (string) — must be literal boolean false', async () => {
      writeRegistryFile({
        version: 1,
        defaultRoleId: 'knowledge-steward',
        roles: [
          { roleId: 'knowledge-steward', enabled: true, capabilities: { canApplyDirectly: 'false' }, scope: {} },
        ],
      });
      const api = await getApi();
      const result = await api.stewardConfigGet();
      expect(result.registry.defaultRoleId).toBe('knowledge-steward');
      expect(result.registry.roles[0].capabilities.canApplyDirectly).toBe(false);
    });

    it('rejects canApplyDirectly: 0 (number) — must be literal boolean false', async () => {
      writeRegistryFile({
        version: 1,
        defaultRoleId: 'knowledge-steward',
        roles: [
          { roleId: 'knowledge-steward', enabled: true, capabilities: { canApplyDirectly: 0 }, scope: {} },
        ],
      });
      const api = await getApi();
      const result = await api.stewardConfigGet();
      expect(result.registry.roles[0].capabilities.canApplyDirectly).toBe(false);
    });
  });

  describe('Variant normalization (§3.1)', () => {
    it('accepts a knowledge-curator variant alongside the default steward', async () => {
      writeRegistryFile({
        version: 1,
        defaultRoleId: 'knowledge-steward',
        roles: [
          {
            roleId: 'knowledge-steward',
            enabled: true,
            capabilities: { canApplyDirectly: false, canSearch: true, canRead: true },
            scope: { workspace: true, agent: false, global: false },
            classification: 'heuristic',
          },
          {
            roleId: 'knowledge-curator',
            enabled: true,
            displayName: 'Knowledge Curator',
            description: 'Focus on duplicates and freshness.',
            capabilities: { canApplyDirectly: false, canSearch: true, canRead: true, canSuggestMerge: true },
            scope: { workspace: true, agent: false, global: false },
            classification: 'semantic',
            reviewFocus: ['duplicates', 'freshness'],
            contractRef: 'knowledge-steward',
          },
        ],
      });
      const api = await getApi();
      const result = await api.stewardConfigGet();
      expect(result.registry.roles).toHaveLength(2);
      const curator = result.registry.roles.find((r) => r.roleId === 'knowledge-curator');
      expect(curator?.displayName).toBe('Knowledge Curator');
      expect(curator?.classification).toBe('semantic');
      expect(curator?.reviewFocus).toEqual(['duplicates', 'freshness']);
      expect(curator?.contractRef).toBe('knowledge-steward');
      expect(curator?.capabilities.canApplyDirectly).toBe(false);
    });

    it('rejects duplicate roleId and skips the second occurrence', async () => {
      writeRegistryFile({
        version: 1,
        defaultRoleId: 'knowledge-steward',
        roles: [
          { roleId: 'knowledge-steward', enabled: true, capabilities: { canApplyDirectly: false }, scope: {} },
          { roleId: 'knowledge-steward', enabled: true, capabilities: { canApplyDirectly: false }, scope: {} },
        ],
      });
      const api = await getApi();
      const result = await api.stewardConfigGet();
      expect(result.registry.roles).toHaveLength(1);
    });

    it('rejects entry missing roleId', async () => {
      writeRegistryFile({
        version: 1,
        defaultRoleId: 'knowledge-steward',
        roles: [
          { enabled: true, capabilities: { canApplyDirectly: false }, scope: {} },
          { roleId: 'knowledge-steward', enabled: true, capabilities: { canApplyDirectly: false }, scope: {} },
        ],
      });
      const api = await getApi();
      const result = await api.stewardConfigGet();
      expect(result.registry.roles).toHaveLength(1);
      expect(result.registry.roles[0].roleId).toBe('knowledge-steward');
    });

    it('rejects entry missing enabled flag', async () => {
      writeRegistryFile({
        version: 1,
        defaultRoleId: 'knowledge-steward',
        roles: [
          { roleId: 'knowledge-steward', capabilities: { canApplyDirectly: false }, scope: {} },
        ],
      });
      const api = await getApi();
      const result = await api.stewardConfigGet();
      expect(result.registry.defaultRoleId).toBe('knowledge-steward');
    });

    it('rejects defaultRoleId that is not in accepted roles', async () => {
      writeRegistryFile({
        version: 1,
        defaultRoleId: 'nonexistent-role',
        roles: [
          { roleId: 'knowledge-steward', enabled: true, capabilities: { canApplyDirectly: false }, scope: {} },
        ],
      });
      const api = await getApi();
      const result = await api.stewardConfigGet();
      expect(result.registry.defaultRoleId).toBe('knowledge-steward');
    });

    it('normalizes reviewFocus by filtering unknown values and deduping', async () => {
      writeRegistryFile({
        version: 1,
        defaultRoleId: 'knowledge-steward',
        roles: [
          {
            roleId: 'knowledge-steward',
            enabled: true,
            capabilities: { canApplyDirectly: false },
            scope: {},
            reviewFocus: ['duplicates', 'duplicates', 'unknown-focus', 'conflicts'],
          },
        ],
      });
      const api = await getApi();
      const result = await api.stewardConfigGet();
      expect(result.registry.roles[0].reviewFocus).toEqual(['duplicates', 'conflicts']);
    });

    it('drops invalid classification values (only heuristic|semantic allowed)', async () => {
      writeRegistryFile({
        version: 1,
        defaultRoleId: 'knowledge-steward',
        roles: [
          {
            roleId: 'knowledge-steward',
            enabled: true,
            capabilities: { canApplyDirectly: false },
            scope: {},
            classification: 'magic',
          },
        ],
      });
      const api = await getApi();
      const result = await api.stewardConfigGet();
      expect(result.registry.roles[0].classification).toBeUndefined();
    });
  });

  describe('stewardReview uses resolved role config (§3.1)', () => {
    it('returns the active role config (not the hardcoded constant)', async () => {
      // No registry file → DEFAULT_REGISTRY → activeRole is default steward
      deleteRegistryFile();
      const api = await getApi();
      const result = await api.stewardReview({
        title: 'Decision: switch to monorepo',
        body: 'We decided to consolidate repositories.',
        sourceIds: [],
        tags: ['architecture'],
      });
      expect(result.success).toBe(true);
      expect(result.config.roleId).toBe('knowledge-steward');
      expect(result.config.capabilities.canApplyDirectly).toBe(false);
      expect(result.type).toBe('decision');
    });
  });

  describe('stewardConfigUpdate host route (§3.1)', () => {
    it('persists a valid new registry and returns it', async () => {
      const api = await getApi();
      const newRegistry: KnowledgeRoleRegistryFile = {
        version: 1 as const,
        defaultRoleId: 'knowledge-steward',
        roles: [
          {
            roleId: 'knowledge-steward',
            enabled: true,
            capabilities: {
              canSearch: true,
              canRead: false,
              canProposeDraft: false,
              canClassify: false,
              canSuggestMerge: false,
              canSuggestArchive: false,
              canApplyDirectly: false,
            },
            scope: { workspace: true, agent: false, global: false },
          },
        ],
      };
      const updateResult = await api.stewardConfigUpdate({ registry: newRegistry });
      expect(updateResult.success).toBe(true);
      expect(updateResult.registry.roles).toHaveLength(1);

      // Verify the file was actually written by reading it back through Get.
      // Note: knowledge-api caches the registry in `cachedRoleRegistry` after
      // a successful write, so a fresh API instance reads from the cache.
      const api2 = await getApi();
      const getResult = await api2.stewardConfigGet();
      expect(getResult.registry.roles[0].capabilities.canSearch).toBe(true);
    });

    it('refuses to persist a registry that normalizes to DEFAULT_REGISTRY (zero accepted roles)', async () => {
      const api = await getApi();
      const updateResult = await api.stewardConfigUpdate({
        // Intentionally invalid: the boundary test submits canApplyDirectly=true.
        registry: {
          version: 1,
          defaultRoleId: 'knowledge-steward',
          roles: [
            // Entry that will be rejected (canApplyDirectly: true) → zero accepted roles
            { roleId: 'knowledge-steward', enabled: true, capabilities: { canApplyDirectly: true }, scope: {} },
          ],
        } as unknown as KnowledgeRoleRegistryFile,
      });
      expect(updateResult.success).toBe(false);
      expect(updateResult.issues?.length).toBeGreaterThan(0);
      // Underlying registry unchanged
      const api2 = await getApi();
      const getResult = await api2.stewardConfigGet();
      expect(getResult.registry.roles).toHaveLength(1);
      expect(getResult.registry.roles[0].capabilities.canApplyDirectly).toBe(false);
    });

    it('refuses to set defaultRoleId to a role not in the registry', async () => {
      const api = await getApi();
      const updateResult = await api.stewardConfigUpdate({
        defaultRoleId: 'nonexistent',
      });
      expect(updateResult.success).toBe(false);
      expect(updateResult.error).toContain('defaultRoleId');
    });

    it('changes defaultRoleId to an existing role when valid', async () => {
      const api = await getApi();
      // First install two roles
      await api.stewardConfigUpdate({
        registry: {
          version: 1,
          defaultRoleId: 'knowledge-steward',
          roles: [
            {
              roleId: 'knowledge-steward',
              enabled: true,
              capabilities: {
                canSearch: true,
                canRead: true,
                canProposeDraft: true,
                canClassify: true,
                canSuggestMerge: true,
                canSuggestArchive: true,
                canApplyDirectly: false,
              },
              scope: { workspace: true, agent: false, global: false },
            },
            {
              roleId: 'knowledge-curator',
              enabled: true,
              capabilities: {
                canSearch: true,
                canRead: true,
                canProposeDraft: true,
                canClassify: true,
                canSuggestMerge: true,
                canSuggestArchive: true,
                canApplyDirectly: false,
              },
              scope: { workspace: true, agent: false, global: false },
            },
          ],
        },
      });
      // Now switch default
      const updateResult = await api.stewardConfigUpdate({
        defaultRoleId: 'knowledge-curator',
      });
      expect(updateResult.success).toBe(true);
      expect(updateResult.registry.defaultRoleId).toBe('knowledge-curator');
    });
  });
});
