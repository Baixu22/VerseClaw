import { describe, expect, it, vi } from 'vitest';
import {
  configureMediaTranscription,
  transcribeAudioChunk,
} from './youtube.js';

describe('YouTube OpenClaw transcription', () => {
  it('routes an audio chunk through the configured media runtime', async () => {
    const transcribeAudioFile = vi.fn(async () => ({
      text: 'runtime transcript',
      provider: 'configured-provider',
    }));
    configureMediaTranscription(transcribeAudioFile, { tools: {} });

    await expect(transcribeAudioChunk('chunk_000.m4a')).resolves.toBe('runtime transcript');
    expect(transcribeAudioFile).toHaveBeenCalledWith(expect.objectContaining({
      filePath: 'chunk_000.m4a',
      cfg: { tools: {} },
      mime: 'audio/mp4',
    }));
  });

  it('reports the chunk name when the runtime returns no transcript', async () => {
    configureMediaTranscription(async () => ({ text: undefined }), {});

    await expect(transcribeAudioChunk('chunk_002.m4a'))
      .rejects.toThrow('chunk_002.m4a');
  });

  it('preserves the runtime error with the failing chunk name', async () => {
    configureMediaTranscription(async () => {
      throw new Error('provider unavailable');
    }, {});

    await expect(transcribeAudioChunk('chunk_003.m4a'))
      .rejects.toThrow('chunk_003.m4a: provider unavailable');
  });
});
