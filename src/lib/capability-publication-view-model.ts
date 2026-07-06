import type {
  CapabilityPublicationDiagnostic,
  CapabilityPublicationEntry,
  CapabilityPublicationKind,
  CapabilityPublicationResult,
  CapabilityPublicationState,
} from '@shared/host-api/contract';

export type CapabilityDraftChange = 'none' | 'add' | 'remove';
export type CapabilityDiagnosticLevel = 'none' | 'info' | 'warning' | 'blocked';
export type CapabilityKindFilter = 'all' | CapabilityPublicationKind;
export type CapabilityStateFilter = 'all' | CapabilityPublicationState;

export type CapabilityPublicationRow = {
  canonicalId: string;
  aliases: string[];
  searchText: string;
  selected: boolean;
  baselineSelected: boolean;
  published: boolean;
  blocked: boolean;
  change: CapabilityDraftChange;
  diagnosticLevel: CapabilityDiagnosticLevel;
  publication: CapabilityPublicationEntry;
};

export type CapabilityPublicationFilters = {
  query?: string;
  kind?: CapabilityKindFilter;
  state?: CapabilityStateFilter;
  onlySelected?: boolean;
  onlyDiagnostics?: boolean;
  onlyChanged?: boolean;
};

export type CapabilityDraftDiff = {
  skillAdds: string[];
  skillRemoves: string[];
  mcpAdds: string[];
  mcpRemoves: string[];
  totalAdds: number;
  totalRemoves: number;
  totalChanges: number;
  changed: boolean;
};

export type CapabilityDiagnosticSummary = {
  info: number;
  warnings: number;
  blocked: number;
  total: number;
};

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const value = raw?.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

export function splitCapabilityIdList(value: string): string[] {
  return uniqueStrings(value.split(/\r?\n|,/));
}

export function capabilityPublicationId(entry: CapabilityPublicationEntry): string {
  return entry.skillId ?? entry.serverId ?? entry.sourceId;
}

export function capabilityPublicationAliases(entry: CapabilityPublicationEntry): string[] {
  return uniqueStrings([
    entry.id,
    entry.sourceId,
    entry.name,
    entry.skillId,
    entry.serverId,
    capabilityPublicationId(entry),
  ]);
}

export function isPublicationSelected(entry: CapabilityPublicationEntry, ids: string[]): boolean {
  const aliases = new Set(capabilityPublicationAliases(entry));
  return ids.some((id) => aliases.has(id));
}

export function addPublicationToIds(ids: string[], entry: CapabilityPublicationEntry): string[] {
  const canonicalId = capabilityPublicationId(entry);
  return ids.includes(canonicalId) ? ids : [...ids, canonicalId];
}

export function removePublicationFromIds(ids: string[], entry: CapabilityPublicationEntry): string[] {
  const aliases = new Set(capabilityPublicationAliases(entry));
  return ids.filter((id) => !aliases.has(id));
}

export function diagnosticLevel(diagnostics: CapabilityPublicationDiagnostic[]): CapabilityDiagnosticLevel {
  if (diagnostics.some((entry) => entry.severity === 'blocked')) return 'blocked';
  if (diagnostics.some((entry) => entry.severity === 'warning')) return 'warning';
  if (diagnostics.length > 0) return 'info';
  return 'none';
}

export function summarizeCapabilityDiagnostics(
  result: CapabilityPublicationResult | null,
): CapabilityDiagnosticSummary {
  const diagnostics = [
    ...(result?.diagnostics ?? []),
    ...(result?.publications ?? []).flatMap((entry) => entry.diagnostics),
  ];
  return {
    info: diagnostics.filter((entry) => entry.severity === 'info').length,
    warnings: diagnostics.filter((entry) => entry.severity === 'warning').length,
    blocked: diagnostics.filter((entry) => entry.severity === 'blocked').length,
    total: diagnostics.length,
  };
}

