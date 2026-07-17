import { beforeEach, describe, expect, it, vi } from 'vitest';

const openExternalSafe = vi.hoisted(() => vi.fn(async (url: string) => url));
const getSetting = vi.hoisted(() => vi.fn(async () => 'super-secret-gateway-token'));
const clipboardWriteText = vi.hoisted(() => vi.fn());
const scheduleControlUiDeviceAutoApproval = vi.hoisted(() => vi.fn());

vi.mock('@electron/utils/safe-open-external', () => ({ openExternalSafe }));
vi.mock('@electron/utils/store', () => ({ getSetting }));
vi.mock('@electron/utils/control-ui-device-pairing', () => ({
  scheduleControlUiDeviceAutoApproval,
}));
vi.mock('electron', () => ({
  clipboard: { writeText: (...args: unknown[]) => clipboardWriteText(...args) },
}));

vi.mock('@electron/services/mock-provider', () => ({
  handleMockChatSend: vi.fn(),
  handleMockSessionSend: vi.fn(),
}));
vi.mock('@electron/services/permissions-api', () => ({
  consumeApprovedPermissionApproval: vi.fn(),
  createPermissionApproval: vi.fn(),
  recordPermissionDecisionEvent: vi.fn(),
  recordPermissionAudit: vi.fn(),
}));
vi.mock('@electron/services/orchestration-presets-api', () => ({
  extractMaxWorkers: vi.fn(),
  extractRequestedRoles: vi.fn(),
  extractTemplateId: vi.fn(),
  listActiveOrchestrationPresets: vi.fn(() => []),
  matchOrchestrationPreset: vi.fn(),
}));
vi.mock('@electron/services/workspaces-api', () => ({
  getActiveWorkspaceProfile: vi.fn(async () => null),
}));
vi.mock('@electron/services/permission-decision-audit', () => ({
  createWorkspacePermissionDecisionEvent: vi.fn(),
}));
vi.mock('@electron/services/workspace-permissions', () => ({
  decideGatewayRpc: vi.fn(() => ({ allowed: true })),
  isApprovalRisk: vi.fn(() => false),
}));
vi.mock('@electron/utils/sandbox-high-risk-gate', () => ({
  classifyGatewayMethodForSandboxGate: vi.fn(() => null),
  composeWithSandboxHighRiskGate: vi.fn((a: unknown) => a),
  decideSandboxHighRiskAction: vi.fn(),
  loadSandboxHighRiskPolicy: vi.fn(),
}));

describe('P4-001 controlUi token non-exposure', () => {
  beforeEach(() => {
    openExternalSafe.mockClear();
    getSetting.mockClear();
    clipboardWriteText.mockClear();
    scheduleControlUiDeviceAutoApproval.mockClear();
    vi.resetModules();
  });

  it('opens Control UI from Main without returning token or secret URL', async () => {
    const { createGatewayApi } = await import('@electron/services/gateway-api');
    const gatewayManager = {
      getStatus: () => ({ port: 18789, state: 'running' }),
    };
    const api = createGatewayApi(gatewayManager as never, {} as never);
    const result = await api.controlUi({ view: 'dreams' });
    expect(result.success).toBe(true);
    expect(result.port).toBe(18789);
    expect(result.opened).toBe(true);
    expect(result.hasToken).toBe(true);
    expect((result as { token?: string }).token).toBeUndefined();
    expect((result as { url?: string }).url).toBeUndefined();
    expect(openExternalSafe).toHaveBeenCalledWith(
      expect.stringContaining('#token=super-secret-gateway-token'),
    );
    expect(JSON.stringify(result)).not.toContain('super-secret-gateway-token');
  });

  it('meta-only controlUi does not open browser and still hides token', async () => {
    const { createGatewayApi } = await import('@electron/services/gateway-api');
    const gatewayManager = {
      getStatus: () => ({ port: 18789, state: 'running' }),
    };
    const api = createGatewayApi(gatewayManager as never, {} as never);
    const result = await api.controlUi({ open: false });
    expect(result.opened).toBe(false);
    expect(result.hasToken).toBe(true);
    expect((result as { token?: string }).token).toBeUndefined();
    expect(openExternalSafe).not.toHaveBeenCalled();
  });

  it('copyGatewayToken writes clipboard in Main without returning token', async () => {
    const { createGatewayApi } = await import('@electron/services/gateway-api');
    const api = createGatewayApi(
      { getStatus: () => ({ port: 18789 }) } as never,
      {} as never,
    );
    const result = await api.copyGatewayToken();
    expect(result).toEqual({ success: true });
    expect(clipboardWriteText).toHaveBeenCalledWith('super-secret-gateway-token');
    expect(JSON.stringify(result)).not.toContain('super-secret');
  });
});
