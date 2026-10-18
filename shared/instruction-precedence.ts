export type InstructionLayerKind = 'agents' | 'project-rules' | 'harness' | 'skill' | 'role' | 'turn-override';
export type InstructionTrust = 'owner' | 'user' | 'runtime' | 'untrusted';

export type InstructionLayerInput = {
  kind: InstructionLayerKind;
  source: string;
  scope: string;
  trust: InstructionTrust;
  content: string;
};

export type InstructionConflict = {
  line: string;
  winner: InstructionLayerKind;
  sources: Array<{ kind: InstructionLayerKind; source: string }>;
};

export type InstructionLayer = InstructionLayerInput & {
  precedence: number;
  tokenEstimate: number;
  conflicts: string[];
};

export type InstructionResolution = {
  layers: InstructionLayer[];
  conflicts: InstructionConflict[];
  totalTokens: number;
  explain: string[];
};

const PRECEDENCE: Record<InstructionLayerKind, number> = {
  'turn-override': 600,
  harness: 500,
  'project-rules': 400,
  agents: 300,
  role: 200,
  skill: 100,
};

function normalizeLine(line: string): string {
  return line.trim().replace(/^[-*]\s+/, '').replace(/\s+/g, ' ');
}

function ruleLikeLines(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map(normalizeLine)
    .filter((line) => line.length >= 12 && !line.startsWith('#') && !line.startsWith('<!--'));
}

export function resolveInstructionPrecedence(inputs: readonly InstructionLayerInput[]): InstructionResolution {
  const layers: InstructionLayer[] = inputs
    .map((input) => ({
      ...input,
      precedence: PRECEDENCE[input.kind],
      tokenEstimate: Math.ceil(input.content.length / 4),
      conflicts: [],
    }))
    .toSorted((left, right) => right.precedence - left.precedence || left.source.localeCompare(right.source));

  const lineSources = new Map<string, Array<{ kind: InstructionLayerKind; source: string }>>();
  for (const layer of layers) {
    for (const line of new Set(ruleLikeLines(layer.content))) {
      const sources = lineSources.get(line) ?? [];
      sources.push({ kind: layer.kind, source: layer.source });
      lineSources.set(line, sources);
    }
  }

  const conflicts: InstructionConflict[] = [];
  for (const [line, sources] of lineSources) {
    const uniqueSources = sources.filter((entry, index, all) =>
      all.findIndex((candidate) => candidate.kind === entry.kind && candidate.source === entry.source) === index);
    if (uniqueSources.length < 2) continue;
    const winner = [...uniqueSources].toSorted((left, right) => PRECEDENCE[right.kind] - PRECEDENCE[left.kind])[0].kind;
    conflicts.push({ line, winner, sources: uniqueSources });
    for (const source of uniqueSources) {
      const layer = layers.find((candidate) => candidate.kind === source.kind && candidate.source === source.source);
      layer?.conflicts.push(line);
    }
  }

  const explain = layers.map((layer) =>
    `${layer.kind} source=${layer.source} scope=${layer.scope} precedence=${layer.precedence} trust=${layer.trust} tokens=${layer.tokenEstimate} conflicts=${layer.conflicts.length}`);
  return {
    layers,
    conflicts,
    totalTokens: layers.reduce((total, layer) => total + layer.tokenEstimate, 0),
    explain,
  };
}
