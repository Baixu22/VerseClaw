/**
 * React Application Entry Point
 */
// Mock host bridge for browser-only UI development (`?mock=1`). Must be the
// FIRST import: stores cache their first host response (e.g. gateway status)
// and a missing bridge would freeze them in a failed state for the session.
// A plain statement here would be too late — ESM runs all imports first.
// The real Electron bridge is never masked.
import './lib/install-mock-host-bridge';
import React from 'react';
import ReactDOM from 'react-dom/client';
import './i18n';
import './styles/globals.css';
import { RendererRoot } from './components/loading/RendererRoot';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RendererRoot />
  </React.StrictMode>,
);
