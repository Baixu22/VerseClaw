import type { LanguageCode } from '../language';

// EN
import enCommon from './locales/en/common.json';
import enSettings from './locales/en/settings.json';
import enDashboard from './locales/en/dashboard.json';
import enChat from './locales/en/chat.json';
import enChannels from './locales/en/channels.json';
import enAgents from './locales/en/agents.json';
import enObservability from './locales/en/observability.json';
import enSkills from './locales/en/skills.json';
import enCron from './locales/en/cron.json';
import enDreams from './locales/en/dreams.json';
import enSetup from './locales/en/setup.json';
import enMenu from './locales/en/menu.json';
import enTaskLedger from './locales/en/taskLedger.json';
import enRemoteTasks from './locales/en/remoteTasks.json';
import enClawGraph from './locales/en/clawGraph.json';
import enKnowledge from './locales/en/knowledge.json';
import enCodeReview from './locales/en/codeReview.json';
import enBrowser from './locales/en/browser.json';

// ZH
import zhCommon from './locales/zh/common.json';
import zhSettings from './locales/zh/settings.json';
import zhDashboard from './locales/zh/dashboard.json';
import zhChat from './locales/zh/chat.json';
import zhChannels from './locales/zh/channels.json';
import zhAgents from './locales/zh/agents.json';
import zhObservability from './locales/zh/observability.json';
import zhSkills from './locales/zh/skills.json';
import zhCron from './locales/zh/cron.json';
import zhDreams from './locales/zh/dreams.json';
import zhSetup from './locales/zh/setup.json';
import zhMenu from './locales/zh/menu.json';
import zhTaskLedger from './locales/zh/taskLedger.json';
import zhRemoteTasks from './locales/zh/remoteTasks.json';
import zhClawGraph from './locales/zh/clawGraph.json';
import zhKnowledge from './locales/zh/knowledge.json';
import zhCodeReview from './locales/zh/codeReview.json';
import zhBrowser from './locales/zh/browser.json';

// JA
import jaCommon from './locales/ja/common.json';
import jaSettings from './locales/ja/settings.json';
import jaDashboard from './locales/ja/dashboard.json';
import jaChat from './locales/ja/chat.json';
import jaChannels from './locales/ja/channels.json';
import jaAgents from './locales/ja/agents.json';
import jaObservability from './locales/ja/observability.json';
import jaSkills from './locales/ja/skills.json';
import jaCron from './locales/ja/cron.json';
import jaDreams from './locales/ja/dreams.json';
import jaSetup from './locales/ja/setup.json';
import jaMenu from './locales/ja/menu.json';
import jaTaskLedger from './locales/ja/taskLedger.json';
import jaRemoteTasks from './locales/ja/remoteTasks.json';
import jaClawGraph from './locales/ja/clawGraph.json';
import jaKnowledge from './locales/ja/knowledge.json';
import jaCodeReview from './locales/ja/codeReview.json';
import jaBrowser from './locales/ja/browser.json';

// RU
import ruCommon from './locales/ru/common.json';
import ruSettings from './locales/ru/settings.json';
import ruDashboard from './locales/ru/dashboard.json';
import ruChat from './locales/ru/chat.json';
import ruChannels from './locales/ru/channels.json';
import ruAgents from './locales/ru/agents.json';
import ruObservability from './locales/ru/observability.json';
import ruSkills from './locales/ru/skills.json';
import ruCron from './locales/ru/cron.json';
import ruDreams from './locales/ru/dreams.json';
import ruSetup from './locales/ru/setup.json';
import ruMenu from './locales/ru/menu.json';
import ruTaskLedger from './locales/ru/taskLedger.json';
import ruRemoteTasks from './locales/ru/remoteTasks.json';
import ruClawGraph from './locales/ru/clawGraph.json';
import ruKnowledge from './locales/ru/knowledge.json';
import ruCodeReview from './locales/ru/codeReview.json';
import ruBrowser from './locales/ru/browser.json';

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
] as const;

export const I18N_RESOURCES = {
  en: {
    common: enCommon,
    settings: enSettings,
    dashboard: enDashboard,
    chat: enChat,
    channels: enChannels,
    agents: enAgents,
    observability: enObservability,
    skills: enSkills,
    cron: enCron,
    dreams: enDreams,
    setup: enSetup,
    menu: enMenu,
    taskLedger: enTaskLedger,
    remoteTasks: enRemoteTasks,
    clawGraph: enClawGraph,
    knowledge: enKnowledge,
    codeReview: enCodeReview,
    browser: enBrowser,
  },
  zh: {
    common: zhCommon,
    settings: zhSettings,
    dashboard: zhDashboard,
    chat: zhChat,
    channels: zhChannels,
    agents: zhAgents,
    observability: zhObservability,
    skills: zhSkills,
    cron: zhCron,
    dreams: zhDreams,
    setup: zhSetup,
    menu: zhMenu,
    taskLedger: zhTaskLedger,
    remoteTasks: zhRemoteTasks,
    clawGraph: zhClawGraph,
    knowledge: zhKnowledge,
    codeReview: zhCodeReview,
    browser: zhBrowser,
  },
  ja: {
    common: jaCommon,
    settings: jaSettings,
    dashboard: jaDashboard,
    chat: jaChat,
    channels: jaChannels,
    agents: jaAgents,
    observability: jaObservability,
    skills: jaSkills,
    cron: jaCron,
    dreams: jaDreams,
    setup: jaSetup,
    menu: jaMenu,
    taskLedger: jaTaskLedger,
    remoteTasks: jaRemoteTasks,
    clawGraph: jaClawGraph,
    knowledge: jaKnowledge,
    codeReview: jaCodeReview,
    browser: jaBrowser,
  },
  ru: {
    common: ruCommon,
    settings: ruSettings,
    dashboard: ruDashboard,
    chat: ruChat,
    channels: ruChannels,
    agents: ruAgents,
    observability: ruObservability,
    skills: ruSkills,
    cron: ruCron,
    dreams: ruDreams,
    setup: ruSetup,
    menu: ruMenu,
    taskLedger: ruTaskLedger,
    remoteTasks: ruRemoteTasks,
    clawGraph: ruClawGraph,
    knowledge: ruKnowledge,
    codeReview: ruCodeReview,
    browser: ruBrowser,
  },
} as const;

export type MenuLabels = typeof enMenu;

export const MENU_LABELS: Record<LanguageCode, MenuLabels> = {
  en: enMenu,
  zh: zhMenu,
  ja: jaMenu,
  ru: ruMenu,
};
