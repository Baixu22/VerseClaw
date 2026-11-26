"""Prepare and replay isolated Python calibration inputs from reviewed USACO components."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import re
import runpy
import subprocess

ROOT = Path(__file__).resolve().parents[1]
F = runpy.run_path(str(ROOT / 'scripts/rsi-usaco-family-review.py'))
P = runpy.run_path(str(ROOT / 'scripts/rsi-supplemental-measurement.py'))
M, U = F['M'], F['U']
SOURCES = sorted(set((*F['SOURCES'], *P['SOURCE_FILES'], 'scripts/rsi-usaco-measurement.py')))


def selected_sources(review, candidates):
    jobs = []
    for family_order, family in enumerate(review['families']):
        if family['status'] != 'new-component':
            continue
        for source_order, source in enumerate(family['sourceIdentities']):
            if candidates[source]['runtime'] != 'python3' or candidates[source].get('outputComparison') != 'normalized-text':
                continue
            jobs.append({'familyId': family['familyId'], 'sourceKey': source,
                         'caseId': source.replace(':', '-'), 'familyOrder': family_order, 'sourceOrder': source_order})
    return jobs


def pack_case(row, selected, family, python_version, review_sha):
    M['require'](family['status'] == 'new-component' and not family['oldFamilyIds'] and
                 row['runtime'] == 'python3' and row['sourceIdentity'] == selected['sourceKey'] and
                 row['sourceIdentity'] in family['sourceIdentities'], 'new unobserved Python component required')
    M['require'](row.get('outputComparison') == 'normalized-text', 'reviewed normalized-text output required')
    M['require'](all(v.get('visibility') in ('public', 'private') for v in row['vectors']), 'source vector visibility required')
    vectors = [{'kind': 'stdio', **vector} for vector in row['vectors']]
    reference_sha = M['digest'](row['reference'])
    family_id, source_id = family['familyId'], row['sourceIdentity']
    contract = {'prompt': M['SPACE'].sub(' ', row['prompt']).strip(' ').lower(), 'language': 'python3'}
    item = {'id': selected['caseId'], 'name': source_id, 'runtime': 'python3', 'split': 'validation',
            'familyId': family_id, 'independenceGroup': family_id, 'prompt': row['prompt'],
            'reference': row['reference'], 'vectors': vectors,
            'declaration': 'Write a complete Python 3 program that reads standard input and writes the required answer to standard output.\n',
            'privatePython': {'schemaVersion': 'RsiStdioIsolatedPython/v1', 'pythonVersion': python_version,
                              'referenceSha256': reference_sha,
                              'profile': runpy.run_path(str(ROOT / 'scripts/rsi-isolated-python-replay.py'))['PROFILE']},
            'provenance': {'sourceId': source_id, 'sourceKey': source_id, 'sourceIdentities': family['componentKeys'],
                'knownReferenceShapes': family['knownReferenceShapes'], 'sourceFamilyReviewSha256': review_sha,
                'originalSourceRecordSha256': M['digest'](M['compact'](row)), 'purpose': 'execution-contract-calibration',
                'familyReview': {'schemaVersion': 'RsiSemanticFamilyReview/v1', 'driven_by': 'agent',
                    'actor': 'codex/rsi-usaco-measurement', 'realHumanEvidence': False,
                    'sourceId': source_id, 'familyId': family_id, 'runtime': 'python3',
                    'basis': 'Complete frozen source queue, observed history and known reference shapes; semantic review remains pending.',
                    'contractDigest': hashlib.sha256(P['encoded'](contract)).hexdigest(),
                    'referenceDigest': reference_sha, 'privateOracleDigest': hashlib.sha256(P['encoded'](vectors)).hexdigest()}}}
    return {'schemaVersion': 'RsiIndependentCodingCases/v2', 'datasetVersion': 'RsiSemanticIndependentCases/v2',
            'executionKind': 'stdio-program', 'usage': 'scripted-control', 'driven_by': 'agent',
            'actor': 'codex/rsi-usaco-measurement', 'realHumanEvidence': False, 'cases': [item]}


def prepare(family_plan, family_plan_sha, family_directory, output, python_version, verify=False):
    git = lambda *args: subprocess.check_output(['git', *args], cwd=ROOT, encoding='utf-8').strip()
    M['require'](not git('status', '--porcelain'), 'clean measurement executor required')
    M['require'](verify or not output.exists(), 'new measurement output required')
    M['require'](re.fullmatch(r'Python 3\.\d+\.\d+[A-Za-z0-9.+-]*', python_version), 'frozen Python version required')
    review = F['inspect'](family_plan, family_plan_sha, family_directory, verify=True)
    review_path = family_directory / 'family-review.json'
    review_sha = M['file_digest'](review_path)
    manifest = M['checked_json'](family_plan, family_plan_sha)
    candidates = {}
    for source in manifest['candidates']:
        row, _ = U['replay'](Path(source['plan']), source['planSha256'], Path(source['directory']))
        candidates[row['sourceIdentity']] = row
    jobs = selected_sources(review, candidates)
    M['require'](jobs, 'no new Python source eligible for calibration')
    plan = {'schemaVersion': 'RsiUsacoMeasurementPlan/v1', 'driven_by': 'agent', 'actor': 'codex/rsi-usaco-measurement',
        'realHumanEvidence': False, 'modelRequests': 0, 'formalAdmission': False, 'usage': 'scripted-control',
        'sourceCommit': git('rev-parse', 'HEAD'), 'sourceTree': git('rev-parse', 'HEAD^{tree}'),
        'sourceFilesSha256': {name: M['file_digest'](ROOT / name) for name in SOURCES},
        'nodeVersion': subprocess.check_output(['node', '--version'], encoding='utf-8').strip(),
        'minimumSystemAvailableBytes': 4294967296, 'pythonVersion': python_version,
        'calibrationSchemaVersion': 'RsiUsacoCalibrationBatch/v1', 'selectedSources': jobs,
        'sourceFamilyReviewSha256': review_sha, 'sourceFamilyPlanSha256': family_plan_sha,
        'benefit': 'NO_GO', 'adoption': 'hold'}
    if verify:
        M['require'](M['compact'](json.loads((output / 'plan.json').read_bytes())) == M['compact'](plan), 'measurement plan replay drift')
        M['require'](M['file_digest'](output / 'family-review.json') == review_sha, 'measurement family review drift')
    else:
        output.mkdir(parents=True)
        M['write_report'](output / 'plan.json', plan)
        (output / 'family-review.json').write_bytes(review_path.read_bytes())
    entries = []
    for selected in jobs:
        row = candidates[selected['sourceKey']]
        family = review['families'][selected['familyOrder']]
        pack = pack_case(row, selected, family, python_version, review_sha)
        raw = P['encoded'](pack)
        path = output / (selected['caseId'] + '.json.gz')
        if verify:
            M['require'](gzip.decompress(path.read_bytes()) == raw, 'measurement case replay drift')
        else:
            with path.open('xb') as stream:
                stream.write(gzip.compress(raw, mtime=0))
        entries.append({**selected, 'problem': selected['caseId'], 'path': path.name,
                        'sha256': M['file_digest'](path), 'packDigest': hashlib.sha256(raw).hexdigest(),
                        'referenceSha256': M['digest'](row['reference']), 'vectors': len(row['vectors']),
                        'distinctInputs': len({v['input'] for v in row['vectors']})})
    report = {'schemaVersion': 'RsiUsacoMeasurementInputs/v1', 'driven_by': 'agent', 'realHumanEvidence': False,
        'modelRequests': 0, 'executedPrograms': 0, 'formalAdmission': False, 'usage': 'scripted-control',
        'planSha256': M['file_digest'](output / 'plan.json'), 'sourceFamilyReviewSha256': review_sha,
        'preparedFamilies': len({job['familyId'] for job in jobs}), 'preparedSources': len(jobs), 'cases': entries}
    M['require'](not git('status', '--porcelain') and git('rev-parse', 'HEAD') == plan['sourceCommit'] and
                 all(M['file_digest'](ROOT / name) == sha for name, sha in plan['sourceFilesSha256'].items()),
                 'measurement executor changed during preparation')
    if verify:
        M['require'](M['compact'](json.loads((output / 'report.json').read_bytes())) == M['compact'](report), 'measurement report replay drift')
    else:
        M['write_report'](output / 'report.json', report)
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--family-plan', type=Path, required=True)
    parser.add_argument('--family-plan-sha256', required=True)
    parser.add_argument('--family-directory', type=Path, required=True)
    parser.add_argument('--output-directory', type=Path, required=True)
    parser.add_argument('--python-version', required=True)
    parser.add_argument('--verify', action='store_true')
    args = parser.parse_args()
    report = prepare(args.family_plan, args.family_plan_sha256, args.family_directory,
                     args.output_directory, args.python_version, args.verify)
    print(json.dumps({key: value for key, value in report.items() if key != 'cases'}))
