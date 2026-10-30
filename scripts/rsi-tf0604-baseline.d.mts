export type Tf0604Error = {
  code: string;
  message: string;
  path: string | null;
};

export type Tf0604Validation = {
  passed: boolean;
  errors: Tf0604Error[];
};

export type Tf0604Case = {
  id: string;
  taskId: string;
  sourceDigest: string;
  taskDefinition: {
    input: { taskId: string };
    referenceOutcome: { decision: string };
  };
};

export type Tf0604Corpus = {
  cases: Tf0604Case[];
  driven_by: string;
  provenance: {
    realHuman: boolean;
    realProvider: boolean;
  };
};

export type Tf0604RawTrial = {
  status: string;
  trials: unknown[];
};

export type Tf0604RawTrials = {
  cases: Tf0604RawTrial[];
};

export type Tf0604Aggregate = {
  status: string;
  completeCaseCount: number;
  passK: number | null;
  passAtK: number | null;
};

export type Tf0604Controls = {
  controls: Array<{ id: string; mutation: string; expected: string; expectedCode: string }>;
};

export type Tf0604ControlResult = {
  id: string;
  mutation: string;
  expectedCode: string;
  observedCode: string;
  passed: boolean;
};

export type Tf0604PackResult = {
  passed: boolean;
  errors: Tf0604Error[];
  corpusCaseCount: number;
  baselineStatus: string;
  negativeControlCount: number;
};

export function buildTf0604Corpus(): Tf0604Corpus;
export function buildNegativeControls(): Tf0604Controls;
export function buildRawTrials(corpus: Tf0604Corpus): Tf0604RawTrials;
export function buildAggregate(corpus: Tf0604Corpus, rawTrials: Tf0604RawTrials): Tf0604Aggregate;
export function runNegativeControls(
  corpus: Tf0604Corpus,
  aggregate: Tf0604Aggregate,
  controls: Tf0604Controls,
  root?: string,
): Tf0604ControlResult[];
export function validateCorpus(corpus: Tf0604Corpus, root?: string): Tf0604Validation;
export function validateRawTrials(rawTrials: Tf0604RawTrials, corpus: Tf0604Corpus): Tf0604Validation;
export function validateAggregate(
  aggregate: Tf0604Aggregate,
  corpus: Tf0604Corpus,
  rawTrials?: Tf0604RawTrials,
): Tf0604Validation;
export function validateTf0604Pack(root?: string): Tf0604PackResult;
export function sha256File(path: string): string;
export const TF0604_PACK_DIR: string;
export const TF0604_GENERATED_AT: string;
export const TF0604_FAILURE_CLASSES: string[];
export const TF0604_MIN_CASES: number;
export const TF0604_K: number;
