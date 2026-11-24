/** Bounded metadata from the runtime's persisted prompt report. Counts are characters. */
export interface ContextSourceEntry {
  name: string;
  path?: string;
  chars: number | null;
  rawChars?: number | null;
  status: 'included' | 'truncated' | 'missing';
}

export interface ContextSourceGroup {
  chars: number | null;
  entries: ContextSourceEntry[];
  totalEntries: number;
}

export interface SessionContextComposition {
  sessionId: string;
  generatedAt: number;
  source: 'run' | 'estimate';
  modelRef: string | null;
  systemPromptChars: number | null;
  instructionsChars: number | null;
  currentTurnChars: number | null;
  runtimeContextChars: number | null;
  workspaceFiles: ContextSourceGroup;
  skills: ContextSourceGroup;
  tools: ContextSourceGroup;
}
