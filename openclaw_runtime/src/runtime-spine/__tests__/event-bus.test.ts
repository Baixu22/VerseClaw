// @runtime-family v1.0
// @authority diagnostic_only
// @owner WP1

import { afterEach, describe, expect, it, vi } from 'vitest';

import { eventBus } from '../event-bus.js';
import type { EventSource } from '../types.js';

const source: EventSource = {
  sourceId: 'runtime-spine-test',
  sourceType: 'runtime_spine',
};

describe('RuntimeEventBus', () => {
  afterEach(() => {
    eventBus.clear();
    eventBus.setPersistenceAdapter(undefined);
  });

  it('calls handlers after emit', async () => {
    const handler = vi.fn();
    const unsubscribe = eventBus.on('diagnostic_record', handler);

    const event = eventBus.emit('diagnostic_record', 'entity-handler', 'verification_task', source);

    await vi.waitFor(() => expect(handler).toHaveBeenCalledWith(event));
    unsubscribe();
  });

  it('stops calling handlers after unsubscribe', async () => {
    const handler = vi.fn();
    const unsubscribe = eventBus.on('diagnostic_record', handler);
    unsubscribe();

    eventBus.emit('diagnostic_record', 'entity-unsubscribe', 'verification_task', source);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(handler).not.toHaveBeenCalled();
  });

  it('drops old events FIFO when the buffer exceeds 2000 events', () => {
    for (let index = 0; index < 2001; index += 1) {
      eventBus.emit('diagnostic_record', `entity-${index}`, 'verification_task', source, { index });
    }

    const buffer = eventBus.getBuffer();
    expect(buffer).toHaveLength(2000);
    expect(buffer[0]?.entityId).toBe('entity-1');
    expect(buffer.at(-1)?.entityId).toBe('entity-2000');
  });

  it('continues dispatching other handlers when one handler throws', async () => {
    const throwingHandler = vi.fn(() => {
      throw new Error('handler failure');
    });
    const succeedingHandler = vi.fn();
    const unsubscribeThrowing = eventBus.on('diagnostic_record', throwingHandler);
    const unsubscribeSucceeding = eventBus.on('diagnostic_record', succeedingHandler);

    const event = eventBus.emit('diagnostic_record', 'entity-throwing', 'verification_task', source);

    await vi.waitFor(() => expect(succeedingHandler).toHaveBeenCalledWith(event));
    unsubscribeThrowing();
    unsubscribeSucceeding();
  });

  it('does not let persistence adapter rejection affect emit', async () => {
    eventBus.setPersistenceAdapter(async () => {
      throw new Error('persistence unavailable');
    });

    expect(() =>
      eventBus.emit('diagnostic_record', 'entity-persist', 'verification_task', source),
    ).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(eventBus.getByEntity('entity-persist')).toHaveLength(1);
  });

  it('filters buffered events by entity id', () => {
    eventBus.emit('diagnostic_record', 'entity-a', 'verification_task', source);
    eventBus.emit('diagnostic_record', 'entity-b', 'verification_task', source);
    eventBus.emit('gate_decision', 'entity-a', 'verification_task', source);

    expect(eventBus.getByEntity('entity-a')).toEqual([
      expect.objectContaining({ entityId: 'entity-a', kind: 'diagnostic_record' }),
      expect.objectContaining({ entityId: 'entity-a', kind: 'gate_decision' }),
    ]);
  });
});