export function buildCapabilityRows(input: {
  publications: CapabilityPublicationEntry[];
  baselineSkillIds: string[];
  draftSkillIds: string[];
  baselineMcpServerIds: string[];
  draftMcpServerIds: string[];
}): CapabilityPublicationRow[] {
  return input.publications.map((publication) => {
    const baselineIds = publication.kind === 'skill' ? input.baselineSkillIds : input.baselineMcpServerIds;
    const draftIds = publication.kind === 'skill' ? input.draftSkillIds : input.draftMcpServerIds;
    const baselineSelected = isPublicationSelected(publication, baselineIds);
    const selected = isPublicationSelected(publication, draftIds);
    const level = diagnosticLevel(publication.diagnostics);
    const blocked = publication.state === 'blocked' || level === 'blocked';
    const aliases = capabilityPublicationAliases(publication);
    const change: CapabilityDraftChange = baselineSelected === selected
      ? 'none'
      : selected
        ? 'add'
        : 'remove';
    return {
      canonicalId: capabilityPublicationId(publication),
      aliases,
      searchText: [
        publication.name,
        publication.id,
        publication.sourceId,
        publication.skillId,
        publication.serverId,
        publication.kind,
        publication.scope,
        publication.source,
        publication.state,
        ...publication.useModes,
        ...publication.reasons,
        ...publication.diagnostics.map((entry) => `${entry.code} ${entry.message}`),
      ].filter(Boolean).join(' ').toLowerCase(),
      selected,
      baselineSelected,
      published: publication.state === 'published',
      blocked,
      change,
      diagnosticLevel: blocked ? 'blocked' : level,
      publication,
    };
  });
}

export function filterCapabilityRows(
  rows: CapabilityPublicationRow[],
  filters: CapabilityPublicationFilters = {},
): CapabilityPublicationRow[] {
  const query = filters.query?.trim().toLowerCase() ?? '';
  return rows.filter((row) => {
    if (filters.kind && filters.kind !== 'all' && row.publication.kind !== filters.kind) return false;
    if (filters.state && filters.state !== 'all' && row.publication.state !== filters.state) return false;
    if (filters.onlySelected && !row.selected) return false;
    if (filters.onlyDiagnostics && row.diagnosticLevel === 'none') return false;
    if (filters.onlyChanged && row.change === 'none') return false;
    if (query && !row.searchText.includes(query)) return false;
    return true;
  });
}

function rowSortRank(row: CapabilityPublicationRow): number {
  if (row.change === 'add') return 0;
  if (row.change === 'remove') return 1;
  if (row.selected) return 2;
  if (row.published) return 3;
  if (row.blocked) return 5;
  return 4;
}

export function sortCapabilityRows(rows: CapabilityPublicationRow[]): CapabilityPublicationRow[] {
  return [...rows].sort((left, right) => {
    const rank = rowSortRank(left) - rowSortRank(right);
    if (rank !== 0) return rank;
    const kindRank = left.publication.kind.localeCompare(right.publication.kind);
    if (kindRank !== 0) return kindRank;
    return left.publication.name.localeCompare(right.publication.name);
  });
}

function canonicalizeIds(ids: string[], publications: CapabilityPublicationEntry[] = []): string[] {
  const aliasToCanonical = new Map<string, string>();
  for (const publication of publications) {
    const canonicalId = capabilityPublicationId(publication);
    for (const alias of capabilityPublicationAliases(publication)) {
      aliasToCanonical.set(alias, canonicalId);
    }
  }
  return uniqueStrings(ids.map((id) => aliasToCanonical.get(id.trim()) ?? id));
}

function canonicalSet(ids: string[], publications?: CapabilityPublicationEntry[]): Set<string> {
  return new Set(canonicalizeIds(ids, publications));
}

function setDiff(left: string[], right: string[], publications?: CapabilityPublicationEntry[]): string[] {
  const rightSet = canonicalSet(right, publications);
  return canonicalizeIds(left, publications).filter((id) => !rightSet.has(id));
}

export function calculateCapabilityDraftDiff(input: {
  publications?: CapabilityPublicationEntry[];
  baselineSkillIds: string[];
  draftSkillIds: string[];
  baselineMcpServerIds: string[];
  draftMcpServerIds: string[];
}): CapabilityDraftDiff {
  const skillPublications = input.publications?.filter((entry) => entry.kind === 'skill');
  const mcpPublications = input.publications?.filter((entry) => entry.kind === 'mcp');
  const skillAdds = setDiff(input.draftSkillIds, input.baselineSkillIds, skillPublications);
  const skillRemoves = setDiff(input.baselineSkillIds, input.draftSkillIds, skillPublications);
  const mcpAdds = setDiff(input.draftMcpServerIds, input.baselineMcpServerIds, mcpPublications);
  const mcpRemoves = setDiff(input.baselineMcpServerIds, input.draftMcpServerIds, mcpPublications);
  const totalAdds = skillAdds.length + mcpAdds.length;
  const totalRemoves = skillRemoves.length + mcpRemoves.length;
  return {
    skillAdds,
    skillRemoves,
    mcpAdds,
    mcpRemoves,
    totalAdds,
    totalRemoves,
    totalChanges: totalAdds + totalRemoves,
    changed: totalAdds + totalRemoves > 0,
  };
}
