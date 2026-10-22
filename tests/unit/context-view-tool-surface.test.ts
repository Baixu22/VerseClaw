// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CONTEXT_TOOL_SUMMARY_BY_NAME,
  isContextAgentToolName,
} from '../../openclaw_runtime/src/context-engine/coding-tool-navigation.js';
import {
  CONTEXT_UNDERSTAND_TOOL_NAME,
  CONTEXT_IMPACT_TOOL_NAME,
  CONTEXT_REUSE_TOOL_NAME,
  CONTEXT_VERIFY_TOOL_NAME,
  DCS_CONTEXT_VIEW_TOOL_NAMES,
} from '../../openclaw_runtime/src/agents/tools/context-agent-tools.js';
import {
  CONTEXT_VIEW_TOOL_CATALOG,
  CONTEXT_VIEW_TOOL_CATALOG_DIGEST_SHA256,
  CONTEXT_VIEW_TOOL_NAMES,
  CONTEXT_VIEW_TOOL_SURFACE_SCHEMA,
  contextViewToolCatalogDigest,
  resolveContextViewToolSurfaceState,
  type ContextViewToolSurfaceOptions,
} from '../../openclaw_runtime/src/agents/tools/context-view-tool-surface.js';
import {
  isKnownCoreToolId,
  listCoreToolSections,
  resolveCoreToolProfilePolicy,
} from '../../openclaw_runtime/src/agents/tool-catalog.js';

const factService = {} as NonNullable<ContextViewToolSurfaceOptions['factService']>;

function canonicalDigest(entries: readonly { name: string; selector: string; summary: string }[]) {
  return createHash('sha256')
    .update(
      JSON.stringify(
        [...entries]
          .map(({ name, selector, summary }) => ({ name, selector, summary }))
          .sort((left, right) => left.name.localeCompare(right.name)),
      ),
    )
    .digest('hex');
}

describe('ContextViewToolSurface/v1', () => {
  it('keeps the four names identical across factory, surface and core catalog', () => {
    expect(CONTEXT_VIEW_TOOL_NAMES).toEqual([...DCS_CONTEXT_VIEW_TOOL_NAMES]);
    expect(new Set(CONTEXT_VIEW_TOOL_NAMES).size).toBe(4);
    const catalogIds = listCoreToolSections().flatMap((section) => section.tools.map((tool) => tool.id));
    for (const name of CONTEXT_VIEW_TOOL_NAMES) {
      expect(isKnownCoreToolId(name), name).toBe(true);
      expect(catalogIds, name).toContain(name);
      expect(resolveCoreToolProfilePolicy('coding')?.allow, name).toContain(name);
    }
    expect([
      CONTEXT_UNDERSTAND_TOOL_NAME,
      CONTEXT_IMPACT_TOOL_NAME,
      CONTEXT_REUSE_TOOL_NAME,
      CONTEXT_VERIFY_TOOL_NAME,
    ]).toEqual([...CONTEXT_VIEW_TOOL_NAMES]);
  });

  it('binds the digest to the canonical short catalog, not to full schemas', () => {
    expect(CONTEXT_VIEW_TOOL_CATALOG_DIGEST_SHA256).toBe(canonicalDigest(CONTEXT_VIEW_TOOL_CATALOG));
    expect(contextViewToolCatalogDigest()).toBe(CONTEXT_VIEW_TOOL_CATALOG_DIGEST_SHA256);
    expect(CONTEXT_VIEW_TOOL_CATALOG).toHaveLength(4);
    for (const entry of CONTEXT_VIEW_TOOL_CATALOG) {
      expect(entry.selector).toBe(`fact.view.${entry.name}`);
      expect(entry.summary).toBe(CONTEXT_TOOL_SUMMARY_BY_NAME[entry.name]);
      expect(isContextAgentToolName(entry.name)).toBe(true);
      expect(entry).not.toHaveProperty('parameters');
    }
    expect(contextViewToolCatalogDigest([...CONTEXT_VIEW_TOOL_CATALOG].reverse())).toBe(
      CONTEXT_VIEW_TOOL_CATALOG_DIGEST_SHA256,
    );
  });

  it('auto-enables only when all health and permission inputs are healthy', () => {
    const healthy = resolveContextViewToolSurfaceState({
      env: {},
      factService,
      workspaceHealthy: true,
      contextStoreHealthy: true,
      permissionAllowed: true,
    });
    expect(healthy).toMatchObject({
      schemaVersion: CONTEXT_VIEW_TOOL_SURFACE_SCHEMA,
      mode: 'healthy',
      enabled: true,
      activeToolNames: [...CONTEXT_VIEW_TOOL_NAMES],
      reason: null,
      recoverable: true,
    });
    expect(healthy.catalogDigest).toBe(CONTEXT_VIEW_TOOL_CATALOG_DIGEST_SHA256);
  });

  it('makes missing dependency, store failure and permission denial disk-readable', () => {
    const cases: Array<[ContextViewToolSurfaceOptions, string, boolean]> = [
      [{ env: {} }, 'missing-dependency', true],
      [{ env: {}, factService, workspaceHealthy: false }, 'missing-dependency', true],
      [{ env: {}, factService, contextStoreHealthy: false }, 'context-store-unavailable', true],
      [{ env: {}, factService, permissionAllowed: false }, 'permission-denied', false],
    ];
    for (const [options, mode, recoverable] of cases) {
      const state = resolveContextViewToolSurfaceState(options);
      expect(state.mode, mode).toBe(mode);
      expect(state.enabled).toBe(false);
      expect(state.activeToolNames).toEqual([]);
      expect(state.reason).toBeTruthy();
      expect(state.recoverable).toBe(recoverable);
      expect(state.catalog).toEqual(CONTEXT_VIEW_TOOL_CATALOG);
      expect(state.catalogDigest).toBe(CONTEXT_VIEW_TOOL_CATALOG_DIGEST_SHA256);
    }
  });

  it('treats an explicit false env or option as rollback without bypassing health checks', () => {
    for (const state of [
      resolveContextViewToolSurfaceState({ env: { OPENCLAW_DCS_CONTEXT_VIEW_TOOLS: '0' }, factService }),
      resolveContextViewToolSurfaceState({ env: {}, factService, viewToolsEnabled: false }),
    ]) {
      expect(state.mode).toBe('explicitly-disabled');
      expect(state.enabled).toBe(false);
      expect(state.activeToolNames).toEqual([]);
    }
    const forced = resolveContextViewToolSurfaceState({
      env: { OPENCLAW_DCS_CONTEXT_VIEW_TOOLS: '1' },
      factService,
      workspaceHealthy: false,
      permissionAllowed: false,
    });
    expect(forced.mode).toBe('missing-dependency');
    expect(forced.enabled).toBe(false);
  });

  it('does not advertise a tool that cannot be called', () => {
    for (const options of [
      { env: {} },
      { env: {}, factService, permissionAllowed: false },
      { env: { OPENCLAW_DCS_CONTEXT_VIEW_TOOLS: '0' }, factService },
    ] as ContextViewToolSurfaceOptions[]) {
      const state = resolveContextViewToolSurfaceState(options);
      expect(state.enabled).toBe(false);
      expect(state.activeToolNames).toEqual([]);
      expect(state.catalog.map((entry) => entry.name)).toEqual([...CONTEXT_VIEW_TOOL_NAMES]);
    }
  });
});
