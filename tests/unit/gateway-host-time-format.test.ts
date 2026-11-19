// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const exec = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ execFileSync: exec }));
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
const nativeDateTimeFormat = Intl.DateTimeFormat;
beforeEach(() => {
  vi.resetModules();
  exec.mockReset();
  Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });
  vi.stubEnv('SystemRoot', 'C:\\Windows');
});
afterEach(() => {
  Object.defineProperty(process, 'platform', platform);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it.each([['H:mm', '24'], ['h:mm tt', '12']] as const)('reads the host short-time pattern %s without a shell profile', async (pattern, format) => {
  exec.mockReturnValue(`HKEY_CURRENT_USER\\Control Panel\\International\r\n    sShortTime    REG_SZ    ${pattern}\r\n`);
  const { resolveUserTimeFormat } = await import('../../openclaw_runtime/src/agents/date-time');
  expect(resolveUserTimeFormat('auto')).toBe(format);
  expect(resolveUserTimeFormat('auto')).toBe(format);
  expect(exec).toHaveBeenCalledTimes(1);
  expect(exec).toHaveBeenCalledWith('C:\\Windows\\System32\\reg.exe', [
    'query', 'HKCU\\Control Panel\\International', '/v', 'sShortTime',
  ], expect.objectContaining({ windowsHide: true, timeout: 1000 }));
});

it('keeps explicit formats independent of host detection', async () => {
  const { resolveUserTimeFormat } = await import('../../openclaw_runtime/src/agents/date-time');
  expect(resolveUserTimeFormat('12')).toBe('12');
  expect(resolveUserTimeFormat('24')).toBe('24');
  expect(exec).not.toHaveBeenCalled();
});

it.each(['unavailable', 'invalid'])('uses the existing Intl fallback when the host setting is %s', async mode => {
  if (mode === 'unavailable') exec.mockImplementation(() => { throw new Error('Access denied'); });
  else exec.mockReturnValue('HKEY_CURRENT_USER\\Control Panel\\International\r\n    otherValue REG_SZ bad\r\n');
  vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function () {
    const formatter = new nativeDateTimeFormat();
    Object.defineProperty(formatter, 'format', { value: () => '13' });
    return formatter;
  });
  const { resolveUserTimeFormat } = await import('../../openclaw_runtime/src/agents/date-time');
  expect(resolveUserTimeFormat('auto')).toBe('24');
});
