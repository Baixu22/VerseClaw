export function verifyManifest(root: string, manifestPath: string): { manifest: string; checked: number; matched: number; annotatedDrift: string[]; missing: string[]; drifted: string[]; malformed: string[] };
export function verifyAllManifests(root?: string): Array<ReturnType<typeof verifyManifest>>;
