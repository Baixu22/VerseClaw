import { describe, expect, it } from 'vitest';
import { resolveUiVersion } from '@/lib/ui-version';

describe('resolveUiVersion', () => {
  it('enables UI v2 by default on every supported desktop platform', () => {
    expect(resolveUiVersion('win32', '')).toBe('v2');
    expect(resolveUiVersion('darwin', '')).toBe('v2');
    expect(resolveUiVersion('linux', '')).toBe('v2');
  });

  it('keeps old visual query values compatible with the completed migration', () => {
    expect(resolveUiVersion('win32', '?uiVersion=legacy')).toBe('v2');
    expect(resolveUiVersion('darwin', '?uiVersion=legacy')).toBe('v2');
    expect(resolveUiVersion('linux', '?uiVersion=v2')).toBe('v2');
  });
});

