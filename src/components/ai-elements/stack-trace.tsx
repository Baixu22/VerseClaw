import { AlertTriangle, FileText, TerminalSquare } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { AiElementCard } from './card';

export type StackFrame = {
  raw: string;
  functionName?: string;
  filePath?: string;
  line?: number;
  column?: number;
};

export type StackTraceProps = {
  title?: string;
  errorType?: string;
  message?: string;
  stack: string;
  source?: 'app' | 'web-preview' | 'tool';
  onOpenFile?: (path: string) => void;
};

const FRAME_RE = /^\s*at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?\s*$/;
const BARE_FRAME_RE = /^\s*(.+?):(\d+):(\d+)\s*$/;

function parseFrame(line: string): StackFrame {
  const frameMatch = line.match(FRAME_RE);
  if (frameMatch) {
    return {
      raw: line,
      functionName: frameMatch[1]?.trim(),
      filePath: frameMatch[2],
      line: Number(frameMatch[3]),
      column: Number(frameMatch[4]),
    };
  }
  const bareMatch = line.match(BARE_FRAME_RE);
  if (bareMatch) {
    return {
      raw: line,
      filePath: bareMatch[1],
      line: Number(bareMatch[2]),
      column: Number(bareMatch[3]),
    };
  }
  return { raw: line };
}

export function parseStackFrames(stack: string): StackFrame[] {
  return stack
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map(parseFrame);
}

function fileName(path: string): string {
  return path.replace(/\\/g, '/').split('/').pop() || path;
}

export function StackTrace({ title, errorType, message, stack, source, onOpenFile }: StackTraceProps) {
  const { t } = useTranslation('chat');
  const frames = useMemo(() => parseStackFrames(stack), [stack]);
  const heading = title ?? errorType ?? t('toolUi.stackTrace.label', 'Stack trace');

  return (
    <AiElementCard
      icon={<TerminalSquare className="h-3.5 w-3.5" />}
      label={t('toolUi.stackTrace.label', 'Stack trace')}
      title={heading}
      subtitle={source ? t(`toolUi.stackTrace.source.${source}`, source) : undefined}
      data-testid="chat-tool-ui-stack-trace"
      className="border-red-500/20 bg-red-500/5"
    >
      <div className="space-y-3">
        {(errorType || message) ? (
          <div className="rounded-md border border-red-500/20 bg-background/70 p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-700 dark:text-red-400" />
              <div className="min-w-0">
                {errorType ? <p className="truncate text-sm font-semibold text-foreground">{errorType}</p> : null}
                {message ? <p className="mt-0.5 whitespace-pre-wrap text-xs text-muted-foreground">{message}</p> : null}
              </div>
            </div>
          </div>
        ) : null}

        <div className="overflow-hidden rounded-md border border-border bg-[#0d1117] text-slate-100" data-testid="ai-stack-trace-frames">
          {frames.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-slate-400">{t('toolUi.stackTrace.empty', 'No stack frames were reported.')}</p>
          ) : frames.map((frame, index) => (
            <div key={`${frame.raw}-${index}`} className="border-t border-white/10 px-3 py-2 first:border-t-0">
              <div className="flex min-w-0 items-center gap-2">
                <span className="w-5 shrink-0 text-right font-mono text-2xs text-slate-500">{index + 1}</span>
                <FileText className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                {frame.filePath ? (
                  <button
                    type="button"
                    className={cn(
                      'min-w-0 flex-1 truncate text-left font-mono text-xs text-slate-100',
                      onOpenFile && 'underline decoration-slate-600 underline-offset-2 hover:text-white hover:decoration-slate-200',
                    )}
                    onClick={() => onOpenFile?.(frame.filePath!)}
                    title={frame.filePath}
                    data-testid="ai-stack-trace-file"
                  >
                    {fileName(frame.filePath)}
                  </button>
                ) : (
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-slate-300">{frame.raw}</span>
                )}
                {frame.line != null ? (
                  <span className="shrink-0 font-mono text-2xs text-slate-400">
                    {t('toolUi.stackTrace.lineColumn', 'L{{line}}:C{{column}}', { line: frame.line, column: frame.column ?? 0 })}
                  </span>
                ) : null}
              </div>
              {frame.functionName ? (
                <p className="ml-12 mt-0.5 truncate font-mono text-2xs text-slate-500">{frame.functionName}</p>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </AiElementCard>
  );
}
