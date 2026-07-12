import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WebPreviewBrowser } from '@/components/ai-elements/web-preview';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

describe('WebPreviewBrowser', () => {
  it('renders compact browser navigation and a functional overflow menu', () => {
    const onBack = vi.fn();
    const onForward = vi.fn();
    const onReload = vi.fn();
    const onOpenExternal = vi.fn();

    render(
      <WebPreviewBrowser
        previewUrl="http://localhost:5173/dashboard"
        running
        onBack={onBack}
        onForward={onForward}
        onReload={onReload}
        onOpenExternal={onOpenExternal}
      >
        <div>Preview page</div>
      </WebPreviewBrowser>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(screen.getByRole('button', { name: 'Forward' }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(onBack).toHaveBeenCalledOnce();
    expect(onForward).toHaveBeenCalledOnce();
    expect(onReload).toHaveBeenCalledOnce();
    expect(screen.getByTestId('ai-web-preview-address')).toHaveTextContent('localhost:5173/dashboard');

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Browser menu' }), { button: 0, ctrlKey: false });
    expect(screen.getByRole('menu')).toBeVisible();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open externally' }));
    expect(onOpenExternal).toHaveBeenCalledOnce();
  });
});
