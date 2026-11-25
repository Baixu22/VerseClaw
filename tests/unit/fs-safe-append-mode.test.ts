// @vitest-environment node
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appendRegularFile, appendRegularFileSync } from '../../openclaw_runtime/src/infra/regular-file';

let root: string;
let file: string;
const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
const euidDescriptor = Object.getOwnPropertyDescriptor(process, 'geteuid');
const realPlatform = process.platform;

beforeEach(() => {
  root = fs.mkdtempSync(join(tmpdir(), 'g3-append-mode-'));
  file = join(root, 'events.jsonl');
  fs.writeFileSync(file, 'before\n', { mode: 0o600 });
});

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(process, 'platform', platformDescriptor);
  if (euidDescriptor) Object.defineProperty(process, 'geteuid', euidDescriptor);
  else Reflect.deleteProperty(process, 'geteuid');
  const offset = relative(resolve(tmpdir()), resolve(root));
  expect(offset !== '..' && !offset.startsWith(`..${sep}`)).toBe(true);
  if (fs.existsSync(file)) fs.chmodSync(file, 0o600);
  fs.rmSync(root, { recursive: true, force: true });
});

for (const method of ['sync', 'async'] as const) {
  const append = (mode?: number) => method === 'sync'
    ? Promise.resolve().then(() => appendRegularFileSync({ filePath: file, content: 'after\n', mode }))
    : appendRegularFile({ filePath: file, content: 'after\n', mode });

  async function observeChmod() {
    if (method === 'sync') return vi.spyOn(fs, 'fchmodSync');
    const handle = await fsp.open(file, 'a');
    const prototype = Object.getPrototypeOf(handle) as { chmod: (mode: number) => Promise<void> };
    await handle.close();
    return vi.spyOn(prototype, 'chmod');
  }

  describe(`${method} regular-file append permissions`, () => {
    it('appends through checked private descriptors without rewriting matching permissions', async () => {
      const chmod = await observeChmod();
      await append();
      await append();
      expect(chmod).not.toHaveBeenCalled();
      expect(fs.readFileSync(file, 'utf8')).toBe('before\nafter\nafter\n');
      if (realPlatform !== 'win32') expect(fs.statSync(file).mode & 0o7777).toBe(0o600);
    });

    it('corrects nonmatching POSIX permissions before append and propagates correction failure', async () => {
      fs.chmodSync(file, 0o666);
      Object.defineProperty(process, 'platform', { ...platformDescriptor, value: 'linux' });
      const chmod = await observeChmod();
      const error = Object.assign(new Error('mode correction denied'), { code: 'EACCES' });
      if (method === 'sync') chmod.mockImplementationOnce(() => { throw error; });
      else chmod.mockImplementationOnce(() => Promise.reject(error));
      await expect(append()).rejects.toThrow('mode correction denied');
      expect(fs.readFileSync(file, 'utf8')).toBe('before\n');
      expect(chmod).toHaveBeenCalledTimes(1);
      await append();
      expect(chmod).toHaveBeenCalledTimes(2);
      expect(fs.readFileSync(file, 'utf8')).toBe('before\nafter\n');
      if (realPlatform !== 'win32') expect(fs.statSync(file).mode & 0o7777).toBe(0o600);
    });

    it.runIf(realPlatform !== 'win32')('clears unexpected POSIX special bits', async () => {
      fs.chmodSync(file, 0o4600);
      await append();
      expect(fs.statSync(file).mode & 0o7777).toBe(0o600);
    });

    it('requires POSIX special-bit correction before writing even when normal bits match', async () => {
      const stat = fs.statSync(file);
      stat.mode = (stat.mode & ~0o7777) | 0o4600;
      Object.defineProperty(process, 'platform', { ...platformDescriptor, value: 'linux' });
      Object.defineProperty(process, 'geteuid', { configurable: true, value: () => stat.uid });
      const chmod = await observeChmod();
      if (method === 'sync') vi.spyOn(fs, 'fstatSync').mockReturnValue(stat);
      else {
        const handle = await fsp.open(file, 'a');
        const prototype = Object.getPrototypeOf(handle) as { stat: () => Promise<fs.Stats> };
        await handle.close();
        vi.spyOn(prototype, 'stat').mockResolvedValue(stat);
      }
      chmod.mockImplementationOnce(() => { throw new Error('special-bit correction denied'); });
      await expect(append()).rejects.toThrow('special-bit correction denied');
      expect(chmod).toHaveBeenCalledTimes(1);
      expect(chmod.mock.calls[0].at(-1)).toBe(0o600);
      expect(fs.readFileSync(file, 'utf8')).toBe('before\n');
    });

    it('retains POSIX chmod authorization for another owner with matching mode', async () => {
      fs.chmodSync(file, 0o666);
      const owner = fs.statSync(file).uid;
      Object.defineProperty(process, 'platform', { ...platformDescriptor, value: 'linux' });
      Object.defineProperty(process, 'geteuid', { configurable: true, value: () => owner + 1 });
      const chmod = await observeChmod();
      chmod.mockImplementationOnce(() => { throw new Error('owner cannot chmod'); });
      await expect(append(0o666)).rejects.toThrow('owner cannot chmod');
      expect(chmod).toHaveBeenCalledTimes(1);
      expect(fs.readFileSync(file, 'utf8')).toBe('before\n');
    });

    it.runIf(realPlatform === 'win32')('preserves an explicit read-only mode and rejects another append', async () => {
      const chmod = await observeChmod();
      await append(0o400);
      expect(chmod).toHaveBeenCalledTimes(1);
      expect(fs.statSync(file).mode & 0o200).toBe(0);
      await expect(append()).rejects.toThrow();
      expect(fs.readFileSync(file, 'utf8')).toBe('before\nafter\n');
    });

    it('rejects a hardlink before changing mode or writing', async () => {
      const linked = join(root, 'linked.jsonl');
      fs.linkSync(file, linked);
      const chmod = await observeChmod();
      await expect(append()).rejects.toThrow('hardlinked');
      expect(chmod).not.toHaveBeenCalled();
      expect(fs.readFileSync(file, 'utf8')).toBe('before\n');
      expect(fs.readFileSync(linked, 'utf8')).toBe('before\n');
    });
  });
}
