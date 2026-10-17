// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { AgentBrowserFacade, createAgentBrowserApi } from '@verse-claw/versebrowser';

// No browser, task store or user configuration is needed to inspect the driver.
const api = createAgentBrowserApi({} as never, {} as never);
const facade = new AgentBrowserFacade({ api });
const sourceOnly = [
  'downloadFile', 'uploadFiles', 'pointer', 'drag', 'selectOption', 'selectValues',
  'appendText', 'setChecked', 'findElement', 'semanticRead', 'readForms',
  'readDialogs', 'respondDialog',
] as const;

describe('embedded driver capability boundaries', () => {
  it('does not confuse 13 facade entry points with implemented Electron methods', () => {
    expect(Object.keys(api)).toHaveLength(67);
    for (const method of sourceOnly) {
      expect(api[method]).toBeUndefined();
      expect(facade.getDriverProfile().unavailableMethods?.has(method)).toBe(true);
    }
  });

  it('returns an explicit non-success for unavailable read methods', async () => {
    for (const result of [
      await facade.readForms('not-a-real-session'),
      await facade.readDialogs('not-a-real-session'),
      await facade.findElement({ sessionId: 'not-a-real-session', role: 'button' }),
    ]) {
      expect(result).toMatchObject({ ok: false, error: { code: 'E_NOT_IMPLEMENTED' } });
    }
  });
});
