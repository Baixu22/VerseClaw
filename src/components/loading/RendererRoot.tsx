import { lazy, Suspense } from 'react';
import { HashRouter } from 'react-router-dom';
import { RendererBootstrapBoundary } from './RendererBootstrapBoundary';
import { VerseBootSplash } from './VerseBootSplash';

const App = lazy(() => import('@/App'));

export function RendererRoot() {
  return (
    <RendererBootstrapBoundary>
      <HashRouter>
        <Suspense fallback={<VerseBootSplash />}>
          <App />
        </Suspense>
      </HashRouter>
    </RendererBootstrapBoundary>
  );
}
