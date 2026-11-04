/** Registration metadata stays outside prompt content and never grants rights by inference. */
export type PromptContributionAuthority =
  | "append_data"
  | "append_instruction"
  | "replace_system_prompt"
  | "replace_messages";

export type PromptContributionScope =
  | "system_prompt"
  | "message"
  | "message_replacement"
  | "systemPrompt"
  | "prependContext"
  | "appendContext"
  | "prependSystemContext"
  | "appendSystemContext";

export type PromptContributionDeclaration = {
  authority: readonly PromptContributionAuthority[];
  source: string;
  scope: readonly PromptContributionScope[];
  reason: string;
};

export type PromptContributionAdmission = {
  declaration?: PromptContributionDeclaration;
  /** Existing callers retain their behavior; hosts opt into enforcement explicitly. */
  mode?: "warn" | "enforce";
  warn?: (message: string) => void;
};

export class PromptContributionAuthorityError extends Error {
  readonly code = "PROMPT_CONTRIBUTION_AUTHORITY_DENIED";

  constructor(
    readonly source: string,
    readonly scope: PromptContributionScope,
    readonly requiredAuthority: PromptContributionAuthority,
    readonly reason:
      | "undeclared"
      | "invalid-declaration"
      | "source-mismatch"
      | "scope-mismatch"
      | "authority-mismatch",
  ) {
    super(
      `Prompt contribution authority violation: source=${source} scope=${scope} requires=${requiredAuthority} reason=${reason}`,
    );
    this.name = "PromptContributionAuthorityError";
  }
}

export function admitPromptContribution(
  source: string,
  scope: PromptContributionScope,
  requiredAuthority: PromptContributionAuthority,
  admission: PromptContributionAdmission = {},
): "declared" | "default-data" | "warned" {
  const declaration = admission.declaration;
  if (!declaration && requiredAuthority === "append_data") return "default-data";
  let reason: PromptContributionAuthorityError["reason"] | undefined;
  if (!declaration) reason = "undeclared";
  else if (
    !Array.isArray(declaration.authority) ||
    !Array.isArray(declaration.scope) ||
    typeof declaration.source !== "string" ||
    !declaration.source.trim() ||
    typeof declaration.reason !== "string" ||
    !declaration.reason.trim()
  )
    reason = "invalid-declaration";
  else if (declaration.source !== source) reason = "source-mismatch";
  else if (!declaration.scope.includes(scope)) reason = "scope-mismatch";
  else if (!declaration.authority.includes(requiredAuthority)) reason = "authority-mismatch";
  if (!reason) return "declared";
  const error = new PromptContributionAuthorityError(source, scope, requiredAuthority, reason);
  if (admission.mode === "enforce") throw error;
  if (admission.warn) admission.warn(error.message);
  else process.emitWarning(error.message, { code: error.code });
  return "warned";
}
