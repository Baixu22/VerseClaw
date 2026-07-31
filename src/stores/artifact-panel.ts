/**
 * Artifact panel state.
 *
 * Drives the right-side workspace panel on the Chat page.  The panel is a
 * tab strip: opening an entry from the launcher (or from a chat file card)
 * pushes a tab instance, and every detail view lives in its own tab
 * alongside the others.  Closing the last tab collapses the whole panel.
 *
 * Tabs are single-instance per kind — re-triggering an entry activates the
 * existing tab instead of spawning a second one.  ClawX runs one xterm
 * session and one dev-server preview per workspace, so a second terminal or
 * browser tab would be a second view onto the same session, not a new one.
 *
 * The actual content (file lists, workspace tree, etc.) is provided by
 * the chat page as props — we only track UI state here so the panel can
 * be opened/closed/focused from anywhere (file cards, toolbar buttons,
 * "查看文件变更 →" links, …).
 *
 * `widthPct` is persisted via `zustand/middleware`'s `persist` so the
 * user's preferred split survives reloads.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { FilePreviewTarget } from '@/components/file-preview/types';

/**
 * Every kind of tab the panel can host.  The first four came from the old
 * nested "workspace" sub-router; the last four were the old fixed top-level
 * tabs.  They are peers now.
 */
export type PanelTabKind =
  | 'review'
  | 'terminal'
  | 'browser'
  | 'files'
  | 'changes'
  | 'preview'
  | 'artifact'
  | 'audit';

export interface PanelTabInstance {
  id: string;
  kind: PanelTabKind;
  /** Overrides the default label in the chip (e.g. a browser tab's hostname). */
  title?: string;
}

const PANEL_TAB_KINDS: readonly PanelTabKind[] = [
  'review',
  'terminal',
  'browser',
  'files',
  'changes',
  'preview',
  'artifact',
  'audit',
];

export function isPanelTabKind(value: unknown): value is PanelTabKind {
  return typeof value === 'string' && (PANEL_TAB_KINDS as readonly string[]).includes(value);
}

/** Width clamp (% of the chat container). */
export const ARTIFACT_PANEL_MIN_WIDTH = 28;
export const ARTIFACT_PANEL_MAX_WIDTH = 50;
export const ARTIFACT_PANEL_DEFAULT_WIDTH = 45;

let tabSeq = 0;
function nextTabId(kind: PanelTabKind): string {
  tabSeq += 1;
  return `${kind}-${tabSeq}`;
}

export interface RestorableArtifactPanelState {
  open?: boolean;
  expanded?: boolean;
  tabs?: Array<{ kind?: string; title?: string }>;
  activeTabKind?: string;
  /** @deprecated Pre-tab-strip sessions. Migrated into a single tab. */
  activeTab?: string;
  /** @deprecated Pre-tab-strip sessions. Migrated into a single tab. */
  workspaceView?: string;
  selectedPath?: string | null;
}

interface ArtifactPanelState {
  open: boolean;
  /** Expanded panels take space beside the chat; collapsed panels overlay it. */
  expanded: boolean;
  /** Open tabs, oldest first. Empty means the launcher is showing. */
  tabs: PanelTabInstance[];
  activeTabId: string | null;
  /**
   * The currently selected file inside the panel.  Shared between the
   * 变更 tab (drives the right-pane diff) and the 预览 tab (drives the
   * rendered preview).  `null` means "no selection" — the changes tab
   * may auto-select the first file in that case.
   */
  focusedFile: FilePreviewTarget | null;
  /** Persisted panel width as a % of the chat container (clamped on read). */
  widthPct: number;
  /**
   * Open (or re-activate) a tab of this kind and make it active.  Opens the
   * panel as a side effect so callers don't have to sequence two actions.
   */
  openTab: (kind: PanelTabKind, title?: string) => void;
  /** Close one tab. Closing the last one collapses the panel. */
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  /** Rename a tab chip (browser tabs track the loaded hostname). */
  setTabTitle: (kind: PanelTabKind, title: string) => void;
  setFocusedFile: (file: FilePreviewTarget | null) => void;
  setExpanded: (expanded: boolean) => void;
  /** Open the changes tab. Optionally focus a single file. */
  openChanges: (file?: FilePreviewTarget | null) => void;
  /** Open the preview tab on a specific file. */
  openPreview: (file?: FilePreviewTarget | null) => void;
  /** Open the panel on its launcher, without committing to a tab. */
  openBrowser: () => void;
  toggle: () => void;
  close: () => void;
  /** Update the panel width (clamped). */
  setWidthPct: (pct: number) => void;
  restoreSessionState: (state: RestorableArtifactPanelState) => void;
}

function clampWidth(pct: number): number {
  if (!Number.isFinite(pct)) return ARTIFACT_PANEL_DEFAULT_WIDTH;
  if (pct < ARTIFACT_PANEL_MIN_WIDTH) return ARTIFACT_PANEL_MIN_WIDTH;
  if (pct > ARTIFACT_PANEL_MAX_WIDTH) return ARTIFACT_PANEL_MAX_WIDTH;
  return pct;
}

