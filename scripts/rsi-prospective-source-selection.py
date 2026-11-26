"""Freeze whole-family source alternatives and calibration order from pinned indices."""
import argparse
from collections import Counter
import gzip
import hashlib
import json
from pathlib import Path
import runpy
import subprocess

ROOT = Path(__file__).resolve().parents[1]
M = runpy.run_path(str(ROOT / 'scripts/rsi-openr1-intake.py'))
S = runpy.run_path(str(ROOT / 'scripts/rsi-supplemental-review.py'))
SOURCE_FILES = ('scripts/rsi-prospective-source-selection.py', 'scripts/rsi-openr1-intake.py',
                'scripts/rsi-supplemental-review.py')


def checked_index(path, expected):
    digest, rows = hashlib.sha256(), []
    opener = gzip.open if path.suffix == '.gz' else open
    with opener(path, 'rb') as stream:
        for line in stream:
            digest.update(line)
            rows.append(json.loads(line))
    M['require'](digest.hexdigest() == expected, 'source-selection index digest mismatch: ' + path.name)
    return rows


def rank(seed, kind, value):
    return M['digest'](seed + '\0' + kind + '\0' + value)


def build_source_queue(components, groups, review, supplemental, seed):
    M['require'](isinstance(seed, str) and seed.strip(), 'source-selection seed required')
    M['require'](review.get('knownReferenceShapeCoverageComplete') is True,
                 'source-selection complete known-shape review required')
    screened = set(review['screenedTiers'])
    M['require']('base' in screened and 'libraryChecker' in screened and
                 not (screened & {'supplementalNamed', 'supplementalHeld', 'legacyBaseHeld', 'libraryCheckerHeld'}),
                 'source-selection screened tiers drift')
    by_id, identities = {}, set()
    for component in components:
        keys, identity = component['identityKeys'], component['componentSha256']
        M['require'](keys and keys == sorted(set(keys)) and identity == M['digest'](M['compact'](keys)) and
                     identity not in by_id and not (identities & set(keys)), 'source-selection component membership drift')
        identities.update(keys)
        by_id[identity] = component
        for choice in component['candidateRecords']:
            M['require'](choice['identityKey'] in keys, 'source-selection foreign source')
    covered, shapes, counts, queue = set(), set(), Counter(), []
    for group in groups:
        ids, known = group['componentIds'], group['knownReferenceShapes']
        M['require'](ids and ids == sorted(set(ids)) and set(ids) <= by_id.keys() and not (covered & set(ids)),
                     'source-selection shape partition drift')
        M['require'](known == sorted(set(known)) and not (shapes & set(known)) and
                     type(group['excludedByHistoricalShape']) is bool and
                     type(group['unreviewedSourceCount']) is int and group['unreviewedSourceCount'] == 0,
                     'source-selection shape exclusion or coverage drift')
        covered.update(ids)
        shapes.update(known)
        members = [by_id[identity] for identity in ids]
        tiers = {member['tier'] for member in members}
        M['require'](group['tiers'] == sorted(tiers), 'source-selection group tier drift')
        excluded = group['excludedByHistoricalShape']
        credit = 'screened' if tiers & screened else 'named' if 'supplementalNamed' in tiers else 'held'
        sources = {}
        for member in members:
            for choice in member['candidateRecords']:
                tier, identity, record = choice['tier'], choice['identityKey'], choice['record']
                key = tier + ':' + identity
                eligible, issue, binding = False, 'held-source-contract', None
                if tier in ('supplementalNamed', 'supplementalHeld'):
                    M['require'](identity in supplemental, 'source-selection supplemental record missing')
                    binding = supplemental[identity]
                    issue = binding['vectorIssue'] or binding['referenceIssue']
                    eligible = tier == 'supplementalNamed' and issue is None
                elif record is not None:
                    binding = record
                    eligible = tier in (screened - {'base'}) or tier == 'alternateReference'
                    issue = None if eligible else 'held-source-contract'
                elif tier in ('base', 'legacyBaseHeld'):
                    issue = 'identity-only-base'
                if key in sources:
                    previous = sources[key]['sourceBinding']
                    M['require'](isinstance(previous, dict) and isinstance(binding, dict) and
                                 all(M['compact'](previous[field]) == M['compact'](binding[field])
                                     for field in previous.keys() & binding.keys()),
                                 'source-selection conflicting source projections')
                    previous.update(binding)
                    sources[key]['sourceProjections'].append(binding)
                else:
                    sources[key] = {'sourceKey': key, 'componentSha256': member['componentSha256'],
                                    'tier': tier, 'identityKey': identity, 'eligibleForCalibration': eligible,
                                    'screeningIssue': issue, 'sourceBinding': dict(binding) if binding is not None else None,
                                    'sourceProjections': [binding]}
        alternatives = list(sources.values())
        for item in alternatives:
            item['sourceProjections'].sort(key=lambda projection: M['digest'](M['compact'](projection)))
            item['sourceBindingSha256'] = M['digest'](M['compact']({
                'record': item['sourceBinding'], 'projections': item['sourceProjections']}))
        alternatives.sort(key=lambda item: (not item['eligibleForCalibration'],
                                           item['tier'] not in screened,
                                           rank(seed, 'source', item['sourceKey']), item['sourceKey']))
        if credit == 'screened':
            M['require'](any(item['eligibleForCalibration'] and item['tier'] in screened for item in alternatives),
                         'source-selection screened family lacks current screened source')
        group_digest = M['digest'](M['compact'](group))
        initial = next((item['sourceKey'] for item in alternatives if item['eligibleForCalibration']), None)
        queue.append({'familyId': 'prospective-' + group_digest[:24], 'groupSha256': group_digest,
                      'componentIds': ids, 'identityKeys': sorted({key for member in members for key in member['identityKeys']}),
                      'knownReferenceShapes': known, 'excludedByHistoricalShape': excluded,
                      'tierCredit': credit, 'status': 'excluded' if excluded else 'held' if credit == 'held' else 'planned',
                      'initialSourceKey': initial if not excluded and credit != 'held' else None,
                      'alternatives': alternatives})
        counts['componentsAfterKnownShapeBridges'] += 1
        counts['historicalShapeComponents'] += excluded
        if not excluded:
            counts['allListedUpperBound'] += 1
            counts['screenedUpperBound'] += credit == 'screened'
            counts['namedUpperBound'] += credit in ('screened', 'named')
            counts['initiallyCalibratableGroups'] += credit != 'held' and initial is not None
    M['require'](covered == by_id.keys(), 'source-selection omitted components')
    counts['sourceComponents'], counts['unreviewedSources'] = len(components), 0
    for key, value in review['counts'].items():
        M['require'](type(value) is int and counts[key] == value, 'source-selection census count drift: ' + key)
    queue.sort(key=lambda item: (rank(seed, 'family', item['groupSha256']), item['groupSha256']))
    return queue, dict(counts)


