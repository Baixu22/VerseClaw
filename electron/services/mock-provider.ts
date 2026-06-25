import { app } from 'electron';

export const MOCK_PROVIDER_ID = 'clawx-mock-provider';
export const MOCK_PROVIDER_RESPONSE_TEXT = 'MOCK_PROVIDER_RESPONSE';

export type MockProviderResponse = {
  ok: true;
  testOnly: true;
  runId: string;
  message: {
    role: 'assistant';
    content: Array<{ type: 'text'; text: string }>;
  };
  usage: {
    inputTokens: 0;
    outputTokens: 0;
    totalTokens: 0;
  };
  cost: 0;
  source: 'mock';
  mockProviderId: typeof MOCK_PROVIDER_ID;
  hasApiKey: false;
  hasExternalBaseUrl: false;
  fixedLocalResponse: true;
};

export function isMockProviderEnabled(): boolean {
  return process.env.OPENCLAW_TEST_ENABLE_MOCK_PROVIDER === '1'
    && typeof process.env.VERSE_CLAW_USER_DATA_DIR === 'string'
    && process.env.VERSE_CLAW_USER_DATA_DIR.trim().length > 0
    && process.env.VERSE_CLAW_OPENCLAW_RUNTIME === 'source'
    && !app.isPackaged;
}

function buildMockResponse(): MockProviderResponse {
  return {
    ok: true,
    testOnly: true,
    runId: `mock_${Date.now()}`,
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: MOCK_PROVIDER_RESPONSE_TEXT }],
    },
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    },
    cost: 0,
    source: 'mock',
    mockProviderId: MOCK_PROVIDER_ID,
    hasApiKey: false,
    hasExternalBaseUrl: false,
    fixedLocalResponse: true,
  };
}

export function handleMockChatSend(_params: unknown): MockProviderResponse | null {
  return isMockProviderEnabled() ? buildMockResponse() : null;
}

export function handleMockSessionSend(_params: unknown): MockProviderResponse | null {
  return isMockProviderEnabled() ? buildMockResponse() : null;
}
