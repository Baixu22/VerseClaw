/**
 * React Application Entry Point
 */
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
