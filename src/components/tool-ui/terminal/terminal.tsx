"use client";

import { useState, useCallback, useId, useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import Ansi from "ansi-to-react";
import {
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  Terminal as TerminalIcon,
} from "lucide-react";
import type { TerminalProps } from "./schema";
import { useCopyToClipboard } from "../shared/use-copy-to-clipboard";

import { Button } from "./_adapter";
import { cn } from "./_adapter";

const COPY_ID = "terminal-output";

type TerminalControlledProps = {
  expanded?: boolean;
  defaultExpanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
};

type TerminalRootProps = TerminalProps & TerminalControlledProps;

type TerminalHeaderProps = Pick<
  TerminalProps,
  "command" | "cwd" | "exitCode"
> & {
  formattedDuration: string | null;
  hasOutput: boolean;
  copiedId: string | null;
  onCopy: () => void;
};

type TerminalOutputProps = Pick<
  TerminalProps,
  "stdout" | "stderr" | "truncated"
> & {
  isCollapsed: boolean;
  shouldCollapse: boolean;
  lineCount: number;
  previewLines: number;
  onToggleCollapse: () => void;
};

function formatDuration(durationMs?: number): string | null {
  if (durationMs == null) return null;
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function countOutputLines(output: string): number {
  const trimmedTrailingNewlines = output.replace(/(?:\r?\n)+$/, "");
  if (!trimmedTrailingNewlines) return 0;
  return trimmedTrailingNewlines.split("\n").length;
}

function TerminalHeader({
  command,
  cwd,
  exitCode,
  formattedDuration,
  hasOutput,
  copiedId,
  onCopy,
}: TerminalHeaderProps) {
  const { t } = useTranslation("chat");
  return (
    <div className="bg-surface-modal flex min-w-0 items-center gap-3 border-b border-border/70 px-3 py-2">
      <TerminalIcon className="text-muted-foreground h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <code className="text-foreground block truncate font-mono text-xs leading-5" title={command}>{command}</code>
        {cwd && <div className="truncate font-mono text-[11px] leading-4 text-muted-foreground" title={cwd}>{cwd}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
        {formattedDuration && (
          <span className="text-muted-foreground font-mono text-[11px] tabular-nums">
            {formattedDuration}
          </span>
        )}
        {exitCode != null && (
          <span
            className={cn(
              "text-xs tabular-nums",
              exitCode === 0
                ? "text-muted-foreground"
                : "text-red-700 dark:text-red-400",
            )}
          >
            {t("toolUi.terminal.exitCode", { code: exitCode })}
          </span>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={onCopy}
          disabled={!hasOutput}
          className="h-7 w-7 shrink-0 p-0"
          aria-label={
            !hasOutput
              ? t("toolUi.terminal.noOutputToCopy")
              : copiedId === COPY_ID
                ? t("toolUi.terminal.copied")
                : t("toolUi.terminal.copy")
          }
        >
          {hasOutput && copiedId === COPY_ID ? (
            <Check className="h-4 w-4 text-green-700 dark:text-green-400" />
          ) : (
            <Copy className="text-muted-foreground h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  );
}

function TerminalOutput({
  stdout,
  stderr,
  truncated,
  isCollapsed,
  shouldCollapse,
  lineCount,
  previewLines,
  onToggleCollapse,
}: TerminalOutputProps) {
  const { t } = useTranslation("chat");
  const contentId = useId();
  const outputRef = useRef<HTMLDivElement>(null);
  const followingOutput = useRef(true);
  const wasCollapsed = useRef(isCollapsed);
  useLayoutEffect(() => {
    const node = outputRef.current;
    if (node && isCollapsed && (followingOutput.current || !wasCollapsed.current)) {
      node.scrollTop = node.scrollHeight;
    }
    wasCollapsed.current = isCollapsed;
  }, [isCollapsed, stdout, stderr]);

  return (
    <div>
      <div className="px-3 py-2">
        <div
          ref={outputRef}
          id={contentId}
          role="region"
          aria-label={t("toolUi.terminal.output")}
          tabIndex={0}
          data-testid="terminal-output"
          className="overflow-auto overscroll-contain font-mono text-xs leading-5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
          style={{ maxHeight: isCollapsed ? previewLines * 20 : undefined }}
          onScroll={(event) => {
            const node = event.currentTarget;
            followingOutput.current = node.scrollHeight - node.scrollTop - node.clientHeight < 4;
          }}
        >
          <div className="min-w-max">
            {stdout && (
              <div className="text-foreground whitespace-pre">
                <Ansi>{stdout}</Ansi>
              </div>
            )}
            {stderr && (
              <div className="mt-2 whitespace-pre text-red-700 dark:text-red-400">
                <Ansi>{stderr}</Ansi>
              </div>
            )}
          </div>
        </div>
      </div>

      {truncated && (
        <p className="px-3 pb-2 text-xs text-muted-foreground">
          {t("toolUi.terminal.truncated")}
        </p>
      )}

      {shouldCollapse && (
        <Button
          variant="ghost"
          onClick={onToggleCollapse}
          className="text-muted-foreground h-8 w-full rounded-none border-t border-border/70 text-xs font-normal"
          aria-expanded={!isCollapsed}
          aria-controls={contentId}
        >
          {isCollapsed ? (
            <>
              <ChevronDown className="mr-1 size-4" />
              {t("toolUi.terminal.showAll", { count: lineCount })}
            </>
          ) : (
            <>
              <ChevronUp className="mr-1 size-4" />
              {t("toolUi.terminal.collapse")}
            </>
          )}
        </Button>
      )}
    </div>
  );
}

function TerminalEmpty() {
  const { t } = useTranslation("chat");
  return (
    <div className="text-muted-foreground px-3 py-3 font-mono text-xs">
      {t("toolUi.terminal.empty")}
    </div>
  );
}

function TerminalRoot({
  id,
  command,
  stdout,
  stderr,
  exitCode,
  durationMs,
  cwd,
  truncated,
  maxCollapsedLines,
  className,
  expanded,
  defaultExpanded = false,
  onExpandedChange,
}: TerminalRootProps) {
  const [uncontrolledExpanded, setUncontrolledExpanded] =
    useState(defaultExpanded);
  const { copiedId, copy } = useCopyToClipboard();

  const isExpanded = expanded ?? uncontrolledExpanded;
  const hasOutput = Boolean(stdout || stderr);
  const fullOutput = [stdout, stderr].filter(Boolean).join("\n");
  const formattedDuration = formatDuration(durationMs);
  const lineCount = countOutputLines(fullOutput);
  const shouldCollapse =
    maxCollapsedLines !== undefined && lineCount > maxCollapsedLines;
  const isCollapsed = shouldCollapse && !isExpanded;

  const setExpanded = useCallback(
    (nextExpanded: boolean) => {
      if (expanded === undefined) {
        setUncontrolledExpanded(nextExpanded);
      }
      onExpandedChange?.(nextExpanded);
    },
    [expanded, onExpandedChange],
  );

  const handleCopy = useCallback(() => {
    if (!hasOutput) return;
    copy(fullOutput, COPY_ID);
  }, [hasOutput, fullOutput, copy]);

  return (
    <div
      className={cn(
        "@container flex w-full min-w-0 flex-col gap-2",
        className,
      )}
      data-tool-ui-id={id}
      data-slot="terminal"
    >
      <div className="border-border/70 bg-surface-input min-w-0 overflow-hidden rounded-lg border">
        <TerminalHeader
          command={command}
          cwd={cwd}
          exitCode={exitCode}
          formattedDuration={formattedDuration}
          hasOutput={hasOutput}
          copiedId={copiedId}
          onCopy={handleCopy}
        />

        {hasOutput && (
          <TerminalOutput
            stdout={stdout}
            stderr={stderr}
            truncated={truncated}
            isCollapsed={isCollapsed}
            shouldCollapse={shouldCollapse}
            lineCount={lineCount}
            previewLines={maxCollapsedLines ?? 10}
            onToggleCollapse={() => setExpanded(!isExpanded)}
          />
        )}

        {!hasOutput && <TerminalEmpty />}
      </div>
    </div>
  );
}

type TerminalComponent = typeof TerminalRoot & {
  Header: typeof TerminalHeader;
  Output: typeof TerminalOutput;
  Empty: typeof TerminalEmpty;
};

export const Terminal = Object.assign(TerminalRoot, {
  Header: TerminalHeader,
  Output: TerminalOutput,
  Empty: TerminalEmpty,
}) as TerminalComponent;
