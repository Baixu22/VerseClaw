/**
 * Process-level error handlers for the Electron main process.
 *
 * Extracted from electron/main/index.ts so the fail-closed semantics can be
 * unit-tested without booting Electron. See R0-1.
 */

export type ProcessErrorReporter = {
  logger: {
    error: (message: string, ...args: unknown[]) => void;
    getLogFilePath: () => string | null;
  };
  captureTelemetry: (event: string, properties: Record<string, unknown>) => void;
  showErrorBox: (title: string, content: string) => void;
};

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/**
 * Fail-closed on truly fatal errors: log and surface a native dialog with the
 * log path BEFORE the caller performs best-effort gateway cleanup and forced
 * exit, so the user is not left with a silent quit. This function does not
 * exit — the caller decides the exit path.
 */
export function handleUncaughtException(reporter: ProcessErrorReporter, error: unknown): void {
  const message = errorMessage(error);
  reporter.logger.error('Uncaught exception in main process:', error);
  reporter.showErrorBox(
    'Verse Claw encountered a fatal error',
    `${message}\n\nLog file: ${reporter.logger.getLogFilePath() ?? '(log file unavailable)'}`,
  );
}

/**
 * A rejected promise is not necessarily fatal — log and report it (visible in
 * the diagnostics panel log tail and telemetry) instead of exiting the process.
 */
export function handleUnhandledRejection(reporter: ProcessErrorReporter, reason: unknown): void {
  const message = errorMessage(reason);
  reporter.logger.error('Unhandled promise rejection in main process:', reason);
  reporter.captureTelemetry('main_process_unhandled_rejection', {
    message: message.slice(0, 500),
  });
}
