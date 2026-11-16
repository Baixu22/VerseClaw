import { describe, expect, it } from 'vitest';
import { createMcpToolCallRequestShadow, createMcpToolCallResultShadow } from '@electron/services/tool-protocol-shadow';

describe('MCP nested result diagnostics', () => {
  const request = () => createMcpToolCallRequestShadow({ serverId: 'fixture', toolName: 'echo', args: {} });
  it.each([
    { isError: true },
    { details: { status: 'error' } },
    { _meta: { 'openclaw/resultStatus': 'timeout' } },
    { details: { status: 'error', mcpMeta: { 'openclaw/resultStatus': 'unavailable' } } },
  ])('does not upgrade nested failures to success: %j', (result) => {
    expect(createMcpToolCallResultShadow(request(), { success: true, serverId: 'fixture', toolName: 'echo', result }).result.status).toBe('error');
  });
  it('retains cancellation, partial content and the original call identity', () => {
    const first = request();
    const second = request();
    const result = { isError: true, content: [{ type: 'text', text: 'partial' }], _meta: { 'openclaw/resultStatus': 'cancelled', 'openclaw/partial': true } };
    const shadow = createMcpToolCallResultShadow(first, { success: false, serverId: 'fixture', toolName: 'echo', result });
    expect(shadow.result).toMatchObject({ status: 'cancelled', callId: first.request.callId, structuredData: { legacyResult: result } });
    expect(shadow.result.callId).not.toBe(second.request.callId);
  });
  it('keeps approval waiting distinct from a completed error', () => {
    const result = { isError: true, _meta: { 'openclaw/resultStatus': 'waiting' } };
    expect(createMcpToolCallResultShadow(request(), { success: true, serverId: 'fixture', toolName: 'echo', result }))
      .toMatchObject({ shadow: { status: 'waiting', approval: { required: true } }, result: { status: 'error' } });
  });
});
