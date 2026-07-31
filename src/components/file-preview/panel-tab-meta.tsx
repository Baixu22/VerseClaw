/**
 * Tab metadata for the workspace panel's tab strip and launcher.
 *
 * One flat list of every entry the panel can open. `launcherOrder` is the
 * product order shown on the launcher cards; `menuOrder` is the order in the
 * `+` new-tab menu. Both draw labels from the same i18n keys so a chip and
 * its launcher card never drift apart.
 */
import {
  Eye,
  FileEdit,
  FolderTree,
  GitBranch,
  Globe,
  History,
  Layers,
  TerminalSquare,
} from 'lucide-react';
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
    icon: GitBranch,
  },
  terminal: {
    labelKey: 'artifactPanel.tabs.terminal',
    labelFallback: 'Terminal',
    descriptionKey: 'artifactPanel.launcher.entries.terminal',
    descriptionFallback: 'Start an interactive shell for this workspace.',
    shortcut: 'T',
    icon: TerminalSquare,
  },
  browser: {
    labelKey: 'artifactPanel.tabs.browser',
    labelFallback: 'Browser',
    descriptionKey: 'artifactPanel.launcher.entries.browser',
    descriptionFallback: 'Open a local preview or inspect a URL.',
    shortcut: 'B',
    icon: Globe,
  },
  files: {
    labelKey: 'artifactPanel.tabs.files',
    labelFallback: 'Files',
    descriptionKey: 'artifactPanel.launcher.entries.files',
    descriptionFallback: 'Browse files and preview selected content.',
    shortcut: 'F',
    icon: FolderTree,
  },
  changes: {
    labelKey: 'artifactPanel.tabs.changes',
    labelFallback: 'Changes',
    descriptionKey: 'artifactPanel.launcher.entries.changes',
    descriptionFallback: 'Diff the file focused from the conversation.',
    icon: FileEdit,
  },
  preview: {
    labelKey: 'artifactPanel.tabs.preview',
    labelFallback: 'Preview',
    descriptionKey: 'artifactPanel.launcher.entries.preview',
    descriptionFallback: 'Render the focused file.',
    icon: Eye,
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
};

/** Launcher cards: high-frequency workspace entries first, file views after. */
export const LAUNCHER_TAB_KINDS: readonly PanelTabKind[] = [
  'review',
  'terminal',
  'browser',
  'files',
  'changes',
  'preview',
  'artifact',
  'audit',
];

/** `+` menu order mirrors the launcher so the two never feel unrelated. */
export const NEW_TAB_MENU_KINDS: readonly PanelTabKind[] = LAUNCHER_TAB_KINDS;
