import type { WorkModeKit } from './work-mode';

export type WorkProviderKind =
  | 'officeDocument'
  | 'officeSheet'
  | 'officeSlide'
  | 'pdf'
  | 'webSearch'
  | 'webRead'
  | 'formatConversion'
  | 'crawler'
  | 'ocr'
  | 'dataFrame';

export type WorkProviderStatus =
  | 'ready'
  | 'missingDependency'
  | 'missingConfig'
  | 'disabled'
  | 'externalUnavailable'
  | 'runtimeUnavailable';

export type WorkProviderInstallMode =
  | 'builtIn'
  | 'optionalNpm'
  | 'externalBinary'
  | 'externalService';

export type WorkProviderCapability =
  | 'document.read'
  | 'document.write'
  | 'sheet.read'
  | 'sheet.write'
  | 'csv.read'
  | 'slide.write'
  | 'pdf.validate'
  | 'pdf.merge'
  | 'web.search'
  | 'web.extract'
  | 'citation.pack'
  | 'format.convert'
  | 'crawler.run'
  | 'ocr.extract'
  | 'dataframe.analyze';

export type WorkProviderId =
  | 'office-document-js'
  | 'office-sheet-js'
  | 'office-slide-js'
  | 'pdf-js'
  | 'web-search-configured'
  | 'web-read-js'
  | 'libreoffice-external'
  | 'pandoc-external'
  | 'crawler-external'
  | 'ocr-external'
  | 'dataframe-external';

export interface WorkProviderCapabilityDefinition {
  id: WorkProviderCapability;
  dependencyIds?: string[];
  requiresConfig?: boolean;
  external?: boolean;
}

export interface WorkProviderDefinition {
  id: WorkProviderId;
  kind: WorkProviderKind;
  labelKey: string;
  descriptionKey: string;
  installMode: WorkProviderInstallMode;
  dependencyIds: string[];
  capabilities: WorkProviderCapabilityDefinition[];
  optional: boolean;
}

export interface WorkProviderConfigEntry {
  enabled?: boolean;
  config?: Record<string, string | number | boolean | null | undefined>;
}

export type WorkProviderConfig = Partial<Record<WorkProviderId, WorkProviderConfigEntry>>;

export interface WorkProviderCapabilityStatus {
  providerId: WorkProviderId;
  kind: WorkProviderKind;
  capability: WorkProviderCapability;
  status: WorkProviderStatus;
  missingDependencyIds: string[];
  installMode: WorkProviderInstallMode;
}

export interface WorkProviderResolved {
  id: WorkProviderId;
  kind: WorkProviderKind;
  labelKey: string;
  descriptionKey: string;
  installMode: WorkProviderInstallMode;
  status: WorkProviderStatus;
  dependencyIds: string[];
  missingDependencyIds: string[];
  capabilities: WorkProviderCapabilityStatus[];
  optional: boolean;
}

export interface WorkKitProviderCapability {
  kit: WorkModeKit;
  capability: WorkProviderCapability;
  providerIds: WorkProviderId[];
  statuses: WorkProviderStatus[];
}

export type WorkProviderStatusSummary = Record<WorkProviderStatus, number>;

export interface WorkProviderStatusSnapshot {
  success: true;
  providers: WorkProviderResolved[];
  capabilities: WorkProviderCapabilityStatus[];
  kitCapabilities: WorkKitProviderCapability[];
  summary: WorkProviderStatusSummary;
}

export type WorkProviderRunPayload = {
  capability: WorkProviderCapability;
  providerId?: WorkProviderId;
  input?: Record<string, unknown>;
};

export type WorkProviderRunResult = {
  success: boolean;
  providerId?: WorkProviderId;
  capability?: WorkProviderCapability;
  output?: Record<string, unknown>;
  error?: string;
};

export type WorkProviderValidateArtifactPayload = {
  path: string;
};

export type WorkProviderValidateArtifactResult = {
  success: boolean;
  path?: string;
  artifactType?: string;
  valid?: boolean;
  previewAvailable?: boolean;
  details?: Record<string, unknown>;
  error?: string;
};

