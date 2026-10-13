/**
 * #177: the runtime event-log + dual-read resume pilot is a built-but-unwired
 * asset — every flag defaults off, `sessions.restoreCheckpoint` gates the replay
 * pilot off, and `checkpoint-rollback-executor` answers
 * `event_log_replay_not_implemented`.
 *
 * This guard exists so a default cannot be flipped (or the capability quietly
 * assumed live) without someone deliberately updating this test and the STATUS
 * note in `openclaw_runtime/src/runtime-core/event-log.ts`.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RUNTIME_EVENT_LOG_FEATURE_FLAGS,
  RUNTIME_EVENT_LOG_FLAG_PATHS,
} from '../../openclaw_runtime/src/runtime-core/event-log';

describe('#177 runtime event-log is built-but-unwired', () => {
  it('keeps every feature flag defaulted off', () => {
    expect(DEFAULT_RUNTIME_EVENT_LOG_FEATURE_FLAGS).toEqual({
      eventLogShadow: false,
      eventLogPersist: false,
      checkpointSerializerShadow: false,
      resumeReplayShadow: false,
    });
  });

  it('maps each flag to the config path the schema documents', () => {
    expect(RUNTIME_EVENT_LOG_FLAG_PATHS).toEqual({
      eventLogShadow: 'runtime.eventLog.shadow',
      eventLogPersist: 'runtime.eventLog.persist',
      checkpointSerializerShadow: 'runtime.checkpointSerializer.shadow',
      resumeReplayShadow: 'runtime.resume.replayShadow',
    });
  });
});