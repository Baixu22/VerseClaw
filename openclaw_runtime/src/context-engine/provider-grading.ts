// Authority grading for the rebuild context providers (ALIGNMENT 校正6 + Task I flip).
// Shadow mode claims no authority anywhere; authoritative mode must clear those
// claims on every payload (result/items/diagnostics), not just the manifest —
// downstream shadow consumers key on these flags (e.g. metadata.shadowOnly).
export type ProviderAuthority = "authoritative" | "shadow";

export function gradingMetadata(authoritative: boolean) {
  return {
    shadowOnly: !authoritative,
    legacyAuthoritative: !authoritative,
    noPromptAuthority: !authoritative,
    noToolAuthority: !authoritative,
    noRuntimeAuthority: !authoritative,
  };
}

export type GradingMetadata = ReturnType<typeof gradingMetadata>;
