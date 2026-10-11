export const SCHEMA: string;

export const POLICY_PATHS: {
  securityPolicy: string;
  accelerationPolicy: string;
  accelerationSource: string;
  packageManifest: string;
  findingsRegistry: string;
  securitySuite: string;
};

export const PHANTOM_ACCELERATION_SWITCHES: string[];

export interface PolicyDocInput {
  path: string;
  present: boolean;
  bytes?: number;
  sha256?: string;
}

export interface PolicyDocCheck {
  id: string;
  description: string;
  status: 'pass' | 'fail';
  findings: string[];
}

export interface PolicyDocReport {
  schema: string;
  generatedAt: string;
  drivenBy: string;
  root: string;
  version: string | null;
  inputs: Record<string, PolicyDocInput>;
  checks: PolicyDocCheck[];
  result: 'pass' | 'fail';
}

export function findTemplatePlaceholders(text: string): string[];
export function findSampleVersionRows(text: string): string[];
export function extractRepoReferences(text: string): string[];
export function findMissingReferences(
  text: string,
  options: { root: string; docPath: string },
): string[];
export function findPhantomAccelerationSwitches(sourceText: string): string[];
export function findCredentialShapes(text: string): string[];
export function findMissingAnchors(text: string, anchors: string[]): string[];
export function validatePolicyDocs(options?: { root?: string }): PolicyDocReport;
