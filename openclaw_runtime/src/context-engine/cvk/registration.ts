import {
  CONTEXT_RUNTIME_KIT_ENGINE_ID,
  createContextRuntimeKitContextEngine,
} from './engine.js';
import { registerContextEngineForOwner } from '../registry.js';

export function registerContextRuntimeKitContextEngine(): void {
  registerContextEngineForOwner(
    CONTEXT_RUNTIME_KIT_ENGINE_ID,
    async () => createContextRuntimeKitContextEngine(),
    'core',
    { allowSameOwnerRefresh: true },
  );
}
