import { describe, expect, it } from 'vitest';
import {
  assertAuthorizedHostSender,
  sanitizeHostErrorMessage,
  validateHostPayload,
} from '../../electron/main/ipc/host-invoke-security';

describe('host-invoke-security helpers', () => {
  it('rejects deep payloads', () => {
    let nested: Record<string, unknown> = { v: 1 };
    for (let i = 0; i < 20; i += 1) nested = { child: nested };
    expect(validateHostPayload(nested)?.message).toMatch(/max depth/i);
  });

  it('allows authorized senders only', () => {
    const auth = { allowedWebContentsIds: new Set([1]) };
    expect(assertAuthorizedHostSender({ sender: { id: 1 } }, auth)).toBeNull();
    expect(assertAuthorizedHostSender({ sender: { id: 2 } }, auth)?.message).toMatch(/not authorized/i);
  });

  it('redacts path/stack/secret fragments', () => {
    const msg = sanitizeHostErrorMessage(
      'boom C:\\Users\\bob\\clawx\\secret.ts\n    at fail (C:\\Users\\bob\\x.js:1:1)\ntoken=abc123secret',
    );
    expect(msg).not.toContain('bob');
    expect(msg).not.toContain('abc123secret');
    expect(msg.toLowerCase()).toContain('redacted');
  });
});
