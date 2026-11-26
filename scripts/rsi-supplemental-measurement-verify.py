"""Replay supplemental pack identities against the original source without running programs."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import re
import runpy
import subprocess

ROOT = Path(__file__).resolve().parents[1]
P = runpy.run_path(str(ROOT / 'scripts/rsi-supplemental-measurement.py'))
M, Q, encoded = P['M'], P['Q'], P['encoded']


def verify_case(row, pack, entry, job, python_version=None):
    M['require'](pack['schemaVersion'] == 'RsiIndependentCodingCases/v2' and
                 pack['datasetVersion'] == 'RsiSemanticIndependentCases/v2' and
                 pack['usage'] == 'scripted-control' and pack['driven_by'] == 'agent' and
                 pack['realHumanEvidence'] is False and len(pack['cases']) == 1, 'supplemental pack protocol drift')
    case = pack['cases'][0]
    keys = {'id', 'name', 'runtime', 'split', 'familyId', 'independenceGroup', 'prompt',
            'declaration', 'reference', 'vectors', 'provenance'}
    M['require'](('privatePython' in case) is (python_version is not None), 'supplemental Python protocol selection drift')
    if python_version is not None:
        keys.add('privatePython')
        profile = runpy.run_path(str(ROOT / 'scripts/rsi-isolated-python-replay.py'))['PROFILE']
        descriptor = case['privatePython']
        M['require'](encoded(descriptor) == encoded({'schemaVersion': 'RsiStdioIsolatedPython/v1',
                     'pythonVersion': python_version, 'referenceSha256': M['digest'](row['reference']), 'profile': profile}),
                     'supplemental isolated Python descriptor drift')
    M['require'](set(case) == keys and
                 case['name'] == row['origin']['upstream_id'] and case['split'] == 'validation' and
                 case['declaration'] == 'Write a complete Python 3 program that reads standard input and writes the required answer to standard output.\n',
                 'supplemental public execution contract drift')
    vectors = [{'kind': 'stdio', 'visibility': 'private', 'input': pair[0], 'output': pair[1],
                'testId': 'original-' + str(index)} for index, pair in enumerate(row['tests'])]
    source, family = job['source'], job['family']
    M['require'](case['id'] == entry['caseId'] == 'supplemental-' + row['id'] and
                 case['runtime'] == 'python3' and case['prompt'] == row['prompt'] and
                 case['reference'] == row['reference'] and encoded(case['vectors']) == encoded(vectors),
                 'supplemental original source or I/O drift')
    provenance, review = case['provenance'], case['provenance']['familyReview']
    M['require'](case['familyId'] == case['independenceGroup'] == entry['familyId'] == family['familyId'] and
                 provenance['componentIds'] == family['componentIds'] and
                 provenance['sourceIdentities'] == family['identityKeys'] and
                 provenance['knownReferenceShapes'] == family['knownReferenceShapes'] and
                 provenance['groupSha256'] == family['groupSha256'] and
                 provenance['sourceKey'] == entry['sourceKey'] == source['sourceKey'] and
                 provenance['sourceBindingSha256'] == source['sourceBindingSha256'], 'supplemental whole-family binding drift')
    original = M['digest'](M['compact'](row))
    M['require'](provenance['originalSourceRecordSha256'] == entry['originalSourceRecordSha256'] == original and
                 provenance['originalTestsSha256'] == M['digest'](M['compact'](row['tests'])) and
                 review['referenceDigest'] == entry['referenceSha256'] == M['digest'](row['reference']) and
                 review['privateOracleDigest'] == hashlib.sha256(encoded(vectors)).hexdigest(), 'supplemental original digest drift')
    M['require'](type(entry['vectors']) is int and entry['vectors'] == len(vectors) and
                 type(entry['distinctInputs']) is int and entry['distinctInputs'] == len({v['input'] for v in vectors}) and
                 entry['distinctInputs'] >= 5 and review['realHumanEvidence'] is False,
                 'supplemental vector counts or actor drift')
    return len(vectors)


def verify(directory, selection_directory, selection_sha, supplemental_path):
    plan, report = (json.loads((directory / name).read_bytes()) for name in ('plan.json', 'report.json'))
    M['require'](report['schemaVersion'] == 'RsiSupplementalMeasurementInputs/v1' and
                 plan['schemaVersion'] == 'RsiSupplementalMeasurementPlan/v1' and
                 report['planSha256'] == M['file_digest'](directory / 'plan.json') and
                 plan['sourceSelectionSha256'] == report['sourceSelectionSha256'] == selection_sha and
                 type(report['modelRequests']) is int and report['modelRequests'] == 0 and
                 report['realHumanEvidence'] is False and report['formalAdmission'] is False,
                 'supplemental frozen input report drift')
    M['require'](plan['driven_by'] == report['driven_by'] == 'agent' and plan['realHumanEvidence'] is False and
                 type(plan['modelRequests']) is int and plan['modelRequests'] == 0 and
                 plan['usage'] == report['usage'] == 'scripted-control' and plan['formalAdmission'] is False,
                 'supplemental original actor drift')
    selection = M['checked_json'](selection_directory / 'selection.json', selection_sha)
    python_version = plan.get('pythonVersion')
    if python_version is not None:
        M['require'](isinstance(python_version, str) and re.fullmatch(r'Python 3\.\d+\.\d+[A-Za-z0-9.+-]*', python_version) and
                     plan['calibrationSchemaVersion'] == 'RsiSupplementalCalibrationBatch/v1' and
                     type(plan['minimumSystemAvailableBytes']) is int and plan['minimumSystemAvailableBytes'] >= 3221225472 and
                     isinstance(plan['nodeVersion'], str) and re.fullmatch(r'v\d+\.\d+\.\d+', plan['nodeVersion']) and
                     set(plan['sourceFilesSha256']) == set(P['SOURCE_FILES']), 'supplemental isolated executor binding drift')
    M['require'](plan['sourceSelectionCommit'] == selection['sourceCommit'], 'supplemental original selection commit drift')
    index = selection_directory / 'source-queue.jsonl.gz'
    M['require'](M['file_digest'](index) == selection['compressedIndexSha256'] and
                 plan['sourceQueueSha256'] == selection['indexSha256'], 'supplemental frozen queue drift')
    jobs = P['named_jobs'](Q['checked_index'](index, selection['indexSha256']))
    M['require'](len(jobs) == len(report['cases']) == len(plan['selectedSources']), 'supplemental complete source order required')
    by_id = {}
    for job, entry, selected in zip(jobs, report['cases'], plan['selectedSources'], strict=True):
        expected = {'familyId': job['family']['familyId'], 'sourceKey': job['source']['sourceKey'],
                    'caseId': 'supplemental-' + job['source']['sourceBinding']['id'],
                    'familyOrder': job['familyOrder'], 'sourceOrder': job['sourceOrder']}
        M['require'](encoded(selected) == encoded(expected) and encoded({k: entry[k] for k in expected}) == encoded(expected) and
                     entry['path'] == entry['caseId'] + '.json.gz' and re.fullmatch(r'supplemental-[a-f0-9]{16}', entry['caseId']),
                     'supplemental family/source order drift')
        if python_version is not None:
            M['require'](entry['problem'] == entry['caseId'], 'supplemental isolated calibration identity drift')
        by_id[job['source']['sourceBinding']['id']] = (job, entry)
    source_sha = selection['inputs']['supplemental']['sha256']
    M['require'](source_sha == plan['supplementalSha256'] == M['SUPPLEMENTAL_SHA'], 'supplemental original source identity drift')
    rows, vectors, raw_bytes, seen = 0, 0, 0, set()
    for row in M['checked_rows'](supplemental_path, source_sha):
        rows += 1
        if row['id'] not in by_id:
            continue
        M['require'](row['id'] not in seen, 'duplicate supplemental replay row')
        seen.add(row['id'])
        job, entry = by_id[row['id']]
        path = directory / entry['path']
        M['require'](M['file_digest'](path) == entry['sha256'], 'supplemental pack transport drift')
        raw = gzip.decompress(path.read_bytes())
        pack = json.loads(raw)
        M['require'](hashlib.sha256(raw).hexdigest() == entry['packDigest'] == hashlib.sha256(encoded(pack)).hexdigest(),
                     'supplemental pack serialization drift')
        vectors += verify_case(row, pack, entry, job, python_version)
        raw_bytes += len(raw)
    M['require'](type(report['sourceRows']) is int and rows == 7776 == report['sourceRows'] and seen == by_id.keys() and
                 type(report['preparedSources']) is int and report['preparedSources'] == len(seen) and
                 type(report['preparedFamilies']) is int and report['preparedFamilies'] == len({j['family']['familyId'] for j in jobs}),
                 'supplemental replay coverage drift')
    git = lambda *args: subprocess.check_output(['git', *args], cwd=ROOT, encoding='utf-8').strip()
    M['require'](git('rev-parse', plan['sourceCommit'] + '^{tree}') == plan['sourceTree'] and
                 all(M['file_digest'](ROOT / name) == digest for name, digest in plan['sourceFilesSha256'].items()),
                 'supplemental original execution source drift')
    return {'schemaVersion': 'RsiSupplementalMeasurementReplay/v1', 'driven_by': 'agent',
            'actor': 'codex/rsi-supplemental-measurement-replay', 'realHumanEvidence': False, 'status': 'passed',
            'modelRequests': 0, 'programExecutions': 0, 'providerCallsDuringReplay': 0, 'formalAdmission': False,
            'sourceCommit': plan['sourceCommit'], 'sourceSelectionSha256': selection_sha,
            **({'pythonVersion': python_version, 'calibrationSchemaVersion': plan['calibrationSchemaVersion']} if python_version is not None else {}),
            'planSha256': report['planSha256'], 'inputReportSha256': M['file_digest'](directory / 'report.json'),
            'families': report['preparedFamilies'], 'sources': len(seen), 'originalVectors': vectors,
            'packBytes': raw_bytes, 'verifierSha256': M['file_digest'](Path(__file__)), 'benefit': 'NO_GO', 'adoption': 'hold'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('directory', 'selection-directory', 'supplemental', 'output-file'):
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--selection-sha256', required=True)
    args = parser.parse_args()
    result = verify(args.directory, args.selection_directory, args.selection_sha256, args.supplemental)
    M['write_report'](args.output_file, result)
    print(json.dumps(result, indent=2))
