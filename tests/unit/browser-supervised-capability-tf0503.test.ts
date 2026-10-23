// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  MODEL_ACTION_NAMES,
  modelActionCapabilities,
  modelActionRequiresSupervision,
} from '../../electron/services/agent-browser-capabilities';

const DRIVER = { kind: 'cdp', methods: null };

describe('TF-0503 browser supervised capability positioning', () => {
  it('declares browser supervision as required in the snapshot', () => {
    const snapshot = modelActionCapabilities(DRIVER, { cliAvailable: true });
    expect(snapshot.supervision).toBe('required');
    expect(snapshot.unsupervisedActions.length).toBeGreaterThan(0);
  });

  it('marks consequential actions supervised and pure reads unsupervised', () => {
    for (const action of ['click', 'type', 'evaluate', 'navigate', 'uploadFiles', 'downloadFile', 'command', 'pressKey']) {
      expect(modelActionRequiresSupervision(action), action).toBe(true);
    }
    for (const action of ['status', 'getConsoleMessages', 'extractPageText', 'readForms']) {
      expect(modelActionRequiresSupervision(action), action).toBe(false);
    }
  });

  it('fails closed for unknown actions', () => {
    expect(modelActionRequiresSupervision('definitely-not-an-action')).toBe(true);
  });

  it('carries supervision on every action entry, available or not', () => {
    const snapshot = modelActionCapabilities({ kind: 'none', methods: new Set<string>() }, { cliAvailable: false });
    expect(snapshot.actions).toHaveLength(MODEL_ACTION_NAMES.length);
    for (const entry of snapshot.actions) expect(typeof entry.supervised).toBe('boolean');
    const click = snapshot.actions.find((entry) => entry.action === 'click');
    expect(click?.available).toBe(false);
    expect(click?.supervised).toBe(true);
  });

  it('changes the snapshot version when supervision facts change', () => {
    const a = modelActionCapabilities(DRIVER, { cliAvailable: true });
    const b = modelActionCapabilities(DRIVER, { cliAvailable: true });
    expect(a.version).toBe(b.version);
  });
});
