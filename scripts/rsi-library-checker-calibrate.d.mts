export function assertUnstartedCalibrationPhase(directory: string, phase: string): void;
export function calibrationFile(directory: string, relative: string): string;
export function assertCalibrationPrefix(output: string, problems: string[]): void;
export function calibrationRegistryBinding(directory: string, registry: Record<string, any>, task: Record<string, any>): Promise<Record<string, any>>;
export function calibrationVerdict(phase: string, grade: Record<string, any>): string;
export function loadCalibrationInputs(root: string, inputs: string): Promise<Record<string, any>>;
export function calibrateLibraryChecker(options: { root?: string; inputs: string; output: string; verifyOnly?: boolean }): Promise<Record<string, any>>;
