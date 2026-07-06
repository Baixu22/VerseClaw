import { AlertTriangle, CheckCircle2, Clock3, FlaskConical } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Collapsible } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { AiElementCard, MetricPill, StatusDot } from './card';

export type TestStatus = 'passed' | 'failed' | 'skipped' | 'running';

export type TestResultsSummary = {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  running?: number;
  durationMs?: number;
};

export type TestResultCase = {
  name: string;
  status: TestStatus;
  durationMs?: number;
  error?: {
    message: string;
    stack?: string;
  };
};

export type TestResultSuite = {
  id?: string;
  name: string;
  status: TestStatus;
  tests: TestResultCase[];
};

export type TestResultsProps = {
  title?: string;
  summary: TestResultsSummary;
  suites: TestResultSuite[];
};

function formatDuration(durationMs: number | undefined): string {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs)) return '';
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  return `${(durationMs / 1000).toFixed(durationMs < 10_000 ? 1 : 0)}s`;
}

function statusTone(status: TestStatus): 'success' | 'danger' | 'warning' | 'info' | 'neutral' {
  if (status === 'passed') return 'success';
  if (status === 'failed') return 'danger';
  if (status === 'skipped') return 'neutral';
  return 'info';
}

export function TestResults({ title, summary, suites }: TestResultsProps) {
  const { t } = useTranslation('chat');
  const summaryStatus: TestStatus = summary.failed > 0 ? 'failed' : summary.running ? 'running' : 'passed';

  return (
    <AiElementCard
      icon={<FlaskConical className="h-3.5 w-3.5" />}
      label={t('toolUi.testResults.label', 'Test results')}
      title={title}
      subtitle={summary.durationMs != null ? formatDuration(summary.durationMs) : undefined}
      data-testid="chat-tool-ui-test-results"
    >
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2" data-testid="ai-test-results-summary">
          <MetricPill label={t('toolUi.testResults.total', 'total')} value={summary.total} />
          <MetricPill label={t('toolUi.testResults.passed', 'passed')} value={summary.passed} tone="success" />
          <MetricPill label={t('toolUi.testResults.failed', 'failed')} value={summary.failed} tone={summary.failed > 0 ? 'danger' : 'neutral'} />
          <MetricPill label={t('toolUi.testResults.skipped', 'skipped')} value={summary.skipped} />
          {summary.running ? <MetricPill label={t('toolUi.testResults.running', 'running')} value={summary.running} tone="info" /> : null}
          <span className={cn('inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs', statusTone(summaryStatus) === 'success' && 'border-green-500/25 bg-green-500/10 text-green-700 dark:text-green-400', statusTone(summaryStatus) === 'danger' && 'border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-400', statusTone(summaryStatus) === 'info' && 'border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-400')}>
            {summaryStatus === 'passed' ? <CheckCircle2 className="h-3.5 w-3.5" /> : summaryStatus === 'failed' ? <AlertTriangle className="h-3.5 w-3.5" /> : <Clock3 className="h-3.5 w-3.5" />}
            {t(`toolUi.testResults.status.${summaryStatus}`, summaryStatus)}
          </span>
        </div>

        {suites.length === 0 ? (
          <p className="rounded-md border border-dashed border-border bg-surface-input px-3 py-4 text-center text-xs text-muted-foreground">
            {t('toolUi.testResults.empty', 'No test suites were reported.')}
          </p>
        ) : (
          <div className="space-y-2">
            {suites.map((suite, index) => (
              <Collapsible
                key={suite.id ?? `${suite.name}-${index}`}
                defaultOpen={suite.status === 'failed' || index === 0}
                title={suite.name}
                subtitle={t('toolUi.testResults.suiteCount', '{{count}} tests', { count: suite.tests.length })}
                leading={<StatusDot status={suite.status} />}
                trailing={<span className="text-xs text-muted-foreground">{t(`toolUi.testResults.status.${suite.status}`, suite.status)}</span>}
                data-testid="ai-test-results-suite"
                className="bg-surface-input"
              >
                <div className="space-y-1.5">
                  {suite.tests.map((testCase, caseIndex) => (
                    <div
                      key={`${testCase.name}-${caseIndex}`}
                      className="rounded-md border border-border bg-background/60 px-2.5 py-2"
                      data-testid="ai-test-results-case"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <StatusDot status={testCase.status} className="h-1.5 w-1.5" />
                        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{testCase.name}</span>
                        {testCase.durationMs != null ? <span className="shrink-0 font-mono text-2xs text-muted-foreground">{formatDuration(testCase.durationMs)}</span> : null}
                      </div>
                      {testCase.error ? (
                        <div className="mt-2 rounded border border-red-500/20 bg-red-500/10 p-2 text-xs text-red-800 dark:text-red-300">
                          <p className="font-medium">{testCase.error.message}</p>
                          {testCase.error.stack ? <pre className="mt-1 overflow-auto whitespace-pre-wrap font-mono text-2xs leading-relaxed">{testCase.error.stack}</pre> : null}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </Collapsible>
            ))}
          </div>
        )}
      </div>
    </AiElementCard>
  );
}
