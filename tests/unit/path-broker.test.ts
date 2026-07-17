import { describe, expect, it } from 'vitest';
import {
  PathBrokerError,
  assertSafeHostFilePath,
  isPathInsideLexical,
  isPathInsideWorkspaceLexical,
} from '../../electron/services/path-broker';

describe('path-broker (P1-003)', () => {
  it('rejects UNC and device namespace paths', () => {
    expect(() => assertSafeHostFilePath('\\\\server\\share\\file.txt')).toThrow(PathBrokerError);
    expect(() => assertSafeHostFilePath('\\\\.\\pipe\\foo')).toThrow(PathBrokerError);
    if (process.platform !== 'win32') {
      expect(() => assertSafeHostFilePath('/dev/null')).toThrow(PathBrokerError);
    }
  });

  it('rejects Windows ADS streams', () => {
    if (process.platform !== 'win32') return;
    expect(() => assertSafeHostFilePath('C:\\workspace\\a.txt:Zone.Identifier')).toThrow(/adsPath|Alternate data streams/i);
  });

  it('accepts normal workspace paths', () => {
    const p = process.platform === 'win32' ? 'C:\\Users\\test\\project\\file.txt' : '/home/test/project/file.txt';
    expect(assertSafeHostFilePath(p)).toBe(p);
  });

  it('detects lexical membership without following links', () => {
    const root = process.platform === 'win32' ? 'C:\\ws' : '/ws';
    const inside = process.platform === 'win32' ? 'C:\\ws\\a\\b.txt' : '/ws/a/b.txt';
    const outside = process.platform === 'win32' ? 'C:\\other\\b.txt' : '/other/b.txt';
    expect(isPathInsideWorkspaceLexical(inside, root)).toBe(true);
    expect(isPathInsideWorkspaceLexical(outside, root)).toBe(false);
    expect(isPathInsideLexical(inside, root)).toBe(true);
  });
});