export const WORK_PROVIDER_STATUSES: WorkProviderStatus[] = [
  'ready',
  'missingDependency',
  'missingConfig',
  'disabled',
  'externalUnavailable',
  'runtimeUnavailable',
];

export const WORK_PROVIDER_DEFINITIONS: WorkProviderDefinition[] = [
  {
    id: 'office-document-js',
    kind: 'officeDocument',
    labelKey: 'workProviders.providers.officeDocument',
    descriptionKey: 'workProviders.providerDescriptions.officeDocument',
    installMode: 'builtIn',
    dependencyIds: ['mammoth', 'docx'],
    capabilities: [
      { id: 'document.read', dependencyIds: ['mammoth'] },
      { id: 'document.write', dependencyIds: ['docx'] },
    ],
    optional: false,
  },
  {
    id: 'office-sheet-js',
    kind: 'officeSheet',
    labelKey: 'workProviders.providers.officeSheet',
    descriptionKey: 'workProviders.providerDescriptions.officeSheet',
    installMode: 'builtIn',
    dependencyIds: ['xlsx', 'exceljs', 'papaparse'],
    capabilities: [
      { id: 'sheet.read', dependencyIds: ['xlsx'] },
      { id: 'sheet.write', dependencyIds: ['xlsx'] },
      { id: 'csv.read', dependencyIds: [] },
    ],
    optional: false,
  },
  {
    id: 'office-slide-js',
    kind: 'officeSlide',
    labelKey: 'workProviders.providers.officeSlide',
    descriptionKey: 'workProviders.providerDescriptions.officeSlide',
    installMode: 'builtIn',
    dependencyIds: ['pptxgenjs'],
    capabilities: [
      { id: 'slide.write', dependencyIds: ['pptxgenjs'] },
    ],
    optional: false,
  },
  {
    id: 'pdf-js',
    kind: 'pdf',
    labelKey: 'workProviders.providers.pdf',
    descriptionKey: 'workProviders.providerDescriptions.pdf',
    installMode: 'builtIn',
    dependencyIds: ['pdfjs-dist', 'pdf-lib'],
    capabilities: [
      { id: 'pdf.validate', dependencyIds: ['pdfjs-dist'] },
      { id: 'pdf.merge', dependencyIds: ['pdf-lib'] },
    ],
    optional: false,
  },
  {
    id: 'web-search-configured',
    kind: 'webSearch',
    labelKey: 'workProviders.providers.webSearch',
    descriptionKey: 'workProviders.providerDescriptions.webSearch',
    installMode: 'externalService',
    dependencyIds: [],
    capabilities: [
      { id: 'web.search', requiresConfig: true, external: true },
    ],
    optional: true,
  },
  {
    id: 'web-read-js',
    kind: 'webRead',
    labelKey: 'workProviders.providers.webRead',
    descriptionKey: 'workProviders.providerDescriptions.webRead',
    installMode: 'builtIn',
    dependencyIds: ['@mozilla/readability', 'jsdom', 'turndown', 'cheerio'],
    capabilities: [
      { id: 'web.extract', dependencyIds: ['@mozilla/readability', 'jsdom'] },
      { id: 'citation.pack' },
    ],
    optional: false,
  },
  {
    id: 'libreoffice-external',
    kind: 'formatConversion',
    labelKey: 'workProviders.providers.libreOffice',
    descriptionKey: 'workProviders.providerDescriptions.libreOffice',
    installMode: 'externalBinary',
    dependencyIds: ['libreoffice'],
    capabilities: [
      { id: 'format.convert', dependencyIds: ['libreoffice'], external: true },
    ],
    optional: true,
  },
  {
    id: 'pandoc-external',
    kind: 'formatConversion',
    labelKey: 'workProviders.providers.pandoc',
    descriptionKey: 'workProviders.providerDescriptions.pandoc',
    installMode: 'externalBinary',
    dependencyIds: ['pandoc'],
    capabilities: [
      { id: 'format.convert', dependencyIds: ['pandoc'], external: true },
    ],
    optional: true,
  },
  {
    id: 'crawler-external',
    kind: 'crawler',
    labelKey: 'workProviders.providers.crawler',
    descriptionKey: 'workProviders.providerDescriptions.crawler',
    installMode: 'externalService',
    dependencyIds: [],
    capabilities: [
      { id: 'crawler.run', requiresConfig: true, external: true },
    ],
    optional: true,
  },
  {
    id: 'ocr-external',
    kind: 'ocr',
    labelKey: 'workProviders.providers.ocr',
    descriptionKey: 'workProviders.providerDescriptions.ocr',
    installMode: 'externalService',
    dependencyIds: [],
    capabilities: [
      { id: 'ocr.extract', requiresConfig: true, external: true },
    ],
    optional: true,
  },
  {
    id: 'dataframe-external',
    kind: 'dataFrame',
    labelKey: 'workProviders.providers.dataFrame',
    descriptionKey: 'workProviders.providerDescriptions.dataFrame',
    installMode: 'externalService',
    dependencyIds: [],
    capabilities: [
      { id: 'dataframe.analyze', requiresConfig: true, external: true },
    ],
    optional: true,
  },
];

