import { Component, type ErrorInfo, type ReactNode } from 'react';
import i18n from '@/i18n';
import { recoverFromDynamicImportLoadError } from '@/lib/dynamic-import-recovery';

export class RendererBootstrapBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (recoverFromDynamicImportLoadError(error)) return;
    document.getElementById('boot-shell')?.remove();
    console.error('Renderer bootstrap failed:', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-8 text-foreground">
        <button
          type="button"
          className="rounded-lg bg-primary px-4 py-2 text-primary-foreground"
          onClick={() => window.location.reload()}
        >
          {i18n.t('menu:view.reload')}
        </button>
      </div>
    );
  }
}
