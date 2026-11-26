"""Review known implementation shapes in the frozen prospective component index."""
import argparse
from collections import Counter, defaultdict
import gzip
import json
from pathlib import Path
import runpy

ROOT = Path(__file__).resolve().parents[1]
M = runpy.run_path(str(ROOT / 'scripts/rsi-openr1-intake.py'))
SCREENED = {'base', 'openR1', 'codeContestsPassed', 'tacoFunctions', 'tacoTrainStrings',
            'tacoTrainLines', 'tacoTestStrings', 'tacoTestFunctions', 'tacoTestLines'}


def review_components(components, base_families, historical_shapes, reference_shapes=()):
    by_reference, by_identity = {}, {}
    for row in reference_shapes:
        key = (row['runtime'], row['referenceSha256'])
        M['require'](key not in by_reference or by_reference[key] == row['shape'], 'conflicting reference shape')
        by_reference[key] = row['shape']
        if row.get('identityKey'):
            key = row['identityKey']
            M['require'](key not in by_identity or by_identity[key] == row['shape'], 'conflicting source shape')
            by_identity[key] = row['shape']
    base = defaultdict(list)
    for family in base_families:
        base['p:' + family['members'][0]['promptDigest']].extend(family['members'])
    graph, seen, records, historical = M['Families'](), set(), {}, set()
    for component in components:
        identity = component['componentSha256']; keys = component['identityKeys']
        M['require'](identity not in seen and keys == sorted(set(keys)) and
                     identity == M['digest'](M['compact'](keys)), 'candidate membership drift')
        seen.add(identity)
        shapes, unknown = set(), []
        for choice in component['candidateRecords']:
            M['require'](choice['identityKey'] in keys, 'candidate source key outside component')
            row = choice['record']
            if choice['tier'] in ('base', 'legacyBaseHeld'):
                M['require'](choice['identityKey'] in base, 'base candidate source missing')
                shapes.update(member['referenceShape'] for member in base[choice['identityKey']])
            elif row and row.get('referenceShape'):
                shapes.add(row['referenceShape'])
            elif choice['identityKey'] in by_identity:
                shapes.add(by_identity[choice['identityKey']])
            elif row and row.get('reference') and (row['reference']['runtime'], row['reference']['sha256']) in by_reference:
                shapes.add(by_reference[(row['reference']['runtime'], row['reference']['sha256'])])
            else:
                unknown.append({'tier': choice['tier'], 'identityKey': choice['identityKey'],
                                'reference': row.get('reference') if row else None})
        graph.join([identity, *('shape:' + shape for shape in sorted(shapes))])
        if shapes & historical_shapes:
            historical.add(identity)
        records[identity] = {**component, 'knownReferenceShapes': sorted(shapes), 'unreviewedSources': unknown}
    excluded = {graph.root(key) for key in historical}
    groups = defaultdict(list)
    for identity in seen:
        groups[graph.root(identity)].append(identity)
    results, counts = [], Counter()
    for root, ids in groups.items():
        members = [records[identity] for identity in sorted(ids)]
        tiers = {member['tier'] for member in members}
        excluded_group = root in excluded
        counts['componentsAfterKnownShapeBridges'] += 1
        counts['historicalShapeComponents'] += excluded_group
        if not excluded_group:
            counts['allListedUpperBound'] += 1
            counts['screenedUpperBound'] += bool(tiers & SCREENED)
            counts['namedUpperBound'] += bool(tiers & (SCREENED | {'supplementalNamed'}))
        results.append({'componentIds': sorted(ids), 'tiers': sorted(tiers), 'excludedByHistoricalShape': excluded_group,
                        'knownReferenceShapes': sorted({shape for member in members for shape in member['knownReferenceShapes']}),
                        'unreviewedSourceCount': sum(len(member['unreviewedSources']) for member in members)})
    counts['sourceComponents'] = len(components)
    counts['unreviewedSources'] = sum(len(row['unreviewedSources']) for row in records.values())
    return dict(counts), sorted(results, key=lambda row: row['componentIds'])


def inspect(component_path, component_sha, base_path, output, reference_path=None, reference_sha=None):
    M['require'](not output.exists(), 'new shape review output required')
    M['require'](M['file_digest'](base_path) == M['BASE_SHA'], 'base manifest drift')
    components = list(M['checked_rows'](component_path, component_sha))
    M['require']((reference_path is None) == (reference_sha is None), 'reference index needs both path and digest')
    reference_shapes = list(M['checked_rows'](reference_path, reference_sha)) if reference_path is not None else []
    historical = set()
    for name, expected in zip(M['PACKS'], M['PACK_SHAS'], strict=True):
        path = M['FIXTURES'] / name
        M['require'](M['file_digest'](path) == expected, 'historical shape pack drift')
        raw = path.read_bytes()
        pack = json.loads(gzip.decompress(raw) if path.suffix == '.gz' else raw)
        historical.update(row.get('provenance', {}).get('implementationShape') for row in pack['cases'])
    historical.discard(None)
    counts, groups = review_components(components, json.loads(base_path.read_bytes())['families'], historical, reference_shapes)
    output.mkdir(parents=True)
    index = output / 'known-shape-components.jsonl'
    with index.open('x', encoding='utf-8', newline='\n') as target:
        for row in groups:
            target.write(M['compact'](row) + '\n')
    report = {'schemaVersion': 'RsiKnownShapeComponentReview/v1', 'driven_by': 'agent',
              'actor': 'codex/rsi-candidate-shape-review', 'modelRequests': 0,
              'sourceFilesSha256': {name: M['file_digest'](ROOT / name) for name in
                                    ('scripts/rsi-candidate-shape-review.py', 'scripts/rsi-openr1-intake.py')},
              'candidateComponentsSha256': component_sha, 'baseManifestSha256': M['BASE_SHA'],
              'additionalReferenceShapeIndexSha256': reference_sha,
              'counts': counts, 'indexSha256': M['file_digest'](index), 'completeImplementationReview': False,
              'knownReferenceShapeCoverageComplete': counts['unreviewedSources'] == 0,
              'runnerCalibration': False, 'formalAdmission': False, 'benefit': 'NO_GO', 'adoption': 'hold'}
    M['write_report'](output / 'review.json', report)
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--components', type=Path, required=True)
    parser.add_argument('--components-sha256', required=True)
    parser.add_argument('--base-families', type=Path, required=True)
    parser.add_argument('--output-directory', type=Path, required=True)
    parser.add_argument('--reference-index', type=Path)
    parser.add_argument('--reference-index-sha256')
    args = parser.parse_args()
    inspect(args.components, args.components_sha256, args.base_families, args.output_directory,
            args.reference_index, args.reference_index_sha256)
