// @vitest-environment node
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveE2EElectronExecutable } from '../e2e/fixtures/electron-executable.mjs';

describe('E2E Electron executable', () => {
  const defaultExecutable = 'C:/runtime/electron.exe';

  it('keeps the installed runtime by default', () => {
    expect(resolveE2EElectronExecutable(undefined, {
      CLAWX_E2E_DEFAULT_EXECUTABLE: defaultExecutable,
    })).toBe(defaultExecutable);
  });

  it('uses an absolute staged runtime for the E2E launch', () => {
    expect(resolveE2EElectronExecutable(undefined, {
      CLAWX_E2E_EXECUTABLE_PATH: ' D:/tmp/medium-electron/electron.exe ',
      CLAWX_E2E_DEFAULT_EXECUTABLE: defaultExecutable,
    })).toBe(resolve('D:/tmp/medium-electron/electron.exe'));
  });

  it('preserves an explicit per-test executable over the staged default', () => {
    expect(resolveE2EElectronExecutable('packaged.exe', {
      CLAWX_E2E_EXECUTABLE_PATH: 'staged.exe',
    })).toBe('packaged.exe');
  });
});
