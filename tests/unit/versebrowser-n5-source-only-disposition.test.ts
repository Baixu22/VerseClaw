import { describe, expect, it, vi } from 'vitest';
import {
  DRIVER_UNAVAILABLE_ACTIONS,
  createAgentBrowserTool,
} from '../../openclaw_runtime/src/agents/tools/agent-browser-tool';
import { MODEL_ACTION_NAMES } from '@electron/services/agent-browser-capabilities';
import { getAgentBrowserCapabilities } from '@electron/services/agent-browser-api';

describe('source-only addition disposition (spec N5)', () => {
  it('covers exactly the 13 source-only additions', () => {
    expect([...DRIVER_UNAVAILABLE_ACTIONS].sort()).toEqual([
      'appendText', 'downloadFile', 'drag', 'findElement', 'pointer', 'readDialogs',
      'readForms', 'respondDialog', 'selectOption', 'selectValues', 'semanticRead',
      'setChecked', 'uploadFiles',
    ]);
  });

  it('never advertises them by default, but still declares them for the contract', () => {
    const tool = createAgentBrowserTool({ invoke: vi.fn() as never });
    const schemaText = JSON.stringify(tool!.parameters);
    for (const action of DRIVER_UNAVAILABLE_ACTIONS) {
      expect(schemaText, action).not.toContain(`"${action}"`);
      // declared (contract/api-coverage still require the full source-method list)
      expect(MODEL_ACTION_NAMES as readonly string[]).toContain(action);
    }
  });

  it('agrees with the live capability snapshot (drift guard)', () => {
    const snapshot = getAgentBrowserCapabilities();
    const unavailable = new Set(snapshot.actions.filter((entry) => !entry.available).map((entry) => entry.action));
    for (const action of DRIVER_UNAVAILABLE_ACTIONS) {
      expect(unavailable.has(action as never), action).toBe(true);
    }
    // The snapshot must not report any of them as available.
    const advertised = new Set(snapshot.actions.filter((entry) => entry.available).map((entry) => entry.action));
    for (const action of DRIVER_UNAVAILABLE_ACTIONS) {
      expect(advertised.has(action as never), action).toBe(false);
    }
  });

  it('rejects every one of them before the invoker runs (no browser effect)', async () => {
    const invoke = vi.fn(async (action: string) => ({ action }));
    const tool = createAgentBrowserTool({ invoke: invoke as never });
    for (const action of DRIVER_UNAVAILABLE_ACTIONS) {
      await expect(tool!.execute('t-' + action, { action, sessionId: 's1' })).rejects.toThrow(/not available/);
    }
    expect(invoke).not.toHaveBeenCalled();
  });
});
