"""Prepare original supplemental I/O packs in the frozen source queue order."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import re
import runpy
import subprocess

ROOT = Path(__file__).resolve().parents[1]
Q = runpy.run_path(str(ROOT / 'scripts/rsi-prospective-source-selection.py'))
M, S = Q['M'], Q['S']
SOURCE_FILES = (*Q['SOURCE_FILES'], 'scripts/rsi-supplemental-measurement.py', 'scripts/rsi-supplemental-measurement-verify.py',
                'scripts/lib/rsi-stdio-tasks.mjs', 'scripts/lib/rsi-stdio-oracle.mjs',
                'scripts/lib/rsi-live-grader.mjs', 'scripts/lib/rsi-guided-evidence.mjs',
                'scripts/lib/rsi-semantic-study.mjs', 'scripts/lib/rsi-benefit-eval.mjs', 'scripts/lib/rsi-constructed-tasks.mjs',
                'scripts/lib/rsi-coding-protocol.mjs', 'scripts/rsi-stdio-wsl-runner.py',
                'scripts/lib/rsi-isolated-python.mjs', 'scripts/rsi-isolated-python-worker.py',
                'scripts/rsi-isolated-python-replay.py', 'scripts/rsi-native-checker-worker.py',
                'scripts/rsi-native-checker-replay.py', 'scripts/lib/rsi-native-checker.mjs',
                'scripts/rsi-library-checker-calibrate.mjs',
                'package.json', 'pnpm-lock.yaml')


def encoded(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode('utf-8')


def pack_case(row, family, source):
    current = S['screen_record'](row)
    M['require'](source['tier'] == 'supplementalNamed' and source['eligibleForCalibration'] is True and
                 source['identityKey'] == 'supplemental:' + row['id'] and
                 M['compact'](source['sourceBinding']) == M['compact'](current) and current['vectorIssue'] is None and
                 current['referenceIssue'] is None, 'matching screened supplemental source required')
    M['require'](re.fullmatch(r'[a-f0-9]{16}', row['id']) and 40 <= len(row['prompt']) <= 200000,
                 'complete supplemental public contract required')
    M['require'](family['status'] == 'planned' and family['tierCredit'] == 'named' and
                 family['excludedByHistoricalShape'] is False, 'unobserved named family required')
    vectors = [{'kind': 'stdio', 'visibility': 'private', 'input': pair[0], 'output': pair[1],
                'testId': 'original-' + str(index)} for index, pair in enumerate(row['tests'])]
    source_id, family_id = source['identityKey'], family['familyId']
    prompt = row['prompt']
    contract = {'prompt': M['SPACE'].sub(' ', prompt).strip(' ').lower(), 'language': 'python3'}
    return {'id': 'supplemental-' + row['id'], 'name': row['origin']['upstream_id'], 'runtime': 'python3',
            'split': 'validation', 'familyId': family_id, 'independenceGroup': family_id, 'prompt': prompt,
            'declaration': 'Write a complete Python 3 program that reads standard input and writes the required answer to standard output.\n',
            'reference': row['reference'], 'vectors': vectors,
            'provenance': {'sourceId': source_id, 'sourceIdentities': family['identityKeys'],
                           'upstreamIds': [row['origin']['source'] + ':' + row['origin']['upstream_id']],
                           'originalSourceRecordSha256': current['serializedRecordSha256'],
                           'originalTestsSha256': current['testsSha256'], 'sourceKey': source['sourceKey'],
                           'sourceBindingSha256': source['sourceBindingSha256'], 'groupSha256': family['groupSha256'],
                           'componentIds': family['componentIds'], 'knownReferenceShapes': family['knownReferenceShapes'],
                           'purpose': 'execution-contract-calibration',
                           'familyReview': {'schemaVersion': 'RsiSemanticFamilyReview/v1', 'driven_by': 'agent',
                                            'actor': 'codex/rsi-supplemental-measurement', 'realHumanEvidence': False,
                                            'sourceId': source_id, 'familyId': family_id, 'runtime': 'python3',
                                            'basis': 'Frozen complete member/known-shape queue and original supplemental source/I/O digests.',
                                            'contractDigest': hashlib.sha256(encoded(contract)).hexdigest(),
                                            'referenceDigest': current['referenceSha256'],
                                            'privateOracleDigest': hashlib.sha256(encoded(vectors)).hexdigest()}}}


def named_jobs(queue):
    jobs, seen = [], set()
    for index, family in enumerate(queue):
        if family['status'] != 'planned' or family['tierCredit'] != 'named':
            continue
        for source_index, source in enumerate(family['alternatives']):
            if source['tier'] != 'supplementalNamed' or source['eligibleForCalibration'] is not True:
                continue
            identity = source['identityKey']
            M['require'](identity not in seen, 'duplicate supplemental dispatch identity')
            seen.add(identity)
            jobs.append({'familyOrder': index, 'sourceOrder': source_index, 'family': family, 'source': source})
    return jobs


def prepare(selection_directory, selection_sha, supplemental_path, output, python_version=None):
    git = lambda *args: subprocess.check_output(['git', *args], cwd=ROOT, encoding='utf-8').strip()
    M['require'](not git('status', '--porcelain') and not output.exists(), 'new output and clean executor required')
    selection = M['checked_json'](selection_directory / 'selection.json', selection_sha)
    M['require'](selection['schemaVersion'] == 'RsiProspectiveSourceSelection/v1' and
                 selection['driven_by'] == 'agent' and selection['realHumanEvidence'] is False and
                 type(selection['modelRequests']) is int and selection['modelRequests'] == 0,
                 'frozen agent-driven source selection required')
    M['require'](git('rev-parse', selection['sourceCommit'] + '^{tree}') == selection['sourceTree'] and
                 all(M['file_digest'](ROOT / name) == digest for name, digest in selection['sourceFilesSha256'].items()),
                 'original source-selection executor binding drift')
    queue_path = selection_directory / 'source-queue.jsonl.gz'
    M['require'](M['file_digest'](queue_path) == selection['compressedIndexSha256'], 'frozen source queue transport drift')
    queue = Q['checked_index'](queue_path, selection['indexSha256'])
    jobs = named_jobs(queue)
    by_id = {job['source']['sourceBinding']['id']: (index, job) for index, job in enumerate(jobs)}
    source_sha = selection['inputs']['supplemental']['sha256']
    M['require'](jobs and source_sha == M['SUPPLEMENTAL_SHA'] and M['file_digest'](supplemental_path) == source_sha,
                 'original supplemental source required')
    bindings = {name: M['file_digest'](ROOT / name) for name in SOURCE_FILES}
    if python_version is not None:
        M['require'](re.fullmatch(r'Python 3\.\d+\.\d+[A-Za-z0-9.+-]*', python_version), 'frozen Python interpreter version required')
        profile = runpy.run_path(str(ROOT / 'scripts/rsi-isolated-python-replay.py'))['PROFILE']
    plan = {'schemaVersion': 'RsiSupplementalMeasurementPlan/v1', 'driven_by': 'agent',
            'actor': 'codex/rsi-supplemental-measurement', 'realHumanEvidence': False, 'modelRequests': 0,
            'formalAdmission': False, 'usage': 'scripted-control', 'sourceCommit': git('rev-parse', 'HEAD'),
            'sourceTree': git('rev-parse', 'HEAD^{tree}'), 'sourceFilesSha256': bindings,
            'nodeVersion': subprocess.check_output(['node', '--version'], encoding='utf-8').strip(),
            'minimumSystemAvailableBytes': 3221225472,
            'sourceSelectionSha256': selection_sha, 'sourceSelectionCommit': selection['sourceCommit'],
            'sourceQueueSha256': selection['indexSha256'], 'supplementalSha256': source_sha,
            'selectedSources': [{'familyId': job['family']['familyId'], 'sourceKey': job['source']['sourceKey'],
                                 'caseId': 'supplemental-' + job['source']['sourceBinding']['id'],
                                 'familyOrder': job['familyOrder'], 'sourceOrder': job['sourceOrder']} for job in jobs],
            'benefit': 'NO_GO', 'adoption': 'hold'}
    if python_version is not None:
        plan['pythonVersion'] = python_version
        plan['calibrationSchemaVersion'] = 'RsiSupplementalCalibrationBatch/v1'
    output.mkdir(parents=True)
    M['write_report'](output / 'plan.json', plan)
    prepared, rows = {}, 0
    try:
        for row in M['checked_rows'](supplemental_path, source_sha):
            rows += 1
            selected = by_id.get(row['id'])
            if selected is None:
                continue
            position, job = selected
            M['require'](row['id'] not in prepared, 'duplicate original supplemental record')
            item = pack_case(row, job['family'], job['source'])
            if python_version is not None:
                item['privatePython'] = {'schemaVersion': 'RsiStdioIsolatedPython/v1', 'pythonVersion': python_version,
                                         'referenceSha256': job['source']['sourceBinding']['referenceSha256'], 'profile': profile}
            pack = {'schemaVersion': 'RsiIndependentCodingCases/v2', 'datasetVersion': 'RsiSemanticIndependentCases/v2',
                    'executionKind': 'stdio-program', 'usage': 'scripted-control', 'driven_by': 'agent',
                    'actor': 'codex/rsi-supplemental-measurement', 'realHumanEvidence': False, 'cases': [item]}
            raw = encoded(pack)
            path = output / (item['id'] + '.json.gz')
            with path.open('xb') as stream:
                stream.write(gzip.compress(raw, mtime=0))
            prepared[row['id']] = {**plan['selectedSources'][position], 'problem': item['id'], 'path': path.name,
                                   'sha256': M['file_digest'](path), 'packDigest': hashlib.sha256(raw).hexdigest(),
                                   'vectors': len(item['vectors']), 'distinctInputs': job['source']['sourceBinding']['distinctInputs'],
                                   'referenceSha256': job['source']['sourceBinding']['referenceSha256'],
                                   'originalSourceRecordSha256': job['source']['sourceBinding']['serializedRecordSha256']}
            del item, pack, raw
        M['require'](rows == 7776 and prepared.keys() == by_id.keys(), 'complete supplemental preparation required')
        M['require'](not git('status', '--porcelain') and git('rev-parse', 'HEAD') == plan['sourceCommit'] and
                     git('rev-parse', 'HEAD^{tree}') == plan['sourceTree'] and
                     all(M['file_digest'](ROOT / name) == digest for name, digest in bindings.items()),
                     'supplemental executor changed during preparation')
        report = {'schemaVersion': 'RsiSupplementalMeasurementInputs/v1', 'driven_by': 'agent',
                  'actor': 'codex/rsi-supplemental-measurement', 'realHumanEvidence': False, 'modelRequests': 0,
                  'usage': 'scripted-control', 'formalAdmission': False, 'sourceSelectionSha256': selection_sha,
                  'planSha256': M['file_digest'](output / 'plan.json'), 'sourceRows': rows,
                  'preparedFamilies': len({job['family']['familyId'] for job in jobs}),
                  'preparedSources': len(prepared), 'cases': [prepared[job['source']['sourceBinding']['id']] for job in jobs]}
        M['write_report'](output / 'report.json', report)
        return report
    except Exception as error:
        M['write_report'](output / 'infrastructure.json', {'schemaVersion': 'RsiSupplementalMeasurementInfrastructure/v1',
                          'driven_by': 'agent', 'actor': 'codex/rsi-supplemental-measurement',
                          'realHumanEvidence': False, 'modelRequests': 0,
                          'planSha256': M['file_digest'](output / 'plan.json'), 'preparedSources': len(prepared),
                          'error': {'name': type(error).__name__, 'message': str(error)}})
        raise


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('selection-directory', 'supplemental', 'output-directory'):
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--selection-sha256', required=True)
    parser.add_argument('--python-version')
    args = parser.parse_args()
    result = prepare(args.selection_directory, args.selection_sha256, args.supplemental, args.output_directory, args.python_version)
    print(json.dumps({key: value for key, value in result.items() if key != 'cases'}, indent=2))
