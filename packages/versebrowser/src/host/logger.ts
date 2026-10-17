/**
 * Minimal logger adapter for standalone agent-browser package.
 * Original: electron/utils/logger.ts (Electron file logger). Replaced with
 * console-backed logger so the package runs outside ClawX Electron shell.
 */
type LogFn = (...args: unknown[]) => void;

export const logger = {
  debug: ((...args: unknown[]) => { console.debug('[agent-browser]', ...args); }) as LogFn,
  info: ((...args: unknown[]) => { console.info('[agent-browser]', ...args); }) as LogFn,
  warn: ((...args: unknown[]) => { console.warn('[agent-browser]', ...args); }) as LogFn,
  error: ((...args: unknown[]) => { console.error('[agent-browser]', ...args); }) as LogFn,
};
