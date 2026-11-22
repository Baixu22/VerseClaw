"use client";

import {
  useState,
  useCallback,
  useEffect,
  useMemo,
  useId,
  createContext,
  use,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import {
  FileDiff as PierreFileDiff,
  PatchDiff as PierrePatchDiff,
} from "@pierre/diffs/react";
import { parseDiffFromFile } from "@pierre/diffs";
import type { FileDiffMetadata, ThemesType } from "@pierre/diffs";
import { Copy, Check, ChevronDown, ChevronUp, FileText } from "lucide-react";
import type { CodeDiffProps } from "./schema";
import { useCopyToClipboard } from "../shared/use-copy-to-clipboard";
import { Button, cn } from "./_adapter";

const COPY_ID = "codediff-code";

/* ── Theme detection (mirrors CodeBlock) ────────────────────────── */

function getSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function getDocumentTheme(): "light" | "dark" | null {
  if (typeof document === "undefined") return null;
  const root = document.documentElement;
  const dataTheme = root.getAttribute("data-theme")?.toLowerCase();
  if (dataTheme === "dark") return "dark";
  if (dataTheme === "light") return "light";
  if (root.classList.contains("dark")) return "dark";
  if (root.classList.contains("light")) return "light";
  return null;
}

function useResolvedTheme(): "light" | "dark" {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    return getDocumentTheme() ?? getSystemTheme();
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    const update = () => setTheme(getDocumentTheme() ?? getSystemTheme());

    const mql = window.matchMedia?.("(prefers-color-scheme: dark)");
    mql?.addEventListener("change", update);

    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    });

    return () => {
      mql?.removeEventListener("change", update);
      observer.disconnect();
    };
  }, []);

  return theme;
}

/* ── Language display names (mirrors CodeBlock) ─────────────────── */

const LANGUAGE_DISPLAY_NAMES: Record<string, string> = {
  typescript: "TypeScript",
  javascript: "JavaScript",
  python: "Python",
  tsx: "TSX",
  jsx: "JSX",
  json: "JSON",
  bash: "Bash",
  shell: "Shell",
  css: "CSS",
  html: "HTML",
  markdown: "Markdown",
  sql: "SQL",
  yaml: "YAML",
  go: "Go",
  rust: "Rust",
  text: "Plain Text",
};

function getLanguageDisplayName(lang: string): string {
  return LANGUAGE_DISPLAY_NAMES[lang.toLowerCase()] || lang.toUpperCase();
}

/* ── Shared context ─────────────────────────────────────────────── */

type CodeDiffSharedState = {
  id: string;
  contentId: string;
  isPatchMode: boolean;
  language: string;
  lineNumbers: "visible" | "hidden";
  filename?: string;
  diffStyle: "unified" | "split";
  copyableCode: string;
  isCopied: boolean;
  copyCode: () => void;
  isCollapsed: boolean;
  isExpanded: boolean;
  shouldCollapse: boolean;
  previewLines: number;
  toggleExpanded: () => void;
  resolvedTheme: "light" | "dark";
  pierreThemes: ThemesType;
  fileDiffMetadata: FileDiffMetadata | null;
  patch: string | null;
  showStats: boolean;
  additions: number;
  deletions: number;
};

const CodeDiffContext = createContext<CodeDiffSharedState | null>(null);

function useCodeDiff(): CodeDiffSharedState {
  const context = use(CodeDiffContext);
  if (!context) {
    throw new Error(
      "CodeDiff subcomponents must be used within <CodeDiff.Root>.",
    );
  }
  return context;
}

/* ── Subcomponents ──────────────────────────────────────────────── */

export type CodeDiffRootProps = CodeDiffProps & {
  children: ReactNode;
  expanded?: boolean;
  defaultExpanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  showStats?: boolean;
};

