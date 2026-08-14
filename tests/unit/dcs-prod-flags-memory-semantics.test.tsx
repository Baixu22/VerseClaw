// R7-1 T4: the DCS prod-flags panel renders the R3-2 unavailableReason for
// the three memory switches plus a semantic-boundary explanation, in the
// user's language. Data reuse only — no new state fields.

import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DcsProdFlagsPanel } from '@/components/settings/DcsProdFlagsPanel';

const getFlagsMock = vi.fn();
const getPreviewMock = vi.fn();

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    dcsProdFlags: {
      getFlags: () => getFlagsMock(),
      getPreview: () => getPreviewMock(),
    },
  },
}));

const LABELS: Record<string, string> = {
  'developer.dcsProdFlags.title': 'DCS Controlled Preview Flags',
  'developer.dcsProdFlags.description': 'Advanced opt-in DCS control plane.',
  'developer.dcsProdFlags.modeOptIn': 'status: opt-in',
  'developer.dcsProdFlags.defaultLabel': 'Default',
  'developer.dcsProdFlags.enableLabel': 'Enable',
  'developer.dcsProdFlags.rollbackLabel': 'Rollback',
  'developer.dcsProdFlags.riskLabel': 'Risk',
  'developer.dcsProdFlags.readOnlyNote': 'This row is documentation-only.',
  'developer.dcsProdFlags.enableViaSettings': 'Use the switch above.',
  'developer.dcsProdFlags.rollbackViaSettings': 'Turn the switch off.',
  'developer.dcsProdFlags.toggleLabel': 'Enable (opt-in)',
  'developer.dcsProdFlags.on': 'on',
  'developer.dcsProdFlags.off': 'off',
  'developer.dcsProdFlags.refresh': 'Refresh',
  'developer.dcsProdFlags.taskLoopNote': 'TaskLoop note.',
  'developer.dcsProdFlags.unavailableReasonLabel': 'Unavailable reason',
  'developer.dcsProdFlags.memoryBoundaryNote':
    'Memory switches control the injection/write channel only. Injected facts are candidate hints the model may ignore; durable persistence requires human confirmation; turning a switch off never deletes existing memory.',
  'developer.dcsPreview.title': 'DCS Coding Controlled Preview',
  'developer.dcsPreview.description': 'One switch for the first-product capability combo.',
  'developer.contextLayers.dcsTitle': 'DCS — working memory & context blocks',
};

// The t function is created once inside the mock factory so its identity is
// stable across renders: DcsProdFlagsPanel's loadFlags useCallback depends on
// `t`, and a per-render function would re-run the load effect forever.
vi.mock('react-i18next', () => {
  const t = (key: string, values?: Record<string, unknown>) => {
    const label = LABELS[key];
    if (!label) return key;
    if (!values) return label;
    return label.replace(/\{\{[^}]+\}\}/g, (token) => String(values[token.slice(2, -2).trim()] ?? token));
  };
  return {
    useTranslation: () => ({ t }),
  };
});

function buildSnapshot() {
  return {
    productionMode: 'opt-in' as const,
    flags: [
      { id: 'context-view-tools', writable: true, enabled: false, defaultEnabled: false, status: 'read-only' as const },
      { id: 'runtime-memory-persist', writable: true, enabled: false, defaultEnabled: false, status: 'read-only' as const },
      { id: 'runtime-memory-inject-pilot', writable: true, enabled: false, defaultEnabled: false, status: 'read-only' as const },
      { id: 'role-memory', writable: true, enabled: false, defaultEnabled: false, status: 'read-only' as const },
    ],
    gatewayState: 'stopped',
    updatedAt: new Date().toISOString(),
  };
}

describe('DCS prod flags memory semantics (R7-1 T4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getFlagsMock.mockResolvedValue(buildSnapshot());
    getPreviewMock.mockResolvedValue({
      enabled: false,
      partial: false,
      comboFlagIds: ['context-view-tools'],
      missingPrereqs: ['providerVerified'],
    });
  });

  it('renders the R3-2 unavailableReason and the semantic boundary for a memory switch', async () => {
    render(<DcsProdFlagsPanel />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    fireEvent.click(screen.getByTestId('settings-dcs-prod-flag-runtime-memory-persist'));

    // Pre-fix red proof: the panel never renders unavailableReason nor any
    // memory-channel boundary explanation.
    const reason = screen.getByTestId('settings-dcs-prod-flag-unavailable-reason');
    expect(reason).toHaveTextContent('E-1');
    const boundary = screen.getByTestId('settings-dcs-prod-flag-memory-boundary');
    expect(boundary).toHaveTextContent('injection/write channel only');
  });

  it('keeps non-memory writable flags free of the memory boundary note', async () => {
    render(<DcsProdFlagsPanel />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    fireEvent.click(screen.getByTestId('settings-dcs-prod-flag-context-view-tools'));

    expect(screen.queryByTestId('settings-dcs-prod-flag-memory-boundary')).not.toBeInTheDocument();
  });
});
