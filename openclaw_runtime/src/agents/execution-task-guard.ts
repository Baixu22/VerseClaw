import { existsSync } from 'node:fs';
import { createTaskRuntimeGuard } from '../../../shared/task-system/runtime.js';
import { getSessionEntry } from '../config/sessions/store.js';
import { createExecutionTaskAccess } from './execution-task-authority.js';
import { TaskSystemStore } from '../../../shared/task-system/store.js';
import type { StreamFn } from 'openclaw/plugin-sdk/agent-core';

/** Runtime admission reads session state; Main's authority access stays independent of runtime config. */
export function createExecutionTaskGuard(workspace: string | undefined, sessionKey: string | undefined, generation: string | undefined, runId?: string) {
  if (process.env.CLAWX_TASK_SCOPE_BRIDGE === '1' && sessionKey) {
    const migration = getSessionEntry({ sessionKey })?.executionMigration;
    if (migration && migration.state !== 'confirmed') throw new Error('TASK_EXECUTION_MIGRATION_PENDING');
  }
  return createTaskRuntimeGuard(workspace, sessionKey, generation, runId,
    workspace && sessionKey && existsSync(workspace) ? createExecutionTaskAccess(workspace) : undefined);
}

/** Confirm only read content that survived all prompt budgets and produced a model response. */
export function wrapReviewerReadConfirmation(streamFn: StreamFn, guard: ReturnType<typeof createExecutionTaskGuard>): StreamFn {
  if (!guard || guard.credential || !existsSync(guard.domain.database)) return streamFn;
  return async (model, context, options) => {
    const messages = structuredClone(context.messages.filter(message => message.role === 'toolResult'));
    let delivered = [] as typeof messages;
    const stream = await streamFn(model, context, { ...options, onPayload: async (payload, selectedModel) => {
      const transformed = await options?.onPayload?.(payload, selectedModel);
      const strings: string[] = [];
      const binary: Uint8Array[] = [];
      const walk = (value: unknown): void => {
        if (typeof value === 'string') strings.push(value);
        else if (value instanceof Uint8Array) binary.push(value);
        else if (Array.isArray(value)) value.forEach(walk);
        else if (value && typeof value === 'object') Object.values(value).forEach(walk);
      };
      walk(transformed ?? payload);
      delivered = messages.filter(message => message.content.every(block => block.type === 'text'
        ? strings.some(value => value.includes(block.text))
        : block.type === 'image' && (strings.some(value => value.includes(block.data)) ||
          binary.some(value => Buffer.from(value).equals(Buffer.from(block.data, 'base64'))))));
      return transformed;
    } });
    let confirmed = false;
    const confirm = () => {
      if (confirmed) return;
      const store = new TaskSystemStore(guard.domain, undefined, guard.access);
      try { store.confirmReviewerPrompt(guard.sessionKey, guard.generation, delivered); confirmed = true; }
      finally { store.close(); }
    };
    const iterate = stream[Symbol.asyncIterator].bind(stream);
    stream[Symbol.asyncIterator] = async function* () {
      for await (const event of { [Symbol.asyncIterator]: iterate }) {
        if (event.type === 'done') confirm();
        yield event;
      }
    };
    const result = stream.result.bind(stream);
    stream.result = async () => {
      const response = await result();
      if (response.stopReason !== 'error' && response.stopReason !== 'aborted') confirm();
      return response;
    };
    return stream;
  };
}
