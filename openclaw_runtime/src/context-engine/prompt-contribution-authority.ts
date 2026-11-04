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

/**
 * TF-0737: host mode selector. The existing default stays warn;
 * `OPENCLAW_PROMPT_AUTHORITY_MODE=enforce` makes undeclared strong mutations
 * fail closed instead of silently downgrading to append_data.
 */
export function resolvePromptAuthorityMode(value: string | undefined): "warn" | "enforce" {
  const mode = value?.trim().toLowerCase();
  if (mode === undefined || mode === "" || mode === "warn") return "warn";
  if (mode === "enforce") return "enforce";
  throw new Error("Invalid OPENCLAW_PROMPT_AUTHORITY_MODE; expected warn or enforce");
}

/**
 * Core producer grants are fixed by their real projection operations. Never
 * derive a grant from the target being requested: that would authorize escalation.
 */
export const BUILTIN_PROMPT_CONTRIBUTION_DECLARATIONS = [
  {
    source: "compass-ssp",
    authority: ["append_instruction"],
    scope: ["system_prompt"],
    reason: "COMPASS session-state projection",
  },
  {
    source: "compass-retrieval",
    authority: ["append_instruction"],
    scope: ["system_prompt"],
    reason: "COMPASS fact retrieval projection",
  },
  {
    source: "memory-inject-pilot",
    authority: ["append_instruction"],
    scope: ["system_prompt"],
    reason: "Runtime Memory pilot system context",
  },
  {
    source: "vtoken-assembly",
    authority: ["append_instruction"],
    scope: ["system_prompt"],
    reason: "VToken assembly system context",
  },
  {
    source: "session-start:",
    authority: ["append_instruction"],
    scope: ["system_prompt"],
    reason: "Session-start plan system context",
  },
  {
    source: "cvk-context-engine",
    authority: ["append_instruction"],
    scope: ["system_prompt"],
    reason: "Selected ContextEngine system addition",
  },
  {
    source: "cvk-message-replacement",
    authority: ["replace_messages"],
    scope: ["message_replacement"],
    reason: "Selected ContextEngine assembled history projection",
  },
  {
    source: "context-block:",
    authority: ["append_data"],
    scope: ["message"],
    reason: "DCS Assembler context-block data projection",
  },
  {
    source: "dcs-knowledge",
    authority: ["append_data"],
    scope: ["message"],
    reason: "Resolved chat knowledge data projection",
  },
] as const satisfies readonly PromptContributionDeclaration[];

export function getBuiltinPromptContributionDeclaration(
  source: string,
): PromptContributionDeclaration | undefined {
  const declaration = BUILTIN_PROMPT_CONTRIBUTION_DECLARATIONS.find((entry) =>
    entry.source.endsWith(":")
      ? source.startsWith(entry.source) && source.length > entry.source.length
      : source === entry.source ||
        (entry.source === "memory-inject-pilot" && source.startsWith("memory-inject-pilot:")),
  );
  return declaration ? { ...declaration, source } : undefined;
}