function CodeDiffRoot({
  id,
  oldCode,
  newCode,
  patch,
  language = "text",
  filename,
  lineNumbers = "visible",
  diffStyle = "unified",
  maxCollapsedLines,
  className,
  children,
  expanded: expandedProp,
  defaultExpanded = false,
  onExpandedChange,
  showStats = true,
}: CodeDiffRootProps) {
  const contentId = useId();
  const resolvedTheme = useResolvedTheme();
  const [expandedState, setExpandedState] = useState(defaultExpanded);
  const { copiedId, copy } = useCopyToClipboard();
  const isCopied = copiedId === COPY_ID;

  const expanded = expandedProp ?? expandedState;
  const setExpanded = useCallback(
    (nextExpanded: boolean) => {
      if (expandedProp === undefined) {
        setExpandedState(nextExpanded);
      }
      onExpandedChange?.(nextExpanded);
    },
    [expandedProp, onExpandedChange],
  );

  const pierreThemes: ThemesType = {
    dark: "pierre-dark",
    light: "pierre-light",
  };

  // Auto-detect mode: if `patch` is provided, use patch mode; otherwise files mode
  const isPatchMode = !!patch;

  const fileDiffMetadata = useMemo(() => {
    if (isPatchMode) return null;
    return parseDiffFromFile(
      {
        name: filename ?? "file",
        contents: oldCode ?? "",
        lang: language as never,
      },
      {
        name: filename ?? "file",
        contents: newCode ?? "",
        lang: language as never,
      },
    );
  }, [isPatchMode, oldCode, newCode, filename, language]);

  const copyableCode = isPatchMode ? (patch ?? "") : (newCode ?? oldCode ?? "");

  const lineCount = useMemo(() => {
    if (isPatchMode) {
      return (patch ?? "").split("\n").length;
    }
    if (fileDiffMetadata) {
      return fileDiffMetadata.unifiedLineCount;
    }
    return 0;
  }, [isPatchMode, patch, fileDiffMetadata]);

  const { additions, deletions } = useMemo(() => {
    if (!isPatchMode && fileDiffMetadata) {
      let add = 0;
      let del = 0;
      for (const hunk of fileDiffMetadata.hunks) {
        add += hunk.additionLines;
        del += hunk.deletionLines;
      }
      return { additions: add, deletions: del };
    }
    if (isPatchMode && patch) {
      let add = 0;
      let del = 0;
      for (const line of patch.split("\n")) {
        if (line.startsWith("+") && !line.startsWith("+++ ")) add++;
        else if (line.startsWith("-") && !line.startsWith("--- ")) del++;
      }
      return { additions: add, deletions: del };
    }
    return { additions: 0, deletions: 0 };
  }, [isPatchMode, fileDiffMetadata, patch]);

  const shouldCollapse = !!maxCollapsedLines && lineCount > maxCollapsedLines;
  const isCollapsed = shouldCollapse && !expanded;

  const copyCode = useCallback(() => {
    void copy(copyableCode, COPY_ID);
  }, [copyableCode, copy]);

  const toggleExpanded = useCallback(() => {
    setExpanded(!expanded);
  }, [expanded, setExpanded]);

  const state: CodeDiffSharedState = {
    id,
    contentId,
    isPatchMode,
    language,
    lineNumbers,
    filename,
    diffStyle,
    copyableCode,
    isCopied,
    copyCode,
    isCollapsed,
    isExpanded: expanded,
    shouldCollapse,
    previewLines: maxCollapsedLines ?? 10,
    toggleExpanded,
    resolvedTheme,
    pierreThemes,
    fileDiffMetadata,
    patch: isPatchMode ? (patch ?? null) : null,
    showStats,
    additions,
    deletions,
  };

  return (
    <CodeDiffContext.Provider value={state}>
      <div
        className={cn(
          "@container flex w-full min-w-0 max-w-full flex-col gap-2",
          className,
        )}
        data-tool-ui-id={id}
        data-slot="code-diff"
      >
        <div className="border-border/70 bg-surface-input w-full max-w-full min-w-0 overflow-hidden rounded-lg border">
          <div className="min-w-0 max-w-full">{children}</div>
        </div>
      </div>
    </CodeDiffContext.Provider>
  );
}

export type CodeDiffSectionProps = {
  className?: string;
};

function CodeDiffHeader({ className }: CodeDiffSectionProps) {
  const { t } = useTranslation("chat");
  const { language, filename, isCopied, copyCode, showStats, additions, deletions } =
    useCodeDiff();
  const hasChanges = additions > 0 || deletions > 0;
  const pathParts = filename?.replace(/\\/g, "/").split("/") ?? [];
  const basename = pathParts.pop();
  const directory = pathParts.join("/");
  return (
    <div
      className={cn(
        "bg-surface-modal flex min-w-0 items-center gap-3 border-b border-border/70 px-3 py-2",
        className,
      )}
    >
      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1" title={filename}>
        <div className="truncate text-xs font-medium leading-5 text-foreground">
          {basename || getLanguageDisplayName(language)}
        </div>
        {directory && <div className="truncate font-mono text-[11px] leading-4 text-muted-foreground">{directory}</div>}
      </div>
      {showStats && hasChanges && (
        <span className="shrink-0 whitespace-nowrap text-xs font-mono tabular-nums">
          {additions > 0 && (
            <span className="text-emerald-700 dark:text-emerald-400">+{additions}</span>
          )}
          {additions > 0 && deletions > 0 && " "}
          {deletions > 0 && (
            <span className="text-rose-700 dark:text-rose-400">-{deletions}</span>
          )}
        </span>
      )}
      <Button
        variant="ghost"
        size="sm"
        onClick={copyCode}
        className="h-7 w-7 shrink-0 p-0"
        aria-label={isCopied ? t("toolUi.codeDiff.copied") : t("toolUi.codeDiff.copy")}
      >
        {isCopied ? (
          <Check className="h-4 w-4 text-green-700 dark:text-green-400" />
        ) : (
          <Copy className="text-muted-foreground h-4 w-4" />
        )}
      </Button>
    </div>
  );
}

