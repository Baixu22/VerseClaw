/**
 * Namespace list shared by the renderer loader, main-process resources and
 * lint/test helpers.
 *
 * Keep this module dependency-free: importing it from the renderer must not
 * pull every locale JSON into the startup bundle.
 */
export const I18N_NAMESPACES = [
  'common',
  'settings',
  'dashboard',
  'chat',
  'channels',
  'agents',
  'observability',
  'skills',
  'cron',
  'dreams',
  'setup',
  'menu',
  'taskLedger',
  'remoteTasks',
  'clawGraph',
  'knowledge',
  'codeReview',
  'browser',
  'inbox',
] as const;

export type I18nNamespace = (typeof I18N_NAMESPACES)[number];
