/**
 * In-memory coding scorecard counters (decision plan §5 "read" axis stubs).
 * Process-local, same pattern as dcs-observability — not a dashboard product surface.
 */
export type CodingObservabilitySnapshot = {
  factToolCalls: number;
  factToolCallsByName: Record<string, number>;
  factStoreHits: number;
  factStoreMisses: number;
  schemaToolCount: number;
  schemaChars: number;
};

const ZERO: CodingObservabilitySnapshot = {
  factToolCalls: 0,
  factToolCallsByName: {},
  factStoreHits: 0,
  factStoreMisses: 0,
  schemaToolCount: 0,
  schemaChars: 0,
};

class CodingObservabilityRegistry {
  #counters: CodingObservabilitySnapshot = {
    ...ZERO,
    factToolCallsByName: {},
  };

  recordFactToolCall(toolName: string): void {
    this.#counters.factToolCalls += 1;
    const key = toolName.trim() || "unknown";
    this.#counters.factToolCallsByName[key] = (this.#counters.factToolCallsByName[key] ?? 0) + 1;
  }

  recordFactStoreHit(hit: boolean): void {
    if (hit) {
      this.#counters.factStoreHits += 1;
    } else {
      this.#counters.factStoreMisses += 1;
    }
  }

  /**
   * W0-4 / addendum 6: record injected tool schema character occupancy.
   * Callers supply toolCount + serialized schema chars for the active catalog.
   */
  recordSchemaOccupancy(toolCount: number, schemaChars: number): void {
    this.#counters.schemaToolCount = Math.max(0, toolCount);
    this.#counters.schemaChars = Math.max(0, schemaChars);
  }

  snapshot(): CodingObservabilitySnapshot {
    return {
      ...this.#counters,
      factToolCallsByName: { ...this.#counters.factToolCallsByName },
    };
  }

  reset(): void {
    this.#counters = {
      ...ZERO,
      factToolCallsByName: {},
    };
  }
}

export const codingObservability = new CodingObservabilityRegistry();