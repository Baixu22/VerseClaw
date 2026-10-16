import { describe, expect, it } from 'vitest';
import {
  MODEL_ACTION_NAMES,
  availableModelActions,
  modelActionCapabilities,
  type DriverProfileLike,
} from '@electron/services/agent-browser-capabilities';
import { getAgentBrowserCapabilities } from '@electron/services/agent-browser-api';

const noneProfile: DriverProfileLike = { kind: 'none', methods: new Set<string>() };
const injectedFullProfile: DriverProfileLike = { kind: 'injected', methods: null };
const playwrightProfile: DriverProfileLike = {
  kind: 'playwright',
  methods: new Set(['open', 'status', 'navigate', 'waitForSelector', 'click', 'type', 'evaluate', 'screenshot', 'close', 'getConsoleMessages']),
};
const refusalProfile: DriverProfileLike = {
  kind: 'host-api',
  methods: new Set(['open', 'downloadFile', 'uploadFiles']),
  unavailableMethods: new Set(['downloadFile']),
};

describe('model action capability snapshot', () => {
  it('keeps the canonical vocabulary and ordering', () => {
    const snapshot = modelActionCapabilities(injectedFullProfile, { cliAvailable: true });
    expect(snapshot.actions.map((entry) => entry.action)).toEqual([...MODEL_ACTION_NAMES]);
    expect(snapshot.actions).toHaveLength(24);
  });

  it('disables every driver action when no driver is active but keeps facade-local actions', () => {
    const snapshot = modelActionCapabilities(noneProfile, { cliAvailable: false });
    expect(availableModelActions(snapshot)).toEqual(['status']);
  });

  it('does not advertise an action whose driver method is a refusal stub', () => {
    const snapshot = modelActionCapabilities(refusalProfile, { cliAvailable: true });
    const download = snapshot.actions.find((entry) => entry.action === 'downloadFile')!;
    expect(download.available).toBe(false);
    expect(download.reason).toMatch(/refuses them|E_NOT_IMPLEMENTED/);
    const upload = snapshot.actions.find((entry) => entry.action === 'uploadFiles')!;
    expect(upload.available).toBe(true);
    const select = snapshot.actions.find((entry) => entry.action === 'selectOption')!;
    expect(select.available).toBe(false);
    expect(select.reason).toMatch(/does not serve/);
  });

  it('gates the CLI-dependent action on the executable, not on the driver contract', () => {
    const withCli = modelActionCapabilities(playwrightProfile, { cliAvailable: true });
    const withoutCli = modelActionCapabilities(playwrightProfile, { cliAvailable: false });
    expect(withCli.actions.find((entry) => entry.action === 'command')!.available).toBe(true);
    const command = withoutCli.actions.find((entry) => entry.action === 'command')!;
    expect(command.available).toBe(false);
    expect(command.reason).toMatch(/agent-browser CLI/);
    expect(withCli.version).not.toEqual(withoutCli.version);
  });

  it('is deterministic: identical facts produce an identical version', () => {
    const a = modelActionCapabilities(playwrightProfile, { cliAvailable: true });
    const b = modelActionCapabilities(playwrightProfile, { cliAvailable: true });
    expect(a.version).toEqual(b.version);
    const c = modelActionCapabilities(playwrightProfile, { cliAvailable: false });
    expect(c.version).not.toEqual(a.version);
  });

  it('reflects the real Electron driver only through the facade driver profile', () => {
    const snapshot = getAgentBrowserCapabilities();
    expect(snapshot.actions).toHaveLength(24);
    const byAction = new Map(snapshot.actions.map((entry) => [entry.action, entry]));
    for (const action of ['open', 'navigate', 'click', 'type', 'evaluate', 'screenshot', 'close', 'status'] as const) {
      expect(byAction.get(action)!.available, action).toBe(true);
    }
    for (const action of ['downloadFile', 'uploadFiles', 'pointer', 'drag', 'selectOption', 'selectValues', 'appendText', 'setChecked', 'findElement', 'semanticRead', 'readForms', 'readDialogs', 'respondDialog'] as const) {
      const entry = byAction.get(action)!;
      expect(entry.available, action).toBe(false);
      expect(entry.reason, action).toBeTruthy();
    }
    // The optional CLI binary is not bundled in this checkout.
    expect(byAction.get('command')!.available).toBe(false);
  });
});
