import { describe, expect, it } from 'vitest';
import { hostActionTimeoutMs, HOST_ACTION_LONG_TIMEOUT_MS, HOST_ACTION_DEFAULT_TIMEOUT_MS } from '../../shared/host-api/host-action-timeouts';

it('allows live-model compaction to use the existing bounded long-action budget', () => {
  expect(hostActionTimeoutMs('sessions', 'compact')).toBe(HOST_ACTION_LONG_TIMEOUT_MS);
  expect(hostActionTimeoutMs('sessions', 'compactRange')).toBe(HOST_ACTION_LONG_TIMEOUT_MS);
  expect(hostActionTimeoutMs('sessions', 'history')).toBe(HOST_ACTION_DEFAULT_TIMEOUT_MS);
});

describe('DCS mutation host timeouts', () => {
  it('allows restart plus acknowledgement while keeping reads on the normal budget', () => {
    expect(hostActionTimeoutMs('dcsProdFlags', 'setFlag')).toBe(HOST_ACTION_LONG_TIMEOUT_MS);
    expect(hostActionTimeoutMs('dcsProdFlags', 'setPreview')).toBe(HOST_ACTION_LONG_TIMEOUT_MS);
    expect(hostActionTimeoutMs('dcsProdFlags', 'getFlags')).toBe(HOST_ACTION_DEFAULT_TIMEOUT_MS);
  });

  it('allows a real multi-tool chat turn without extending ordinary host actions', () => {
    expect(hostActionTimeoutMs('chat', 'sendWithMedia')).toBe(HOST_ACTION_LONG_TIMEOUT_MS);
    expect(hostActionTimeoutMs('chat', 'history')).toBe(HOST_ACTION_DEFAULT_TIMEOUT_MS);
  });
});
