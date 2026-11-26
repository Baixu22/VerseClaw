"""Screen digest-bound supplemental components without executing references."""
import argparse
import ast
from collections import Counter
import json
from pathlib import Path
import runpy

ROOT = Path(__file__).resolve().parents[1]
M = runpy.run_path(str(ROOT / 'scripts/rsi-openr1-intake.py'))


def screen_record(row):
    pairs = row['tests']
    complete = isinstance(pairs, list) and all(isinstance(pair, list) and len(pair) == 2 for pair in pairs)
    vectors = [{'input': pair[0], 'output': pair[1]} for pair in pairs] if complete else []
    issue = M['vector_issue'](vectors) if complete else 'malformed-official-vector'
    reference = row['reference']
    reference_issue = None
    if not isinstance(reference, str) or not reference.strip() or len(reference.encode('utf-8')) > 2_000_000:
        reference_issue = 'unsupported-reference-source'
    else:
        try:
            ast.parse(reference)
        except (SyntaxError, ValueError):
            reference_issue = 'python-reference-syntax'
    return {'id': row['id'], 'origin': row['origin'], 'promptDigest': M['prompt_key'](row['prompt'])[2:],
            'referenceSha256': M['digest'](reference) if isinstance(reference, str) else None,
            'referenceIssue': reference_issue, 'vectorIssue': issue, 'vectors': len(vectors),
            'distinctInputs': len({pair['input'] for pair in vectors}) if
            all(isinstance(pair['input'], str) for pair in vectors) else None,
            'testsSha256': M['digest'](M['compact'](pairs)),
            'serializedRecordSha256': M['digest'](M['compact'](row))}


def inspect(component_path, component_sha, supplemental_path, output):
    M['require'](not output.exists(), 'new output directory required')
    components = list(M['checked_rows'](component_path, component_sha))
    selected, component_ids = set(), set()
    for component in components:
        keys, ids = component['identityKeys'], component['supplementalIds']
        expected = sorted(key.removeprefix('supplemental:') for key in keys if key.startswith('supplemental:'))
        M['require'](component['tier'] in ('supplementalNamed', 'supplementalHeld') and keys == sorted(set(keys)) and
                     component['componentSha256'] == M['digest'](M['compact'](keys)) and ids == expected and ids and
                     not (selected & set(ids)) and component['componentSha256'] not in component_ids,
                     'supplemental component identity drift')
        selected.update(ids)
        component_ids.add(component['componentSha256'])
    screened, source_rows = {}, 0
    for row in M['checked_rows'](supplemental_path, M['SUPPLEMENTAL_SHA']):
        source_rows += 1
        if row['id'] in selected:
            M['require'](row['id'] not in screened, 'duplicate supplemental source row')
            screened[row['id']] = screen_record(row)
    M['require'](source_rows == 7776 and screened.keys() == selected, 'supplemental component source coverage drift')
    results, held_issues, held_origins, tiers = [], Counter(), Counter(), Counter()
    for component in components:
        records = [screened[rid] for rid in component['supplementalIds']]
        issues = sorted({row['vectorIssue'] or row['referenceIssue'] or 'string-contract-screened' for row in records})
        results.append({**component, 'records': records, 'issues': issues})
        tiers[component['tier']] += 1
        if component['tier'] == 'supplementalHeld':
            held_issues['+'.join(issues)] += 1
            held_origins['+'.join(sorted({row['origin']['source'] for row in records}))] += 1
    output.mkdir(parents=True)
    path = output / 'component-screening.jsonl'
    with path.open('x', encoding='utf-8', newline='\n') as target:
        for row in sorted(results, key=lambda row: (row['tier'], row['componentSha256'])):
            target.write(M['compact'](row) + '\n')
    report = {'schemaVersion': 'RsiSupplementalComponentReview/v1', 'driven_by': 'agent',
              'actor': 'codex/rsi-supplemental-review', 'realHumanEvidence': False, 'modelRequests': 0,
              'sourceFilesSha256': {name: M['file_digest'](ROOT / name) for name in
                                    ('scripts/rsi-supplemental-review.py', 'scripts/rsi-openr1-intake.py')},
              'sourceRows': source_rows, 'selectedRows': len(screened), 'components': dict(tiers),
              'heldIssues': dict(held_issues), 'heldOrigins': dict(held_origins),
              'sourceComponentIndexSha256': component_sha, 'supplementalSha256': M['SUPPLEMENTAL_SHA'],
              'screeningIndexSha256': M['file_digest'](path), 'formalAdmission': False,
              'runnerCalibration': False, 'benefit': 'NO_GO', 'adoption': 'hold'}
    M['write_report'](output / 'review.json', report)
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--components', type=Path, required=True)
    parser.add_argument('--components-sha256', required=True)
    parser.add_argument('--supplemental', type=Path, required=True)
    parser.add_argument('--output-directory', type=Path, required=True)
    args = parser.parse_args()
    inspect(args.components, args.components_sha256, args.supplemental, args.output_directory)
