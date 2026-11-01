/**
 * Maps existing owner outputs into start-of-session plan facts.
 *
 * This is the seam A2b will consume. It performs no I/O of its own: every value
 * comes from an owner that already produced it, so the plan can never invent a
 * source, a character count, or an availability claim.
 */
import type { LongSessionContinuityContextPack } from "../../../shared/long-session-continuity.js";
import type {
  SessionStartSourceFact,
  SessionStartSourceId,
} from "../../../shared/types/session-start-injection.js";

export type SessionStartFactInputs = {
  /** Result of `shouldApplyStartupContext` plus the prelude the owner rendered. */
  startupMemory?: { applies: boolean; chars?: number; detail?: string } | null;
  /** The continuity pack an owner already built, when one exists. */
  continuityPack?: LongSessionContinuityContextPack | null;
  /** A handoff draft the user already previewed, when one exists. */
  handoffDraft?: { chars?: number; detail?: string } | null;
  /** True when the fork parent transcript was inherited for this child. */
  forkInheritance?: { inherited: boolean; chars?: number; detail?: string } | null;
};

/**
 * Characters the pack actually carries.
 *
 * `budget.usedChars` is the owner's own accounting; summing `items[].chars`
 * can drift from it when the pack truncated. Prefer the owner's number and only
 * fall back to the sum when the owner did not report one.
 */
function packChars(pack: LongSessionContinuityContextPack): number {
  const used = pack.budget?.usedChars;
  if (typeof used === 'number' && Number.isFinite(used) && used >= 0) return Math.floor(used);
  const items = Array.isArray(pack.items) ? pack.items : [];
  return items.reduce((total, item) => total + (typeof item.chars === 'number' ? item.chars : 0), 0);
}

/**
 * Convert owner outputs into plan facts.
 *
 * A source with no owner output is reported as unavailable, not as empty: "the
 * owner said it has nothing" and "nobody asked the owner" are different facts.
 */
export function collectSessionStartFacts(inputs: SessionStartFactInputs): SessionStartSourceFact[] {
  const facts: SessionStartSourceFact[] = [];

  const startup = inputs.startupMemory ?? null;
  facts.push({
    sourceId: 'startup-memory',
    available: startup?.applies === true,
    chars: typeof startup?.chars === 'number' ? startup.chars : 0,
    ...(startup?.detail ? { detail: startup.detail } : {}),
  });

  const pack = inputs.continuityPack ?? null;
  const packItemCount = pack && Array.isArray(pack.items) ? pack.items.length : 0;
  facts.push({
    sourceId: 'continuity-pack',
    available: packItemCount > 0,
    chars: pack ? packChars(pack) : 0,
    ...(pack && pack.status && pack.status !== 'known' ? { detail: `continuity pack status: ${pack.status}` } : {}),
  });

  const handoff = inputs.handoffDraft ?? null;
  facts.push({
    sourceId: 'handoff-draft',
    available: Boolean(handoff),
    chars: typeof handoff?.chars === 'number' ? handoff.chars : 0,
    ...(handoff?.detail ? { detail: handoff.detail } : {}),
  });

  const fork = inputs.forkInheritance ?? null;
  facts.push({
    sourceId: 'fork-inheritance',
    available: fork?.inherited === true,
    chars: typeof fork?.chars === 'number' ? fork.chars : 0,
    ...(fork?.detail ? { detail: fork.detail } : {}),
  });

  return facts;
}

/** The declared fact ids, so a consumer can assert it covered every source. */
export const SESSION_START_FACT_SOURCE_IDS: readonly SessionStartSourceId[] = [
  'startup-memory',
  'continuity-pack',
  'handoff-draft',
  'fork-inheritance',
];
