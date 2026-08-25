// R0-1: unhandledRejection no longer exits the process; uncaughtException dialogs first
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  handleUncaughtException,
  handleUnhandledRejection,
  installOutputStreamErrorHandlers,
  type ProcessErrorReporter,
} from '../../electron/main/process-error-handlers';

function makeReporter(overrides: Partial<ProcessErrorReporter> = {}): ProcessErrorReporter {
  return {
    logger: {
      error: vi.fn(),
      getLogFilePath: () => '/tmp/verse-claw.log',
    },
    captureTelemetry: vi.fn(),
    showErrorBox: vi.fn(),
    ...overrides,
  };
}

describe('process error handlers (R0-1)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('unhandledRejection reports to telemetry and does NOT exit the process', () => {
    const reporter = makeReporter();
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit must not be called for unhandledRejection');
    });

    expect(() => handleUnhandledRejection(reporter, new Error('boom'))).not.toThrow();

    expect(reporter.logger.error).toHaveBeenCalled();
    expect(reporter.captureTelemetry).toHaveBeenCalledWith(
      'main_process_unhandled_rejection',
      expect.objectContaining({ message: 'boom' }),
    );
    expect(reporter.showErrorBox).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });

  it('truncates very long rejection messages before reporting', () => {
    const reporter = makeReporter();
    const longMessage = 'x'.repeat(2000);
    handleUnhandledRejection(reporter, longMessage);

    const reported = reporter.captureTelemetry as ReturnType<typeof vi.fn>;
    const message = reported.mock.calls[0][1].message as string;
    expect(message.length).toBeLessThanOrEqual(500);
  });

  it('uncaughtException shows a fatal dialog with the log path', () => {
    const reporter = makeReporter();
    expect(handleUncaughtException(reporter, new Error('fatal'))).toBe('fatal');

    expect(reporter.showErrorBox).toHaveBeenCalledWith(
      'Verse Claw encountered a fatal error',
      expect.stringContaining('/tmp/verse-claw.log'),
    );
    expect(reporter.captureTelemetry).not.toHaveBeenCalled();
  });

  it('ignores broken output pipes instead of showing recursive fatal dialogs', () => {
    const reporter = makeReporter();
    const error = Object.assign(new Error('broken pipe, write'), { code: 'EPIPE' });

    expect(handleUncaughtException(reporter, error)).toBe('ignored');
    expect(reporter.logger.error).not.toHaveBeenCalled();
    expect(reporter.showErrorBox).not.toHaveBeenCalled();
  });

  it('keeps non-pipe I/O errors fatal', () => {
    const reporter = makeReporter();
    const error = Object.assign(new Error('device I/O failed'), { code: 'EIO' });

    expect(handleUncaughtException(reporter, error)).toBe('fatal');
    expect(reporter.showErrorBox).toHaveBeenCalledOnce();
  });

  it('guards output streams against asynchronous EPIPE errors', () => {
    const stream = new EventEmitter();
    installOutputStreamErrorHandlers([stream]);

    expect(() => stream.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }))).not.toThrow();
    expect(() => stream.emit('error', Object.assign(new Error('disk failed'), { code: 'EIO_OTHER' }))).toThrow('disk failed');
  });

  it('handles non-Error rejection reasons without throwing', () => {
    const reporter = makeReporter();
    expect(() => handleUnhandledRejection(reporter, 'a string reason')).not.toThrow();
    expect(reporter.captureTelemetry).toHaveBeenCalledWith(
      'main_process_unhandled_rejection',
      expect.objectContaining({ message: 'a string reason' }),
    );
  });
});
