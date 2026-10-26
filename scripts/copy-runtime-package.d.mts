export function copyRuntimeTree(source: string, destination: string): void;
export const packagedMainDependencyBanner: string;
export function copyRuntimeDependencies(source: string, destination: string, installationRoot?: string): number;

export function collectRuntimeDependencyPackages(source: string, installationRoot?: string): Map<string, { name: string; source: string; destination: string }>;
