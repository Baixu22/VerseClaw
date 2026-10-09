/**
 * Application Configuration
 * Centralized configuration constants and helpers
 */

import { OPENCLAW_GATEWAY_PORT } from '@shared/gateway-endpoint';

/**
 * Port configuration
 */
export const PORTS = {
  /** Verse Claw GUI development server port */
  VERSE_CLAW_DEV: 5173,
  
  /** Verse Claw GUI production port (for reference) */
  VERSE_CLAW_GUI: 23333,

  /** Local host API server port */
  VERSE_CLAW_HOST_API: 13210,
  
  /** OpenClaw Gateway port (single source: shared/gateway-endpoint.ts) */
  OPENCLAW_GATEWAY: OPENCLAW_GATEWAY_PORT,
} as const;

/**
 * Get port from environment or default
 */
export function getPort(key: keyof typeof PORTS): number {
  const envKey = `VERSE_CLAW_PORT_${key}`;
  const envValue = process.env[envKey];
  return envValue ? parseInt(envValue, 10) : PORTS[key];
}

/**
 * Application paths
 */
export const APP_PATHS = {
  /** OpenClaw configuration directory */
  OPENCLAW_CONFIG: '~/.openclaw',
  
  /** Verse Claw configuration directory */
  VERSE_CLAW_CONFIG: '~/.clawx',
  
  /** Log files directory */
  LOGS: '~/.clawx/logs',
} as const;

/**
 * Gateway configuration
 */
export const GATEWAY_CONFIG = {
  /** WebSocket reconnection delay (ms) */
  RECONNECT_DELAY: 5000,
  
  /** RPC call timeout (ms) */
  RPC_TIMEOUT: 30000,
  
  /** Health check interval (ms) */
  HEALTH_CHECK_INTERVAL: 30000,
  
  /** Maximum startup retries */
  MAX_STARTUP_RETRIES: 30,
  
  /** Startup retry interval (ms) */
  STARTUP_RETRY_INTERVAL: 1000,
};
