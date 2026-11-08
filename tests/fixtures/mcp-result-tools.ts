import { setTimeout as delay } from 'node:timers/promises';

export function resultFixtureTools(events: string[] = [], onEvent?: (event: string) => void) {
  const record = (event: string) => { events.push(event); onEvent?.(event); };
  return [{
    name: 'result_fixture', label: 'Result fixture', description: 'Deterministic SDK result fixture',
    parameters: { type: 'object', properties: { kind: { type: 'string' }, marker: { type: 'string' } }, required: ['kind'] },
    async execute(_id: string, input: unknown, signal?: AbortSignal) {
      const { kind, marker } = input as { kind: string; marker?: string };
      record(`start:${kind}:${marker ?? ''}`);
      if (kind === 'throw') throw new Error('Fixture failure');
      if (kind === 'slow') {
        try { await delay(1000, undefined, { signal }); }
        catch { record(`aborted:${marker}`); throw new DOMException('Fixture cancelled', 'AbortError'); }
      }
      const content = kind === 'image' ? [{ type: 'image', data: 'AA==', mimeType: 'image/png' }]
        : kind === 'audio' ? [{ type: 'audio', data: 'AA==', mimeType: 'audio/wav' }]
          : kind === 'resource' ? [{ type: 'resource', resource: { uri: 'file:///fixture.txt', text: 'fixture' } }]
            : kind === 'resource_link' ? [{ type: 'resource_link', uri: 'file:///fixture.txt', name: 'fixture' }]
            : [{ type: 'text', text: marker ?? kind }];
      record(`finish:${kind}:${marker ?? ''}`);
      return { content, ...(kind === 'error' ? { details: { status: 'error' } } : {}),
        ...(kind === 'waiting' ? { approvalRequired: true } : {}),
        ...(kind === 'structured' ? { structuredContent: { count: 1 } } : {}) };
    },
  }];
}
