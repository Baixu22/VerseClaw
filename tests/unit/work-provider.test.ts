import { describe, expect, it } from 'vitest';
import {
  normalizeWorkProviderConfig,
  resolveWorkKitProviderCapabilities,
  resolveWorkProviders,
  summarizeWorkProviderCapabilities,
} from '@shared/types/work-provider';
import type { WorkModeKit } from '@shared/types/work-mode';

describe('work provider registry', () => {
  it('normalizes config and ignores unknown providers', () => {
    expect(normalizeWorkProviderConfig({
      'office-sheet-js': {
        enabled: false,
        config: {
          endpoint: 'https://search.local',
          retries: 2,
          active: true,
          nested: { ignored: true },
        },
      },
      unknown: { enabled: true },
    })).toEqual({
      'office-sheet-js': {
        enabled: false,
        config: {
          endpoint: 'https://search.local',
          retries: 2,
          active: true,
        },
      },
    });
  });

  it('resolves ready, disabled, missing dependency, missing config, and external statuses', () => {
    const providers = resolveWorkProviders({
      dependencyAvailability: {
        mammoth: true,
        docx: false,
        xlsx: true,
        'pdfjs-dist': true,
        'pdf-lib': false,
        '@mozilla/readability': true,
        jsdom: true,
      },
      config: {
        'office-sheet-js': { enabled: false },
      },
    });
    const capabilities = providers.flatMap((provider) => provider.capabilities);

    expect(capabilities.find((item) => item.capability === 'document.read')).toMatchObject({
      providerId: 'office-document-js',
      status: 'ready',
    });
    expect(capabilities.find((item) => item.capability === 'document.write')).toMatchObject({
      providerId: 'office-document-js',
      status: 'missingDependency',
      missingDependencyIds: ['docx'],
    });
    expect(providers.find((provider) => provider.id === 'office-sheet-js')?.status).toBe('disabled');
    expect(capabilities.find((item) => item.capability === 'web.search')).toMatchObject({
      providerId: 'web-search-configured',
      status: 'missingConfig',
    });
    expect(providers.find((provider) => provider.id === 'libreoffice-external')?.status).toBe('externalUnavailable');
  });

  it('marks configured external services ready and unavailable when runtime is down', () => {
    const ready = resolveWorkProviders({
      config: {
        'web-search-configured': {
          config: {
            provider: 'searxng',
            endpoint: 'https://search.local/search',
          },
        },
      },
    }).flatMap((provider) => provider.capabilities);

    expect(ready.find((item) => item.capability === 'web.search')).toMatchObject({
      status: 'ready',
      installMode: 'externalService',
    });

    const unavailable = resolveWorkProviders({
      runtimeAvailable: false,
      config: {
        'web-search-configured': {
          config: {
            provider: 'searxng',
            endpoint: 'https://search.local/search',
          },
        },
      },
    }).flatMap((provider) => provider.capabilities);

    expect(unavailable.find((item) => item.capability === 'web.search')).toMatchObject({
      status: 'runtimeUnavailable',
    });
  });

  it('maps work kits to provider capabilities and ignores unknown kits', () => {
    const providers = resolveWorkProviders({
      dependencyAvailability: {
        mammoth: true,
        docx: true,
        xlsx: true,
        'pdfjs-dist': true,
        'pdf-lib': true,
      },
    });
    const mapped = resolveWorkKitProviderCapabilities(
      ['reports', 'sheets', 'unknown' as WorkModeKit],
      providers.flatMap((provider) => provider.capabilities),
    );

    expect(mapped.map((item) => [item.kit, item.capability])).toEqual([
      ['reports', 'document.read'],
      ['reports', 'document.write'],
      ['reports', 'pdf.validate'],
      ['sheets', 'sheet.read'],
      ['sheets', 'sheet.write'],
      ['sheets', 'csv.read'],
    ]);
  });

  it('summarizes capability statuses', () => {
    expect(summarizeWorkProviderCapabilities([
      { status: 'ready' },
      { status: 'ready' },
      { status: 'missingDependency' },
      { status: 'missingConfig' },
    ])).toMatchObject({
      ready: 2,
      missingDependency: 1,
      missingConfig: 1,
      disabled: 0,
    });
  });
});
