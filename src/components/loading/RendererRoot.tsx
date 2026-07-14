import { lazy, Suspense } from 'react';
import { HashRouter } from 'react-router-dom';
import { RendererBootstrapBoundary } from './RendererBootstrapBoundary';

const App = lazy(() => import('@/App'));

export function RendererRoot() {
  return (
    <RendererBootstrapBoundary>
      <HashRouter>
        <Suspense fallback={null}>
          <App />
        </Suspense>
      </HashRouter>
    </RendererBootstrapBoundary>
  );
}