def prepare(components_path, shapes_path, review_path, review_sha, supplemental_path, seed, output, verify=False):
    git = lambda *args: subprocess.check_output(['git', *args], cwd=ROOT, encoding='utf-8').strip()
    M['require'](not git('status', '--porcelain'), 'source-selection clean executor required')
    commit, tree = git('rev-parse', 'HEAD'), git('rev-parse', 'HEAD^{tree}')
    bindings = {name: M['file_digest'](ROOT / name) for name in SOURCE_FILES}
    inputs = {name: {'path': str(path.resolve()), 'sha256': M['file_digest'](path)} for name, path in
              [('components', components_path), ('shapes', shapes_path), ('review', review_path),
               ('supplemental', supplemental_path)]}
    review = M['checked_json'](review_path, review_sha)
    components = checked_index(components_path, review['candidateComponentsSha256'])
    groups = checked_index(shapes_path, review['indexSha256'])
    selected = {choice['identityKey'] for component in components for choice in component['candidateRecords']
                if choice['tier'] in ('supplementalNamed', 'supplementalHeld')}
    supplemental, seen = {}, set()
    for row in M['checked_rows'](supplemental_path, M['SUPPLEMENTAL_SHA']):
        M['require'](row['id'] not in seen, 'source-selection duplicate supplemental row')
        seen.add(row['id'])
        key = 'supplemental:' + row['id']
        if key in selected:
            supplemental[key] = S['screen_record'](row)
    M['require'](len(seen) == 7776 and supplemental.keys() == selected, 'source-selection supplemental coverage drift')
    queue, counts = build_source_queue(components, groups, review, supplemental, seed)
    M['require'](not git('status', '--porcelain') and git('rev-parse', 'HEAD') == commit and
                 git('rev-parse', 'HEAD^{tree}') == tree and
                 all(M['file_digest'](ROOT / name) == expected for name, expected in bindings.items()) and
                 all(M['file_digest'](Path(item['path'])) == item['sha256'] for item in inputs.values()),
                 'source-selection source changed during freeze')
    selection = {'schemaVersion': 'RsiProspectiveSourceSelection/v1', 'driven_by': 'agent',
                 'actor': 'codex/rsi-prospective-source-selection', 'realHumanEvidence': False,
                 'modelRequests': 0, 'formalAdmission': False, 'runnerCalibration': False,
                 'benefit': 'NO_GO', 'adoption': 'hold', 'sourceCommit': commit,
                 'sourceTree': tree, 'sourceFilesSha256': bindings,
                 'seed': seed, 'counts': counts, 'requiredPerSplit': 3132, 'requiredTotal': 6264,
                 'supplementalRows': len(seen), 'boundSupplementalRows': len(supplemental),
                 'inputs': inputs,
                 'calibrationRule': 'Follow frozen family/source order. Backfill only from unstarted alternatives after assertion rejection. Infrastructure stops dispatch. Never repeat a started source identity.',
                 'splitRule': 'Assign final splits only after native calibration and whole-family exclusions; take the first 6264 qualifying families in frozen order.'}
    index = output / 'source-queue.jsonl.gz'
    digest = hashlib.sha256()
    if verify:
        M['require'](output.is_dir(), 'source-selection output missing')
        actual = checked_index(index, json.loads((output / 'selection.json').read_bytes())['indexSha256'])
        M['require'](actual == queue, 'source-selection frozen queue drift')
        for row in queue:
            digest.update((M['compact'](row) + '\n').encode('utf-8'))
    else:
        M['require'](not output.exists(), 'source-selection new output required')
        output.mkdir(parents=True)
        with index.open('xb') as raw, gzip.GzipFile(filename='', mode='wb', fileobj=raw, mtime=0) as target:
            for row in queue:
                line = (M['compact'](row) + '\n').encode('utf-8')
                digest.update(line)
                target.write(line)
    selection.update(indexSha256=digest.hexdigest(), compressedIndexSha256=M['file_digest'](index))
    if verify:
        M['require'](json.loads((output / 'selection.json').read_bytes()) == selection, 'source-selection frozen binding drift')
    else:
        M['write_report'](output / 'selection.json', selection)
    return selection


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('components', 'shapes', 'review', 'supplemental', 'output-directory'):
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--review-sha256', required=True)
    parser.add_argument('--seed', required=True)
    parser.add_argument('--verify', action='store_true')
    args = parser.parse_args()
    print(json.dumps(prepare(args.components, args.shapes, args.review, args.review_sha256,
                             args.supplemental, args.seed, args.output_directory, args.verify), indent=2))
