// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { validateChatHistoryParams } from '../../openclaw_runtime/packages/gateway-protocol/src/index';
import { loadOptionalServerMethodModelCatalog } from '../../openclaw_runtime/src/gateway/server-methods/optional-model-catalog';
import type { GatewayRequestContext } from '../../openclaw_runtime/src/gateway/server-methods/types';

describe('worker history optional metadata', () => {
  it('accepts message-only history and does not start optional catalog discovery', async () => {
    expect(validateChatHistoryParams({ sessionKey: 'agent:main:child', includeModelMetadata: false })).toBe(true);
    const load = vi.fn(() => { throw new Error('Catalog discovery is unavailable'); });
    const context = { loadGatewayModelCatalog: load, logGateway: { debug: vi.fn() } } as unknown as GatewayRequestContext;
    expect(await loadOptionalServerMethodModelCatalog(context, 'chat.history', { enabled: false })).toBeUndefined();
    expect(load).not.toHaveBeenCalled();
  });
  it('retains optional metadata for ordinary history callers', async () => {
    const catalog = [{ id: 'configured-model' }];
    const load = vi.fn(async () => catalog);
    const context = { loadGatewayModelCatalog: load, logGateway: { debug: vi.fn() } } as unknown as GatewayRequestContext;
    expect(await loadOptionalServerMethodModelCatalog(context, 'chat.history')).toEqual(catalog);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