/**
 * Sessions saved before the tab strip existed stored a single `activeTab`
 * plus, for the old nested workspace tab, a `workspaceView` sub-route.
 * Flatten that pair into the equivalent tab kind.  `workspaceView: 'home'`
 * was the launcher, so it maps to "no tab".
 */
function migrateLegacyTab(state: RestorableArtifactPanelState): PanelTabKind | null {
  if (state.activeTab === 'browser') {
    switch (state.workspaceView) {
      case 'files': return 'files';
      case 'terminal': return 'terminal';
      case 'web': return 'browser';
      case 'audit': return 'audit';
      case 'git': return 'review';
      default: return null; // 'home' or unset — the old launchpad
    }
  }
  if (isPanelTabKind(state.activeTab)) return state.activeTab;
  return null;
}

function restoreTabs(state: RestorableArtifactPanelState): PanelTabInstance[] {
  if (Array.isArray(state.tabs) && state.tabs.length > 0) {
    const seen = new Set<PanelTabKind>();
    const restored: PanelTabInstance[] = [];
    for (const entry of state.tabs) {
      if (!isPanelTabKind(entry?.kind) || seen.has(entry.kind)) continue;
      seen.add(entry.kind);
      restored.push({ id: nextTabId(entry.kind), kind: entry.kind, title: entry.title });
    }
    if (restored.length > 0) return restored;
  }
  const legacy = migrateLegacyTab(state);
  return legacy ? [{ id: nextTabId(legacy), kind: legacy }] : [];
}

export const useArtifactPanel = create<ArtifactPanelState>()(
  persist(
    (set, get) => ({
      open: false,
      expanded: false,
      tabs: [],
      activeTabId: null,
      focusedFile: null,
      widthPct: ARTIFACT_PANEL_DEFAULT_WIDTH,
      openTab: (kind, title) => set((s) => {
        const existing = s.tabs.find((tab) => tab.kind === kind);
        if (existing) {
          return {
            open: true,
            activeTabId: existing.id,
            tabs: title && title !== existing.title
              ? s.tabs.map((tab) => (tab.id === existing.id ? { ...tab, title } : tab))
              : s.tabs,
          };
        }
        const tab: PanelTabInstance = { id: nextTabId(kind), kind, title };
        return { open: true, tabs: [...s.tabs, tab], activeTabId: tab.id };
      }),
      closeTab: (tabId) => set((s) => {
        const tabs = s.tabs.filter((tab) => tab.id !== tabId);
        // Closing the last tab collapses the panel entirely — a chrome-less
        // rail with nothing in it is not a state worth showing.
        if (tabs.length === 0) {
          return { tabs, activeTabId: null, open: false, expanded: false, focusedFile: null };
        }
        if (s.activeTabId !== tabId) return { tabs };
        // Hand the selection to the most recently opened surviving tab.
        return { tabs, activeTabId: tabs[tabs.length - 1].id };
      }),
      setActiveTab: (tabId) => set((s) => (
        s.tabs.some((tab) => tab.id === tabId) ? { activeTabId: tabId } : {}
      )),
      setTabTitle: (kind, title) => set((s) => ({
        tabs: s.tabs.map((tab) => (tab.kind === kind && tab.title !== title ? { ...tab, title } : tab)),
      })),
      setFocusedFile: (focusedFile) => set({ focusedFile }),
      setExpanded: (expanded) => set({ expanded }),
      openChanges: (file = null) => {
        set({ focusedFile: file ?? null });
        get().openTab('changes');
      },
      openPreview: (file = null) => {
        set({ focusedFile: file ?? null });
        get().openTab('preview');
      },
      // Historically "open the workspace launchpad". With the flat tab strip
      // that is exactly the launcher: open the panel, commit to no tab.
      openBrowser: () => set({ open: true }),
      toggle: () => set((s) => ({ open: !s.open })),
      close: () => set({ open: false, expanded: false, tabs: [], activeTabId: null, focusedFile: null }),
      setWidthPct: (pct) => set({ widthPct: clampWidth(pct) }),
      restoreSessionState: (state) => set(() => {
        const tabs = restoreTabs(state);
        const requestedKind = isPanelTabKind(state.activeTabKind)
          ? state.activeTabKind
          : migrateLegacyTab(state);
        const active = tabs.find((tab) => tab.kind === requestedKind) ?? tabs[tabs.length - 1] ?? null;
        return {
          open: state.open ?? false,
          // Panels created before expanded state existed must not reclaim
          // conversation width until the user explicitly expands them.
          expanded: state.expanded ?? false,
          tabs,
          activeTabId: active?.id ?? null,
          focusedFile: null,
        };
      }),
    }),
    {
      name: 'verse-claw.artifact-panel',
      // Only persist the user-controlled width — open/tabs/focus reset on reload.
      partialize: (state) => ({ widthPct: state.widthPct }),
    },
  ),
);
