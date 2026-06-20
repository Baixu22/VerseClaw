import { beforeEach, describe, expect, it, vi } from 'vitest';

const getSettingMock = vi.fn(async () => ({}));

vi.mock('@electron/utils/store', () => ({
  getSetting: (...args: unknown[]) => getSettingMock(...args),
}));

vi.mock('@electron/services/skills/local-skill-service', () => ({
  listLocalSkills: vi.fn(async () => [
    { id: 'docx', slug: 'docx', enabled: true },
    { id: 'xlsx', slug: 'xlsx', enabled: true },
    { id: 'pptx', slug: 'pptx', enabled: true },
    { id: 'pdf', slug: 'pdf', enabled: true },
  ]),
}));

describe('chat knowledge scope metadata', () => {
  beforeEach(() => {
    getSettingMock.mockReset();
    getSettingMock.mockResolvedValue({});
  });

  it('injects hidden knowledge metadata for wiki scope', async () => {
    const gatewayManager = {
      rpc: vi.fn(async () => ({ runId: 'run-wiki' })),
      getStatus: vi.fn(() => ({ state: 'running', gatewayReady: true })),
    };
    const { createChatApi } = await import('@electron/services/chat-api');
    const api = createChatApi({ gatewayManager: gatewayManager as never });

    await expect(api.sendWithMedia({
      sessionKey: 'agent:main:main',
      message: 'Use the project notes',
      idempotencyKey: 'idem-wiki',
      knowledgeScope: 'wiki',
    })).resolves.toEqual({ success: true, result: { runId: 'run-wiki' } });

    const payload = gatewayManager.rpc.mock.calls[0]?.[1] as { message: string };
    expect(payload.message).toContain('Conversation info (untrusted metadata)');
    expect(payload.message).toContain('"clawxKnowledgeScope":"wiki"');
    expect(payload.message).toContain('"corpus":"wiki"');
    expect(payload.message).toContain('"access":"read-only"');
    expect(payload.message).toContain('"allowedKnowledgeActions":["search","get"]');
    expect(payload.message).toContain('"deniedKnowledgeActions":["apply","update","delete","archive","merge"]');
    expect(payload.message).toContain('Do not save, modify, merge, archive, delete, or apply knowledge');
    expect(payload.message).toContain('Use the project notes');
  });

  it('injects work mode metadata when a valid work mode is provided', async () => {
    const gatewayManager = {
      rpc: vi.fn(async () => ({ runId: 'run-plan' })),
      getStatus: vi.fn(() => ({ state: 'running', gatewayReady: true })),
    };
    const { createChatApi } = await import('@electron/services/chat-api');
    const api = createChatApi({ gatewayManager: gatewayManager as never });

    await api.sendWithMedia({
      sessionKey: 'agent:main:main',
      message: 'Sketch the rollout',
      idempotencyKey: 'idem-plan',
      workMode: 'plan',
    });

    const payload = gatewayManager.rpc.mock.calls[0]?.[1] as { message: string };
    expect(payload.message).toContain('Work mode info (untrusted metadata)');
    expect(payload.message).toContain('"clawxWorkMode":"plan"');
    expect(payload.message).toContain('"responseStyle":"plan-first"');
    expect(payload.message).toContain('"defaultKnowledgeScope":"all"');
    expect(payload.message).toContain('"stateWidgets":["planning"]');
    expect(payload.message).toContain('"kits":["reports","research","ops"]');
    expect(payload.message).toContain('"expectedArtifactTypes":["markdown","docx","pdf","html","csv"]');
    expect(payload.message).toContain('"capabilityStatusSummary":{"ready":1,"missingSkill":0,"disabled":0,"runtimeUnavailable":0,"optionalExternal":2}');
    expect(payload.message).toContain('Sketch the rollout');
  });

  it('uses customized tool bundle settings in work mode metadata and migrates them to kits', async () => {
    getSettingMock.mockImplementation(async (key) => (
      key === 'workModeToolBundles' ? { docsData: ['docs', 'pdf'] } : {}
    ));
    const gatewayManager = {
      rpc: vi.fn(async () => ({ runId: 'run-docs' })),
      getStatus: vi.fn(() => ({ state: 'running', gatewayReady: true })),
    };
    const { createChatApi } = await import('@electron/services/chat-api');
    const api = createChatApi({ gatewayManager: gatewayManager as never });

    await api.sendWithMedia({
      sessionKey: 'agent:main:main',
      message: 'Summarize reports',
      idempotencyKey: 'idem-docs',
      workMode: 'docsData',
    });

    const payload = gatewayManager.rpc.mock.calls[0]?.[1] as { message: string };
    expect(payload.message).toContain('"toolBundles":["docs","pdf"]');
    expect(payload.message).toContain('"kits":["reports","slides","pdf"]');
  });

  it('does not inject metadata for none or unknown scope', async () => {
    const gatewayManager = {
      rpc: vi.fn(async () => ({ runId: 'run-none' })),
      getStatus: vi.fn(() => ({ state: 'running', gatewayReady: true })),
    };
    const { createChatApi } = await import('@electron/services/chat-api');
    const api = createChatApi({ gatewayManager: gatewayManager as never });

    await api.sendWithMedia({
      sessionKey: 'agent:main:main',
      message: 'Plain message',
      idempotencyKey: 'idem-none',
      knowledgeScope: 'none',
    });
    await api.sendWithMedia({
      sessionKey: 'agent:main:main',
      message: 'Unknown scope message',
      idempotencyKey: 'idem-unknown',
      knowledgeScope: 'obsidian',
    });

    expect((gatewayManager.rpc.mock.calls[0]?.[1] as { message: string }).message).toBe('Plain message');
    expect((gatewayManager.rpc.mock.calls[1]?.[1] as { message: string }).message).toBe('Unknown scope message');
  });
});