export const WORK_KIT_PROVIDER_CAPABILITIES: Record<WorkModeKit, WorkProviderCapability[]> = {
  reports: ['document.read', 'document.write', 'pdf.validate'],
  sheets: ['sheet.read', 'sheet.write', 'csv.read'],
  slides: ['slide.write'],
  pdf: ['pdf.validate', 'pdf.merge', 'document.read'],
  research: ['web.search', 'web.extract', 'citation.pack'],
  website: ['web.extract'],
  design: ['web.extract', 'pdf.validate'],
  ops: ['document.write', 'csv.read', 'citation.pack'],
};

export function createEmptyWorkProviderStatusSummary(): WorkProviderStatusSummary {
  return {
    ready: 0,
    missingDependency: 0,
    missingConfig: 0,
    disabled: 0,
    externalUnavailable: 0,
    runtimeUnavailable: 0,
  };
}

export function normalizeWorkProviderConfig(value: unknown): WorkProviderConfig {
  if (!value || typeof value !== 'object') return {};
  const allowed = new Set(WORK_PROVIDER_DEFINITIONS.map((definition) => definition.id));
  const normalized: WorkProviderConfig = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!allowed.has(key as WorkProviderId) || !entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const config = record.config && typeof record.config === 'object'
      ? Object.fromEntries(
        Object.entries(record.config as Record<string, unknown>).filter(([, item]) => (
          item == null
          || typeof item === 'string'
          || typeof item === 'number'
          || typeof item === 'boolean'
        )),
      ) as WorkProviderConfigEntry['config']
      : undefined;
    normalized[key as WorkProviderId] = {
      enabled: typeof record.enabled === 'boolean' ? record.enabled : undefined,
      config,
    };
  }
  return normalized;
}

function providerHasConfig(config: WorkProviderConfigEntry | undefined): boolean {
  return Boolean(config?.config && Object.values(config.config).some((value) => (
    value !== undefined && value !== null && String(value).trim().length > 0
  )));
}

