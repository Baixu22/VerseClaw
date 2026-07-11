import type { WorkModeKit } from './work-mode';
export type WorkProviderKind = 'officeDocument' | 'officeSheet' | 'officeSlide' | 'pdf' | 'webSearch' | 'webRead' | 'formatConversion' | 'crawler' | 'ocr' | 'dataFrame';
export type WorkProviderStatus = 'ready' | 'missingDependency' | 'missingConfig' | 'disabled' | 'externalUnavailable' | 'runtimeUnavailable';
export type WorkProviderInstallMode = 'builtIn' | 'optionalNpm' | 'externalBinary' | 'externalService';
export type WorkProviderSourceKind = 'builtInLibrary' | 'optionalPackage' | 'externalBinary' | 'externalService' | 'customHttp' | 'runtimeSkill' | 'mcpServer' | 'openClawPlugin';
export type WorkProviderCapability = 'document.read' | 'document.write' | 'sheet.read' | 'sheet.write' | 'csv.read' | 'slide.write' | 'pdf.validate' | 'pdf.merge' | 'web.search' | 'web.extract' | 'citation.pack' | 'format.convert' | 'crawler.run' | 'ocr.extract' | 'dataframe.analyze';
export type WorkProviderId = 'office-document-js' | 'office-sheet-js' | 'office-slide-js' | 'pdf-js' | 'web-search-configured' | 'web-read-js' | 'libreoffice-external' | 'pandoc-external' | 'crawler-external' | 'ocr-external' | 'dataframe-external';
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
    sourceKinds: WorkProviderSourceKind[];
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
    sourceKinds: WorkProviderSourceKind[];
}
export interface WorkProviderResolved {
    id: WorkProviderId;
    kind: WorkProviderKind;
    labelKey: string;
    descriptionKey: string;
    installMode: WorkProviderInstallMode;
    sourceKinds: WorkProviderSourceKind[];
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
    sourceKinds: WorkProviderSourceKind[];
}
export type WorkProviderStatusSummary = Record<WorkProviderStatus, number>;
export type WorkProviderSourceSummary = Record<WorkProviderSourceKind, number>;
export interface WorkProviderStatusSnapshot {
    success: true;
    providers: WorkProviderResolved[];
    capabilities: WorkProviderCapabilityStatus[];
    kitCapabilities: WorkKitProviderCapability[];
    summary: WorkProviderStatusSummary;
    sourceSummary: WorkProviderSourceSummary;
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
export declare const WORK_PROVIDER_STATUSES: WorkProviderStatus[];
export declare const WORK_PROVIDER_SOURCE_KINDS: WorkProviderSourceKind[];
export declare const WORK_PROVIDER_DEFINITIONS: WorkProviderDefinition[];
export declare const WORK_KIT_PROVIDER_CAPABILITIES: Record<WorkModeKit, WorkProviderCapability[]>;
export declare function createEmptyWorkProviderStatusSummary(): WorkProviderStatusSummary;
export declare function normalizeWorkProviderConfig(value: unknown): WorkProviderConfig;
export declare function resolveWorkProviders(params?: {
    dependencyAvailability?: Record<string, boolean>;
    config?: WorkProviderConfig | null;
    runtimeAvailable?: boolean;
}): WorkProviderResolved[];
export declare function summarizeWorkProviderCapabilities(capabilities: Array<Pick<WorkProviderCapabilityStatus, 'status'>>): WorkProviderStatusSummary;
export declare function createEmptyWorkProviderSourceSummary(): WorkProviderSourceSummary;
export declare function summarizeWorkProviderSources(providers: Array<Pick<WorkProviderResolved, 'sourceKinds'>>): WorkProviderSourceSummary;
export declare function resolveWorkKitProviderCapabilities(kits: WorkModeKit[], capabilities: WorkProviderCapabilityStatus[]): WorkKitProviderCapability[];
