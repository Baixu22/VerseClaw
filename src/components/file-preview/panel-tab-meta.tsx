/**
 * Tab metadata for the workspace panel's tab strip and launcher.
 *
 * One flat list of every entry the panel can open. `launcherOrder` is the
 * product order shown on the launcher cards; `menuOrder` is the order in the
 * `+` new-tab menu. Both draw labels from the same i18n keys so a chip and
 * its launcher card never drift apart.
 */
import { History, Layers, Users } from 'lucide-react';
import {
  OfficialBrowserIcon,
  OfficialFilesIcon,
  OfficialReviewIcon,
  OfficialTerminalIcon,
} from '@/components/icons/official-workspace-icons';
import type { PanelTabKind } from '@/stores/artifact-panel';

export interface PanelTabMeta {
  /** i18n key under the `chat` namespace. */
  labelKey: string;
  labelFallback: string;
  /** Launcher card description. */
  descriptionKey: string;
  descriptionFallback: string;
  /** Displayed as a kbd hint on the launcher card and in the new-tab menu. */
  shortcut?: string;
  icon: React.ComponentType<{ className?: string }>;
}

export const PANEL_TAB_META: Record<PanelTabKind, PanelTabMeta> = {
  review: {
    labelKey: 'artifactPanel.tabs.review',
    labelFallback: 'Review',
    descriptionKey: 'artifactPanel.launcher.entries.review',
    descriptionFallback: 'Review changes, branches, stashes, and PRs.',
    shortcut: 'R',
    icon: OfficialReviewIcon,
  },
  terminal: {
    labelKey: 'artifactPanel.tabs.terminal',
    labelFallback: 'Terminal',
    descriptionKey: 'artifactPanel.launcher.entries.terminal',
    descriptionFallback: 'Start an interactive shell for this workspace.',
    shortcut: 'T',
    icon: OfficialTerminalIcon,
  },
  browser: {
    labelKey: 'artifactPanel.tabs.browser',
    labelFallback: 'Browser',
    descriptionKey: 'artifactPanel.launcher.entries.browser',
    descriptionFallback: 'Open a local preview or inspect a URL.',
    shortcut: 'B',
    icon: OfficialBrowserIcon,
  },
  files: {
    labelKey: 'artifactPanel.tabs.files',
    labelFallback: 'Files',
    descriptionKey: 'artifactPanel.launcher.entries.files',
    descriptionFallback: 'Browse files and preview selected content.',
    shortcut: 'F',
    icon: OfficialFilesIcon,
  },
  artifact: {
    labelKey: 'artifactPanel.tabs.artifact',
    labelFallback: 'Artifacts',
    descriptionKey: 'artifactPanel.launcher.entries.artifact',
    descriptionFallback: 'Inspect and validate generated artifacts.',
    icon: Layers,
  },
  audit: {
    labelKey: 'artifactPanel.tabs.audit',
    labelFallback: 'Audit',
    descriptionKey: 'artifactPanel.launcher.entries.audit',
    descriptionFallback: 'Inspect permission requests and recent approvals.',
    shortcut: 'A',
    icon: History,
  },
  agents: {
    labelKey: 'artifactPanel.tabs.agents',
    labelFallback: 'Sub-agents',
    descriptionKey: 'artifactPanel.launcher.entries.agents',
    descriptionFallback: 'Read a sub-agent transcript and dispatch new work.',
    icon: Users,
  },
};

/** Launcher cards: high-frequency workspace entries first, file views after. */
export const LAUNCHER_TAB_KINDS: readonly PanelTabKind[] = [
  'review',
  'terminal',
  'browser',
  'files',
  'artifact',
  'audit',
  'agents',
];

/** `+` menu order mirrors the launcher so the two never feel unrelated. */
export const NEW_TAB_MENU_KINDS: readonly PanelTabKind[] = LAUNCHER_TAB_KINDS;
