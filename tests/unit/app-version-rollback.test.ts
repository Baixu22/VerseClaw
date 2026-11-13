import { describe, expect, it } from 'vitest';
import {
  compareAppVersions,
  forceDcsConfigOff,
} from '../../electron/utils/app-version-rollback';
import { getConfigPathValue } from '../../shared/dcs/prod-flags-control';

describe('app version rollback protection', () => {
  it('detects an older current binary, including prerelease ordering', () => {
    expect(compareAppVersions('0.5.0', '0.4.9-alpha.0')).toBe(1);
    expect(compareAppVersions('0.4.9', '0.4.9-alpha.0')).toBe(1);
    expect(compareAppVersions('0.4.9-alpha.0', '0.4.9-alpha.0')).toBe(0);
    expect(compareAppVersions('not-semver', '0.4.9')).toBeNull();
  });

  it('forces every writable DCS config flag off without dropping ordinary data', () => {
    const original = {
      models: { providers: { openai: { apiKey: 'preserved' } } },
      runtime: {
        contextBlock: {
          'working-memory': { enabled: true },
          'tool-registry': { enabled: true },
        },
        coding: {
          staleWriteGuard: { enabled: true },
          symbolLease: { enabled: true },
          routingMemo: { shadow: true },
          sekb: { experienceShadow: true },
        },
      },
    };

    const next = forceDcsConfigOff(original);

    expect(getConfigPathValue(next, 'runtime.contextBlock.working-memory.enabled')).toBe(false);
    expect(getConfigPathValue(next, 'runtime.contextBlock.tool-registry.enabled')).toBe(false);
    expect(getConfigPathValue(next, 'runtime.coding.staleWriteGuard.enabled')).toBe(false);
    // TF-0137: symbol lease is API-only and is not a rollback surface.
    expect(getConfigPathValue(next, 'runtime.coding.symbolLease.enabled')).toBe(true);
    expect(getConfigPathValue(next, 'runtime.coding.routingMemo.shadow')).toBe(false);
    // TF-0137: this leaf is API-only and is not a rollback surface.
    expect(getConfigPathValue(next, 'runtime.coding.sekb.experienceShadow')).toBe(true);
    expect(next.models).toEqual(original.models);
    expect(getConfigPathValue(original, 'runtime.contextBlock.working-memory.enabled')).toBe(true);
  });
});