function resolveCapabilityStatus(
  definition: WorkProviderDefinition,
  capability: WorkProviderCapabilityDefinition,
  dependencyAvailability: Record<string, boolean>,
  config: WorkProviderConfigEntry | undefined,
  runtimeAvailable: boolean,
): WorkProviderCapabilityStatus {
  if (config?.enabled === false) {
    return {
      providerId: definition.id,
      kind: definition.kind,
      capability: capability.id,
      status: 'disabled',
      missingDependencyIds: [],
      installMode: definition.installMode,
    };
  }
  if (!runtimeAvailable && definition.installMode === 'externalService') {
    return {
      providerId: definition.id,
      kind: definition.kind,
      capability: capability.id,
      status: 'runtimeUnavailable',
      missingDependencyIds: [],
      installMode: definition.installMode,
    };
  }
  if (capability.requiresConfig && !providerHasConfig(config)) {
    return {
      providerId: definition.id,
      kind: definition.kind,
      capability: capability.id,
      status: 'missingConfig',
      missingDependencyIds: [],
      installMode: definition.installMode,
    };
  }

  const dependencyIds = capability.dependencyIds ?? definition.dependencyIds;
  const missingDependencyIds = dependencyIds.filter((dependencyId) => dependencyAvailability[dependencyId] !== true);
  if (missingDependencyIds.length > 0) {
    const status: WorkProviderStatus = definition.installMode === 'externalBinary'
      ? 'externalUnavailable'
      : 'missingDependency';
    return {
      providerId: definition.id,
      kind: definition.kind,
      capability: capability.id,
      status,
      missingDependencyIds,
      installMode: definition.installMode,
    };
  }

  return {
    providerId: definition.id,
    kind: definition.kind,
    capability: capability.id,
    status: 'ready',
    missingDependencyIds: [],
    installMode: definition.installMode,
  };
}

function aggregateProviderStatus(capabilities: WorkProviderCapabilityStatus[], installMode: WorkProviderInstallMode): WorkProviderStatus {
  if (capabilities.some((capability) => capability.status === 'ready')) return 'ready';
  if (capabilities.every((capability) => capability.status === 'disabled')) return 'disabled';
  if (capabilities.some((capability) => capability.status === 'missingConfig')) return 'missingConfig';
  if (capabilities.some((capability) => capability.status === 'runtimeUnavailable')) return 'runtimeUnavailable';
  if (installMode === 'externalBinary') return 'externalUnavailable';
  if (capabilities.some((capability) => capability.status === 'externalUnavailable')) return 'externalUnavailable';
  return 'missingDependency';
}

export function resolveWorkProviders(params?: {
  dependencyAvailability?: Record<string, boolean>;
  config?: WorkProviderConfig | null;
  runtimeAvailable?: boolean;
}): WorkProviderResolved[] {
  const dependencyAvailability = params?.dependencyAvailability ?? {};
  const config = normalizeWorkProviderConfig(params?.config);
  const runtimeAvailable = params?.runtimeAvailable ?? true;

  return WORK_PROVIDER_DEFINITIONS.map((definition) => {
    const entry = config[definition.id];
    const capabilities = definition.capabilities.map((capability) => (
      resolveCapabilityStatus(definition, capability, dependencyAvailability, entry, runtimeAvailable)
    ));
    const missingDependencyIds = Array.from(new Set(capabilities.flatMap((capability) => capability.missingDependencyIds)));
    return {
      id: definition.id,
      kind: definition.kind,
      labelKey: definition.labelKey,
      descriptionKey: definition.descriptionKey,
      installMode: definition.installMode,
      status: aggregateProviderStatus(capabilities, definition.installMode),
      dependencyIds: definition.dependencyIds,
      missingDependencyIds,
      capabilities,
      optional: definition.optional,
    };
  });
}

export function summarizeWorkProviderCapabilities(
  capabilities: Array<Pick<WorkProviderCapabilityStatus, 'status'>>,
): WorkProviderStatusSummary {
  return capabilities.reduce<WorkProviderStatusSummary>((summary, capability) => {
    summary[capability.status] += 1;
    return summary;
  }, createEmptyWorkProviderStatusSummary());
}

export function resolveWorkKitProviderCapabilities(
  kits: WorkModeKit[],
  capabilities: WorkProviderCapabilityStatus[],
): WorkKitProviderCapability[] {
  return kits.flatMap((kit) => {
    const expected = WORK_KIT_PROVIDER_CAPABILITIES[kit] ?? [];
    return expected.flatMap((capability) => {
      const matches = capabilities.filter((entry) => entry.capability === capability);
      if (matches.length === 0) return [];
      return [{
        kit,
        capability,
        providerIds: Array.from(new Set(matches.map((entry) => entry.providerId))),
        statuses: Array.from(new Set(matches.map((entry) => entry.status))),
      }];
    });
  });
}
