// Plans usable tools from descriptors, availability, and request constraints.
//
// API-only module (per TF-0115 / M2 closeout, 2026-09-07): `buildToolPlan` is
// exported as a *plugin SDK / library surface* (`packages/plugin-sdk`), not as a
// runtime entry under the §D1 five production roots. §D1.2 per-symbol scan reports
// exit 1 (no production call sites); TF-0102 SDK-boundary ruling keeps it out of
// the runtime dead-code enumeration. Do not migrate to experiments/ — the SDK
// surface consumers (plugins) are the documented callers, not the runtime boot.
import { evaluateToolAvailability } from "./availability.js";
import { ToolPlanContractError } from "./diagnostics.js";
import type {
  BuildToolPlanOptions,
  HiddenToolPlanEntry,
  ToolDescriptor,
  ToolPlan,
  ToolPlanEntry,
} from "./types.js";

/**
 * Deterministic planner for descriptor-backed tools.
 *
 * The planner sorts descriptors, hides unavailable tools with diagnostics, and
 * throws only when visible tool descriptors violate executor/name contracts.
 */
function compareDescriptors(left: ToolDescriptor, right: ToolDescriptor): number {
  return (
    (left.sortKey ?? left.name).localeCompare(right.sortKey ?? right.name) ||
    left.name.localeCompare(right.name)
  );
}

function assertUniqueNames(descriptors: readonly ToolDescriptor[]): void {
  const seen = new Set<string>();
  for (const descriptor of descriptors) {
    if (seen.has(descriptor.name)) {
      throw new ToolPlanContractError({
        code: "duplicate-tool-name",
        toolName: descriptor.name,
        message: `Duplicate tool descriptor name: ${descriptor.name}`,
      });
    }
    seen.add(descriptor.name);
  }
}

/** Build the visible and hidden tool plan for a runtime context. */
export function buildToolPlan(options: BuildToolPlanOptions): ToolPlan {
  const descriptors = options.descriptors.toSorted(compareDescriptors);
  assertUniqueNames(descriptors);

  const visible: ToolPlanEntry[] = [];
  const hidden: HiddenToolPlanEntry[] = [];

  for (const descriptor of descriptors) {
    const diagnostics = [
      ...evaluateToolAvailability({ descriptor, context: options.availability }),
    ];
    if (diagnostics.length > 0) {
      hidden.push({ descriptor, diagnostics });
      continue;
    }
    if (!descriptor.executor) {
      // Hidden tools may omit executors; visible tools must be callable after planning.
      throw new ToolPlanContractError({
        code: "missing-executor",
        toolName: descriptor.name,
        message: `Visible tool descriptor has no executor ref: ${descriptor.name}`,
      });
    }
    visible.push({ descriptor, executor: descriptor.executor });
  }

  return { visible, hidden };
}
