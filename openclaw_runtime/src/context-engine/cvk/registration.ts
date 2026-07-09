import {
  CONTEXT_RUNTIME_KIT_ENGINE_ID,
  createContextRuntimeKitContextEngine,
} from './engine.js';
import { registerContextEngineForOwner } from '../registry.js';
import { getContextFamilyLifecycleAuditSnapshot } from '../registry/context-item-registry.js';

export function registerContextRuntimeKitContextEngine(): void {
  registerContextEngineForOwner(
    CONTEXT_RUNTIME_KIT_ENGINE_ID,
    async (ctx) => createContextRuntimeKitContextEngine({
      contextStatusEnabled: ctx.config?.runtime?.contextFamily?.contextStatus?.enabled === true,
      contextStatusSnapshot: getContextFamilyLifecycleAuditSnapshot().status,
    }),
    'core',
    { allowSameOwnerRefresh: true },
  );
}
