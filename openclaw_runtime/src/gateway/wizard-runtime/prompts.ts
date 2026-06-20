// P5-2 CLI/TUI Deletion: wizard prompt type stub.
//
// The original `wizard/prompts.ts` was retired along with the `wizard/`
// directory. This stub preserves the public type so plugin and flow
// code that previously consumed the wizard's prompt abstraction still
// type-checks. The shape mirrors the fields exercised across the
// plugin/flow/test-utils surface. All params objects are intentionally
// open (allow extra fields) so per-call options like `sensitive`,
// `searchable`, `initialValue`, `validValues`, etc. continue to
// type-check at the call site even though the stub does not interpret
// them.

export type WizardSelectOption<T> = {
  value: T;
  label?: string;
  hint?: string;
};

export type WizardPrompterTextParams = {
  message: string;
  placeholder?: string;
  validate?: (value: string) => string | undefined;
  defaultValue?: string;
  initialValue?: string;
  sensitive?: boolean;
  validValues?: readonly string[];
  [key: string]: unknown;
};

export type WizardPrompterSelectParams<T> = {
  message: string;
  options: readonly WizardSelectOption<T>[];
  initialValue?: T;
  searchable?: boolean;
  [key: string]: unknown;
};

export type WizardPrompterMultiselectParams<T> = {
  message: string;
  options: readonly WizardSelectOption<T>[];
  required?: boolean;
  initialValue?: readonly T[];
  initialValues?: readonly T[];
  searchable?: boolean;
  [key: string]: unknown;
};

export type WizardPrompterConfirmParams = {
  message: string;
  initialValue?: boolean;
  [key: string]: unknown;
};

export type WizardProgressParams = {
  message: string;
  total?: number;
  completed?: number;
  [key: string]: unknown;
};

export class WizardCancelledError extends Error {
  constructor(message = "Wizard cancelled") {
    super(message);
    this.name = "WizardCancelledError";
  }
}

export type WizardPrompterProgressHandle = {
  update: (message: string) => void;
  stop: (message?: string) => void;
};

// Legacy alias: old code referenced the progress handle as WizardProgress.
export type WizardProgress = WizardPrompterProgressHandle;

// Legacy aliases for consumers that import WizardSelectParams / WizardMultiSelectParams.
export type WizardSelectParams<T = string> = WizardPrompterSelectParams<T>;
export type WizardMultiSelectParams<T = string> = WizardPrompterMultiselectParams<T>;

export type WizardPrompter = {
  intro: (message: string) => Promise<void>;
  outro: (message: string) => Promise<void>;
  note: (message: string, title?: string) => Promise<void>;
  plain: (message: string) => Promise<void>;
  text: (params: WizardPrompterTextParams) => Promise<string>;
  select: <T>(params: WizardPrompterSelectParams<T>) => Promise<T>;
  multiselect: <T>(params: WizardPrompterMultiselectParams<T>) => Promise<T[]>;
  confirm: (params: WizardPrompterConfirmParams) => Promise<boolean>;
  progress: (params: WizardProgressParams) => WizardPrompterProgressHandle;
};
