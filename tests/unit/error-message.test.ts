import { describe, expect, it } from 'vitest';

import { AppError, toUserMessage } from '@/lib/error-message';

describe('error-message', () => {
  it('returns user-facing message for permission error', () => {
    const msg = toUserMessage(new AppError('PERMISSION', 'forbidden'));
    expect(msg).toContain('Permission denied');
  });

  it('returns user-facing message for auth invalid error', () => {
    const msg = toUserMessage(new AppError('AUTH_INVALID', 'Invalid Authentication'));
    expect(msg).toContain('Authentication failed');
  });

  it('returns user-facing message for channel unavailable error', () => {
    const msg = toUserMessage(new AppError('CHANNEL_UNAVAILABLE', 'Invalid IPC channel'));
    expect(msg).toContain('Service channel unavailable');
  });

  it('sanitizes the UNKNOWN branch instead of returning the raw message (R2)', () => {
    const raw = 'read failed at C:\\Users\\me\\secret\\file.ts sk-proj-1234567890abcdefgh'
      + '\n    at Module.load (node:internal)';
    const msg = toUserMessage(new AppError('UNKNOWN', raw));
    expect(msg).not.toContain('at Module.load');
    expect(msg).not.toContain('sk-proj-1234567890abcdefgh');
    expect(msg.length).toBeGreaterThan(0);
  });
});
