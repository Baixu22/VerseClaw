import type {
  BlackboardEntry,
  BlackboardEntryType,
  BlackboardState,
  BlackboardStatus,
  BlackboardTrustBoundary,
} from "./orchestration-blackboard.js";

export type BlackboardVerifierEvidence = {
  id: string;
  type: BlackboardEntryType;
  evidenceRefs: string[];
  confidence: number;
  trustBoundary: BlackboardTrustBoundary;
  status: BlackboardStatus;
  verified: false;
};

function isVisibleToVerifier(entry: BlackboardEntry): boolean {
  return entry.visibility === "verifier" || entry.visibility === "run";
}

function isReadableStatus(entry: BlackboardEntry): boolean {
  return entry.status !== "rejected" && entry.status !== "superseded";
}

export function readBlackboardVerifierEvidence(state: BlackboardState): BlackboardVerifierEvidence[] {
  return state.entries
    .filter((entry) => isVisibleToVerifier(entry) && isReadableStatus(entry))
    .map((entry) => ({
      id: entry.id,
      type: entry.type,
      evidenceRefs: [...entry.evidenceRefs],
      confidence: entry.confidence,
      trustBoundary: entry.trustBoundary,
      status: entry.status,
      verified: false,
    }));
}