function CodeDiffContent({ className }: CodeDiffSectionProps) {
  const { t } = useTranslation("chat");
  const {
    contentId,
    isPatchMode,
    diffStyle,
    lineNumbers,
    isCollapsed,
    isExpanded,
    resolvedTheme,
    pierreThemes,
    fileDiffMetadata,
    patch,
    additions,
    deletions,
    previewLines,
  } = useCodeDiff();

  const disableLineNumbers = lineNumbers === "hidden";
  // Pair old/new rows in a long replacement preview; a unified prefix can
  // otherwise show only deletions. Expansion keeps the caller's full layout.
  const pairedPreview = isCollapsed && additions > 0 && deletions > 0;
  const options = {
    theme: pierreThemes,
    themeType: resolvedTheme,
    diffStyle: pairedPreview ? "split" as const : diffStyle,
    disableFileHeader: true,
    disableLineNumbers,
    diffIndicators: "classic" as const,
    disableBackground: true,
    lineDiffType: isCollapsed ? "none" as const : "word" as const,
    // The preview is the width-sensitive state. Wrap inside the card so a
    // long token cannot visually run past the conversation column; expansion
    // keeps Pierre's normal horizontal code scrolling.
    overflow: isExpanded ? "scroll" as const : "wrap" as const,
  };

  return (
    <>
      {pairedPreview && (
        <div className="grid grid-cols-2 border-b border-border/50 bg-surface-modal text-[11px] leading-6 text-muted-foreground" aria-hidden="true">
          <span className="px-3">{t("toolUi.codeDiff.before")}</span>
          <span className="border-l border-border/50 px-3">{t("toolUi.codeDiff.after")}</span>
        </div>
      )}
      <div className="w-full min-w-0 max-w-full py-2">
        <div
          id={contentId}
          role="region"
          aria-label={t("toolUi.codeDiff.content")}
          tabIndex={0}
          data-testid="code-diff-content"
          className={cn(
            "w-full min-w-0 max-w-full overflow-auto overscroll-contain text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
            className,
          )}
          style={{ maxHeight: isCollapsed ? previewLines * 20 : undefined }}
        >
          {!isPatchMode && fileDiffMetadata && (
            <PierreFileDiff
              className="chat-diff-view"
              fileDiff={fileDiffMetadata}
              options={options}
            />
          )}
          {isPatchMode && patch && (
            <PierrePatchDiff
              className="chat-diff-view"
              patch={patch}
              options={options}
            />
          )}
        </div>
      </div>
    </>
  );
}

function CodeDiffCollapseToggle({ className }: CodeDiffSectionProps) {
  const { t } = useTranslation("chat");
  const { shouldCollapse, isCollapsed, toggleExpanded, contentId } = useCodeDiff();

  if (!shouldCollapse) return null;

  return (
    <Button
      variant="ghost"
      onClick={toggleExpanded}
      className={cn(
        "text-muted-foreground h-8 w-full rounded-none border-t border-border/70 text-xs font-normal",
        className,
      )}
      aria-expanded={!isCollapsed}
      aria-controls={contentId}
    >
      {isCollapsed ? (
        <>
          <ChevronDown className="mr-1 size-4" />
          {t("toolUi.codeDiff.showFull")}
        </>
      ) : (
        <>
          <ChevronUp className="mr-2 h-4 w-4" />
          {t("toolUi.codeDiff.collapse")}
        </>
      )}
    </Button>
  );
}

/* ── Composed preset (callable as a flat component) ─────────────── */

export type CodeDiffComposedProps = Omit<CodeDiffRootProps, "children">;

function CodeDiffComposed(props: CodeDiffComposedProps) {
  return (
    <CodeDiffRoot {...props}>
      <CodeDiffHeader />
      <CodeDiffContent />
      <CodeDiffCollapseToggle />
    </CodeDiffRoot>
  );
}

/* ── Compound export: CodeDiff is callable AND has subcomponents ── */

type CodeDiffComponent = typeof CodeDiffComposed & {
  Root: typeof CodeDiffRoot;
  Header: typeof CodeDiffHeader;
  Content: typeof CodeDiffContent;
  CollapseToggle: typeof CodeDiffCollapseToggle;
};

export const CodeDiff = Object.assign(CodeDiffComposed, {
  Root: CodeDiffRoot,
  Header: CodeDiffHeader,
  Content: CodeDiffContent,
  CollapseToggle: CodeDiffCollapseToggle,
}) as CodeDiffComponent;
