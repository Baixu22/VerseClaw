import { describe, expect, it } from 'vitest';
import {
  normalizeForSearch,
  scanModelRefsInText,
  summarizeRunRelevantText,
} from '../../scripts/model-consistency-evidence.mjs';

describe('model consistency evidence helpers', () => {
  it('normalizes escaped Windows paths so transcript JSON can match run workspaces', () => {
    const transcriptText = 'Workspace root: C:\\\\Users\\\\27933\\\\Desktop\\\\clawx\\\\ClawX\\\\artifacts\\\\real-runtime-validation\\\\run-20260705-025439';
    const runNeedle = 'C:/Users/27933/Desktop/clawx/ClawX/artifacts/real-runtime-validation/run-20260705-025439';

    expect(normalizeForSearch(transcriptText)).toContain(runNeedle);
  });

  it('canonicalizes model refs and ignores DeepSeek API URLs', () => {
    expect(scanModelRefsInText('"model":"deepseek-v4-flash","baseURL":"api.deepseek.com/v1"')).toEqual([
      'deepseek/deepseek-v4-flash',
    ]);
  });

  it('summarizes only current-run transcript turns and ignores stale model refs in the same session file', () => {
    const lines = [
      JSON.stringify({ type: 'message', message: { role: 'assistant', model: 'deepseek-v4-pro', content: 'old run' } }),
      JSON.stringify({
        type: 'message',
        message: {
          role: 'user',
          content: 'Validation repair task. Workspace root: C:\\\\Users\\\\27933\\\\Desktop\\\\clawx\\\\ClawX\\\\artifacts\\\\real-runtime-validation\\\\run-20260705-025439\\\\workspaces\\\\round-1',
        },
      }),
      JSON.stringify({
        type: 'message',
        message: {
          role: 'assistant',
          model: 'deepseek-v4-flash',
          content: [{ type: 'toolCall', arguments: { path: 'C:\\\\Users\\\\27933\\\\Desktop\\\\clawx\\\\ClawX\\\\artifacts\\\\real-runtime-validation\\\\run-20260705-025439\\\\workspaces\\\\round-1\\\\src\\\\math.js' } }],
        },
      }),
      JSON.stringify({ type: 'message', message: { role: 'assistant', model: 'deepseek-v4-flash', content: 'done' } }),
      JSON.stringify({ type: 'message', message: { role: 'user', content: 'unrelated later task' } }),
      JSON.stringify({ type: 'message', message: { role: 'assistant', model: 'deepseek-v4-pro', content: 'new unrelated run' } }),
    ].join('\n');

    const summary = summarizeRunRelevantText(lines, [
      'C:/Users/27933/Desktop/clawx/ClawX/artifacts/real-runtime-validation/run-20260705-025439',
    ]);

    expect(summary.containsRunWorkspace).toBe(true);
    expect(summary.relevantLineCount).toBe(3);
    expect(summary.modelRefs).toEqual(['deepseek/deepseek-v4-flash']);
  });

  it('uses trajectory event modelId instead of stale nested transcript history', () => {
    const trajectoryLine = JSON.stringify({
      traceSchema: 'openclaw-trajectory',
      type: 'context.compiled',
      provider: 'deepseek',
      modelId: 'deepseek-v4-flash',
      data: {
        prompt: 'Workspace root: C:\\\\Users\\\\27933\\\\Desktop\\\\clawx\\\\ClawX\\\\artifacts\\\\real-runtime-validation\\\\run-20260705-025439\\\\workspaces\\\\round-1',
        messages: [
          {
            role: 'assistant',
            model: 'deepseek-v4-pro',
            content: 'stale nested history from an older run',
          },
        ],
      },
    });

    const summary = summarizeRunRelevantText(trajectoryLine, [
      'C:/Users/27933/Desktop/clawx/ClawX/artifacts/real-runtime-validation/run-20260705-025439',
    ]);

    expect(summary.containsRunWorkspace).toBe(true);
    expect(summary.modelRefs).toEqual(['deepseek/deepseek-v4-flash']);
  });
});
