/**
 * React Application Entry Point
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { i18nReady } from './i18n';
import './styles/globals.css';
import './styles/structural-loading.css';
import { RendererRoot } from './components/loading/RendererRoot';
import { installMockHostBridge, isMockModeEnabled, seedMockPersistedSettings } from './lib/mock-host-bridge';
import { initRendererPerformanceMetrics } from './lib/performance-metrics';

// Mock host bridge for browser-only UI development (`?mock=1`). Must install
// BEFORE any store init or host call: stores cache their first host response
// (e.g. gateway status) and a missing bridge would freeze them in failed state
// for the session. The real Electron bridge is never masked.
if (isMockModeEnabled()) {
  seedMockPersistedSettings();
  installMockHostBridge();
}

initRendererPerformanceMetrics();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RendererRoot />
  </React.StrictMode>,
);
