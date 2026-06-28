import type { GatewayManager } from '../gateway/manager';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import type {
  LocalControlPlaneCorrelationFilter,
  LocalControlPlaneCorrelationSummary,
  LocalControlPlaneReport,
  LocalControlPlaneReportFilter,
  LocalControlPlaneStatus,
} from '../../shared/host-api/contract';

type StatusRpcResult = {
  status?: LocalControlPlaneStatus;
};

type ReportsRpcResult = {
  reports?: LocalControlPlaneReport[];
};

type CorrelationsRpcResult = {
  correlations?: LocalControlPlaneCorrelationSummary;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function createLocalControlPlaneApi(
  gatewayManager: GatewayManager,
): CompleteHostServiceRegistry['localControlPlane'] {
  return {
    status: async () => {
      const result = asRecord(await gatewayManager.rpc('localControlPlane.status', {}, 10_000)) as StatusRpcResult;
      if (!result.status) {
        throw new Error('localControlPlane.status returned an invalid payload');
      }
      return { success: true, status: result.status };
    },
    reports: async (payload?: LocalControlPlaneReportFilter) => {
      const result = asRecord(await gatewayManager.rpc('localControlPlane.reports', payload ?? {}, 10_000)) as ReportsRpcResult;
      return { success: true, reports: Array.isArray(result.reports) ? result.reports : [] };
    },
    correlations: async (payload?: LocalControlPlaneCorrelationFilter) => {
      const result = asRecord(
        await gatewayManager.rpc('localControlPlane.correlations', payload ?? {}, 10_000),
      ) as CorrelationsRpcResult;
      if (!result.correlations) {
        throw new Error('localControlPlane.correlations returned an invalid payload');
      }
      return { success: true, correlations: result.correlations };
    },
  };
}
