import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  discoverPhaseDirs,
  readPhaseTopology,
  renderIndexTable,
  validatePhaseTopology,
} from '../../scripts/lib/system-maturity-phases.mjs';

const temporaryRoots: string[] = [];

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'clawx-maturity-phases-'));
  temporaryRoots.push(root);
  return root;
}

function writeTopology(root: string, topology: unknown) {
  const directory = join(root, 'plans', 'system-maturity');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'phases.json'), `${JSON.stringify(topology, null, 2)}\n`);
  return directory;
}

function validTopology() {
  return {
    schemaVersion: 1,
    program: 'clawx-system-maturity',
    phases: [
      {
        order: 1,
        id: 'phase0-foundation',
        tierFrom: 'M0',
        tierTo: 'M1',
        owner: 'program-governance',
        findings: 'F-GOV-001',
        dependencies: [],
        title: 'Foundation',
      },
      {
        order: 2,
        id: 'phase1-boundaries',
        tierFrom: 'M1',
        tierTo: 'M2',
        owner: 'main-boundary',
        findings: 'F-SEC-001',
        dependencies: ['phase0-foundation'],
        title: 'Boundaries',
      },
    ],
  };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('system maturity phase topology', () => {
  it('reads the checked-in topology and keeps it ordered and closed', () => {
    const topology = readPhaseTopology(process.cwd());

    expect(topology.source).toBe('phases.json');
    expect(topology.phases.map((phase: { order: number }) => phase.order))
      .toEqual(topology.phases.map((_: unknown, index: number) => index + 1));
    expect(new Set(topology.phases.map((phase: { id: string }) => phase.id)).size)
      .toBe(topology.phases.length);
    expect(validatePhaseTopology(topology)).toEqual([]);
  });

  it('renders INDEX rows from topology plus status projection', () => {
    const topology = validTopology();
    const table = renderIndexTable(topology, {
      'phase0-foundation': 'done',
      'phase1-boundaries': 'blocked',
    });

    expect(table[0]).toContain('| Phase |');
    expect(table[2]).toContain('| phase0-foundation | M0→M1 | program-governance |');
    expect(table[3]).toContain('| phase1-boundaries | M1→M2 | main-boundary |');
    expect(table[3]).toMatch(/\| blocked \|$/u);
  });

  it('discovers phase directories in numeric order', () => {
    const root = fixtureRoot();
    const directory = join(root, 'plans', 'system-maturity');
    mkdirSync(join(directory, 'phase10-later'), { recursive: true });
    mkdirSync(join(directory, 'phase2-second'), { recursive: true });
    mkdirSync(join(directory, 'not-a-phase'), { recursive: true });

    expect(discoverPhaseDirs(directory)).toEqual(['phase2-second', 'phase10-later']);
  });

  it('fails closed on duplicates, forward dependencies, and unknown dependencies', () => {
    const duplicate = validTopology();
    duplicate.phases[1].id = duplicate.phases[0].id;
    expect(validatePhaseTopology(duplicate).join('\n')).toContain('duplicates');

    const forward = validTopology();
    forward.phases[0].dependencies = ['phase1-boundaries'];
    expect(validatePhaseTopology(forward).join('\n')).toContain('must appear earlier');

    const unknown = validTopology();
    unknown.phases[1].dependencies = ['phase9-missing'];
    expect(validatePhaseTopology(unknown).join('\n')).toContain('unknown phase');
  });

  it('throws a helpful error when phases.json is missing and discovery is disabled', () => {
    const root = fixtureRoot();
    expect(() => readPhaseTopology(root)).toThrow(/missing plans\/system-maturity\/phases\.json/u);
  });

  it('uses discovered directories only when explicitly allowed', () => {
    const root = fixtureRoot();
    const directory = writeTopology(root, validTopology());
    rmSync(join(directory, 'phases.json'));
    mkdirSync(join(directory, 'phase4-discovered'), { recursive: true });

    const topology = readPhaseTopology(root, { allowDiscovery: true });
    expect(topology.source).toBe('discovered');
    expect(topology.phases.map((phase: { id: string }) => phase.id)).toEqual(['phase4-discovered']);
  });

  it('keeps README structure links resolvable', () => {
    const readme = readFileSync('plans/system-maturity/README.md', 'utf8');
    expect(readme).toContain('[STRUCTURE.md](./STRUCTURE.md)');
    expect(readme).toContain('[phases.json](./phases.json)');
    expect(readme).toContain('[INDEX.md](./INDEX.md)');
  });
});
