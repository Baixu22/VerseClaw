/**
 * Cron Job Type Definitions
 * Types for scheduled tasks
 */

import type { ChannelType } from './channel';

export type CronJobDeliveryMode = 'none' | 'announce';
export type CronJobSource = 'gateway' | 'config-fallback';

export interface CronJobRuntimeGuarantee {
  source: CronJobSource;
  sessionTarget: 'isolated' | 'thread' | string;
  wakeMode: 'next-heartbeat' | string;
  payloadKind: string;
}

export interface CronJobDelivery {
  mode: CronJobDeliveryMode;
  channel?: ChannelType | string;
  to?: string;
  accountId?: string;
}

/**
 * Cron job target (where to send the result)
 */
export interface CronJobTarget {
  channelType: ChannelType | string;
  channelId: string;
  channelName: string;
  recipient?: string;
}

/**
 * Cron job last run info
 */
export interface CronJobLastRun {
  time: string;
  success: boolean;
  error?: string;
  duration?: number;
}

export type CronJobTaskKind = 'agentTurn' | 'browserAutomation';
export type CronBrowserAutomationTemplate = 'checkIn' | 'monitor' | 'publishDraft' | 'custom';
export type CronBrowserAutomationAuthPersistence = 'session-name' | 'profile' | 'off';
export type CronBrowserAutomationMode = 'headless' | 'visible';
export type CronBrowserAutomationSensitiveActionPolicy = 'draft-only' | 'auto-submit';

export interface CronBrowserAutomationDiagnostics {
  snapshot?: boolean;
  console?: boolean;
  errors?: boolean;
  network?: boolean;
  screenshot?: boolean;
}

export interface CronBrowserAutomationConfig {
  url: string;
  objective: string;
  successCondition?: string;
  failureCondition?: string;
  template?: CronBrowserAutomationTemplate;
  profile?: string;
  authStateName?: string;
  authPersistence?: CronBrowserAutomationAuthPersistence;
  mode?: CronBrowserAutomationMode;
  allowedDomains?: string[];
  sensitiveActionPolicy?: CronBrowserAutomationSensitiveActionPolicy;
  retryOnTransientFailure?: boolean;
  diagnostics?: CronBrowserAutomationDiagnostics;
}

/**
 * Gateway CronSchedule object format
 */
export type CronSchedule =
  | { kind: 'at'; at: string }
  | { kind: 'every'; everyMs: number; anchorMs?: number }
  | { kind: 'cron'; expr: string; tz?: string };

/**
 * Cron job data structure
 * schedule can be a plain cron string or a Gateway CronSchedule object
 */
export interface CronJob {
  id: string;
  name: string;
  message: string;
  taskKind?: CronJobTaskKind;
  browserAutomation?: CronBrowserAutomationConfig;
  toolsAllow?: string[];
  schedule: string | CronSchedule;
  source?: CronJobSource;
  runtime?: CronJobRuntimeGuarantee;
  delivery?: CronJobDelivery;
  target?: CronJobTarget;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastRun?: CronJobLastRun;
  nextRun?: string;
  agentId: string;
  /**
   * True when a background auto-repair (delivery/agentId) failed and the
   * gateway copy is unchanged. The UI should surface this instead of
   * pretending the repair succeeded.
   */
  repairDegraded?: boolean;
}

/**
 * Input for creating a cron job from the UI.
 */
export interface CronJobCreateInput {
  name: string;
  message: string;
  taskKind?: CronJobTaskKind;
  browserAutomation?: CronBrowserAutomationConfig;
  toolsAllow?: string[];
  schedule: string;
  delivery?: CronJobDelivery;
  enabled?: boolean;
  agentId?: string;
}

/**
 * Input for updating a cron job
 */
export interface CronJobUpdateInput {
  name?: string;
  message?: string;
  taskKind?: CronJobTaskKind;
  browserAutomation?: CronBrowserAutomationConfig;
  toolsAllow?: string[];
  schedule?: string;
  delivery?: CronJobDelivery;
  enabled?: boolean;
  agentId?: string;
}

/**
 * Schedule type for UI picker
 */
export type ScheduleType = 'daily' | 'weekly' | 'monthly' | 'interval' | 'custom';
