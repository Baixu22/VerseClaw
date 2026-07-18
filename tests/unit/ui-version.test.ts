import { describe, expect, it } from 'vitest';
import { resolveUiVersion } from '@/lib/ui-version';

describe('resolveUiVersion', () => {
  it('enables UI v2 by default on Windows', () => {
    expect(resolveUiVersion('win32', '')).toBe('v2');
  });

  it('keeps the legacy shell on macOS and Linux', () => {
    expect(resolveUiVersion('darwin', '')).toBe('legacy');
    expect(resolveUiVersion('linux', '')).toBe('legacy');
  });

  it('allows an explicit development override', () => {
    expect(resolveUiVersion('win32', '?uiVersion=legacy')).toBe('legacy');
    expect(resolveUiVersion('linux', '?uiVersion=v2')).toBe('v2');
  });
});

