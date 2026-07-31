import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionSearchModal, type SessionSearchModalProps } from '@/components/layout/SessionSearchModal';

const getSessionActivityMs = vi.hoisted(() => vi.fn(() => 100));

vi.mock('@/components/layout/session-buckets', () => ({ getSessionActivityMs }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const baseProps: SessionSearchModalProps = {
  open: false,
  onClose: vi.fn(),
  sessions: [{ key: 'agent:main:session-100', displayName: 'Session A' }],
  currentSessionKey: 'agent:main:session-100',
  sessionLabels: {},
  sessionLastActivity: {},
  workspaces: [],
  agentNameById: { main: 'Main' },
  onSwitch: vi.fn(),
};

describe('SessionSearchModal closed-state work', () => {
  beforeEach(() => {
    getSessionActivityMs.mockClear();
  });

  it('does not build or sort results until the modal opens', () => {
    const { rerender } = render(<SessionSearchModal {...baseProps} />);

    expect(getSessionActivityMs).not.toHaveBeenCalled();
    rerender(
      <SessionSearchModal
        {...baseProps}
        sessions={[
          ...baseProps.sessions,
          { key: 'agent:main:session-200', displayName: 'Session B' },
        ]}
      />,
    );
    expect(getSessionActivityMs).not.toHaveBeenCalled();

    rerender(<SessionSearchModal {...baseProps} open />);
    expect(screen.getByTestId('session-search-modal')).toBeInTheDocument();
    expect(getSessionActivityMs).toHaveBeenCalledTimes(1);
  });
});
