// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

const { probe } = vi.hoisted(() => ({ probe: vi.fn() }));
vi.mock('node:child_process', async () => {
  const { promisify } = await import('node:util');
  return { execFile: Object.assign(vi.fn(), { [promisify.custom]: probe }) };
});

import { captureProcessTrees, verifyProcessTreesTerminated } from '../../openclaw_runtime/src/process/os-containment';

const platform = process.platform;
const timestamp = '20261120120000.123456+480';
const fileTime = ((BigInt(Date.UTC(2026, 10, 20, 4)) + 11644473600000n) * 10000n + 1234560n).toString();
const ps = (token = fileTime) => ({ stdout: `100\t1\t${token}\n` });
const wmic = (token = timestamp) => ({ stdout: `Node,CreationDate,ParentProcessId,ProcessId\nhost,${token},1,100\n` });

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  vi.useRealTimers();
  probe.mockReset();
});

describe('Windows containment process tokens', () => {
  it.each([
    ['powershell', timestamp],
    ['wmic', timestamp],
    ['powershell', '20261119190000.123456-540'],
    ['wmic', '20261120040000.123456+000'],
  ])('preserves process identity when switching from %s with %s', async (first, creationTime) => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    vi.useFakeTimers();
    if (first === 'powershell') probe.mockResolvedValueOnce(ps());
    else probe.mockRejectedValueOnce(new Error('CIM unavailable')).mockResolvedValueOnce(wmic(creationTime));
    const capture = await captureProcessTrees([100]);
    expect(capture.status).toBe('ok');
    if (first === 'powershell') probe.mockRejectedValueOnce(new Error('CIM unavailable')).mockResolvedValueOnce(wmic(creationTime));
    else probe.mockResolvedValueOnce(ps());
    probe.mockResolvedValue({ stdout: `200\t1\t${fileTime}\n` });
    const result = verifyProcessTreesTerminated(capture);
    await vi.advanceTimersByTimeAsync(101);
    expect(await result).toEqual({ status: 'empty' });
  });

  it('keeps a genuinely changed creation time unknown', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    probe.mockResolvedValueOnce(ps());
    const capture = await captureProcessTrees([100]);
    probe.mockRejectedValueOnce(new Error('CIM unavailable')).mockResolvedValueOnce(wmic('20261120120000.123457+480'));
    expect(await verifyProcessTreesTerminated(capture)).toMatchObject({ status: 'unknown', detail: expect.stringContaining('reused') });
  });

  it.each(['powershell', 'wmic'])('excludes a one-microsecond older child while retaining a same-tick child via %s', async (provider) => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    const parent = (BigInt(fileTime) + 20n).toString();
    const older = (BigInt(fileTime) + 10n).toString();
    if (provider === 'powershell') probe.mockResolvedValueOnce({ stdout: `100\t1\t${parent}\n101\t100\t${older}\n102\t100\t${parent}\n` });
    else probe.mockRejectedValueOnce(new Error('CIM unavailable')).mockResolvedValueOnce({
      stdout: 'Node,CreationDate,ParentProcessId,ProcessId\nhost,20261120120000.123458+480,1,100\nhost,20261120120000.123457+480,100,101\nhost,20261120120000.123458+480,100,102\n',
    });
    const capture = await captureProcessTrees([100]);
    expect(capture.status).toBe('ok');
    expect([...capture.capturedPids.keys()]).toEqual([100, 102]);
  });

  it('rejects malformed creation times instead of treating the captured process as absent', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    probe.mockResolvedValueOnce(ps());
    const capture = await captureProcessTrees([100]);
    probe.mockRejectedValueOnce(new Error('CIM unavailable')).mockResolvedValueOnce(wmic('20261320120000.123456+480'));
    expect(await verifyProcessTreesTerminated(capture)).toMatchObject({ status: 'unknown' });
  });
});
