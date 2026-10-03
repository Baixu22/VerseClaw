export const PREREQUISITE_COMMIT: string;
export const PREREQUISITE_DIFF_BASE: string;
export const PREREQUISITE_SPEC_PATH: string;
export const PREREQUISITE_SPEC_BLOB: string;
export const APPROVED_ACCEPTED_BASE: string;
export const INTEGRATED_COMPARISON_BASE: string;
export const FROZEN_ROOT_UNIT_EXPECTED_SKIPS: number;
export const PREREQUISITE_PATHS: readonly string[];

export type Rc01rPrerequisiteReport = {
  ok: boolean;
  errors: string[];
  prerequisite: {
    commit: string;
    diffBase: string;
    specPath: string;
    specBlob: string;
    pathCount: number;
  };
  approvedAcceptedBase: string;
  integratedComparisonBase: string;
  frozenRootUnitExpectedSkips: number;
  identities: {
    prerequisiteIsNotAcceptedBase: boolean;
    comparisonBaseIsNotAcceptedBase: boolean;
    comparisonBaseIsNotPrerequisite: boolean;
  };
};

export function verifyRc01rPrerequisiteProvenance(options?: { root?: string }): Rc01rPrerequisiteReport;
