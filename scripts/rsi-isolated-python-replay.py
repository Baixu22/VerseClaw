"""Recompute isolated Python grades from copied inputs and raw launch/output logs."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import runpy
import sys

ROOT = Path(__file__).resolve().parents[1]
H = runpy.run_path(str(ROOT / 'scripts/rsi-native-checker-replay.py'))
file, read, sha, encoded, require, complete = (H[k] for k in ('file', 'read', 'sha', 'encoded', 'require', 'complete'))
SPACE = r'[\u0009-\u000d \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]'
COMPILE = ['/usr/bin/python3', '-I', '-S', '-c',
           "import py_compile;py_compile.compile('/work/source.py',cfile='/tmp/program.pyc',doraise=True)"]
SUBJECT = ['/usr/bin/python3', '-I', '-S', '/program.pyc']
PROFILE = {'compilerFlags': ['-O2', '-std=c++17', '-Wall', '-Wextra', '-Werror', '-Wno-unused-result'],
           'compileTimeoutMs': 60000, 'testTimeoutMs': 10000, 'fileLimitBytes': 16777216,
           'addressSpaceBytes': 1073741824, 'familyTimeoutMs': 1200000}


def normalized(raw):
    text = raw.decode('utf-8', 'replace').replace('\r\n', '\n').replace('\r', '\n')
    lines = [re.sub(SPACE + '+$', '', line) for line in text.split('\n')]
    return re.sub('^' + SPACE + '+|' + SPACE + '+$', '', '\n'.join(lines))


def operation(evidence, row, command, timeout, name):
    require(isinstance(row, dict) and row['command'] == command and type(row['timeoutMs']) is int and
            row['timeoutMs'] == timeout and type(row['timedOut']) is bool and type(row['launched']) is bool and
            (row['exitCode'] is None or type(row['exitCode']) is int) and
            (row['wrapperExitCode'] is None or type(row['wrapperExitCode']) is int) and
            (row['error'] is None or isinstance(row['error'], str)), 'isolated Python process field drift')
    require(row['stdout'] == name + '.stdout' and row['stderr'] == name + '.stderr' and
            row['launch'] == name + '.launch.jsonl', 'isolated Python operation log identity drift')
    for stream in ('stdout', 'stderr'):
        require(sha(file(evidence, row[stream]).read_bytes()) == row[stream + 'Sha256'], 'isolated Python raw log drift')
    raw = file(evidence, row['launch']).read_bytes()
    require(sha(raw) == row['launchSha256'], 'isolated Python launch log drift')
    records = [json.loads(line) for line in raw.split(b'\n') if line]
    require(all(isinstance(value, dict) for value in records), 'isolated Python malformed launch records')
    launched = bool(records and records[0].get('stage') == 'started' and records[0].get('command') == command and
                    type(records[0].get('uid')) is int and records[0]['uid'] == 65534 and
                    type(records[0].get('gid')) is int and records[0]['gid'] == 65534 and
                    type(records[0].get('namespacePid')) is int and records[0]['namespacePid'] == 1)
    require(row['launched'] is launched, 'isolated Python launch state drift')
    if row['error'] is None:
        require(launched and row['wrapperExitCode'] == 0 and len(records) == 2 and
                records[1].get('stage') == 'completed' and type(records[1].get('exitCode')) is int and
                records[1]['exitCode'] == row['exitCode'], 'isolated Python actual exit drift')
    return row


def replay(workspace, worker_sha, shared_sha):
    evidence = file(workspace, 'stdio-python-evidence')
    payload, started, runner = (read(evidence, name) for name in ('payload.json', 'started.json', 'runner-process.json'))
    case_id = payload['caseId']
    require(started['schemaVersion'] == 'RsiIsolatedPythonStarted/v1' and started['driven_by'] == 'agent' and
            started['caseId'] == case_id and started['payloadSha256'] == sha(file(evidence, 'payload.json').read_bytes()),
            'isolated Python started binding drift')
    require(worker_sha == payload['workerSha256'] == started['workerSha256'] == sha(file(evidence, 'worker.py').read_bytes()) and
            shared_sha == payload['sharedWorkerSha256'] == started['sharedWorkerSha256'] ==
            sha(file(evidence, 'inputs/shared-worker.py').read_bytes()), 'isolated Python worker byte drift')
    require(sha(file(workspace, 'src/' + case_id + '.py').read_bytes()) == payload['sourceSha256'] == started['sourceSha256'] ==
            sha(file(evidence, 'inputs/source.py').read_bytes()), 'isolated Python candidate drift')
    oracle = read(workspace, 'oracles/' + case_id + '.json')
    descriptor, vectors = oracle['privatePython'], oracle['tests']
    require(descriptor['schemaVersion'] == 'RsiStdioIsolatedPython/v1' and encoded(payload['descriptor']) == encoded(descriptor) and
            encoded(descriptor['profile']) == encoded(PROFILE) and
            payload['descriptorDigest'] == sha(encoded(descriptor)), 'isolated Python frozen descriptor drift')
    expected_vectors = [{'index': i, 'testId': v.get('testId'), 'inputSha256': sha(v['input'].encode()),
                         'expectedSha256': sha(v['output'].encode())} for i, v in enumerate(vectors)]
    require(encoded(payload['vectors']) == encoded(expected_vectors), 'isolated Python input order drift')
    for i, vector in enumerate(vectors):
        for suffix, text in (('in', vector['input']), ('expected', vector['output'])):
            require(sha(file(evidence, 'inputs/' + str(i) + '.' + suffix).read_bytes()) == sha(text.encode()),
                    'isolated Python original vector drift')
    require(type(runner['exitCode']) is int and runner['exitCode'] == 0 and runner['signal'] is None and runner['error'] is None,
            'isolated Python outer runner failure')
    for stream in ('stdout', 'stderr'):
        require(runner[stream + 'Sha256'] == sha(file(evidence, 'runner.' + stream).read_bytes()), 'isolated Python runner log drift')
    raw = read(evidence, 'worker-report.json')
    require(raw['schemaVersion'] == 'RsiIsolatedPythonWorker/v1' and raw['driven_by'] == 'agent' and
            raw['realHumanEvidence'] is False and type(raw['modelRequests']) is int and raw['modelRequests'] == 0 and
            raw['caseId'] == case_id and raw['workerSha256'] == worker_sha and raw['sharedWorkerSha256'] == shared_sha and
            raw['sourceSha256'] == payload['sourceSha256'] and raw['descriptorDigest'] == payload['descriptorDigest'],
            'isolated Python executed binding drift')
    require(raw['compileError'] is None or isinstance(raw['compileError'], str), 'isolated Python compilation error drift')
    require(raw['failureClass'] in (None, 'assertion', 'infrastructure'), 'isolated Python failure class drift')
    if raw['failureClass'] != 'infrastructure':
        require(raw['pythonVersion'] == descriptor['pythonVersion'], 'isolated Python interpreter drift')
    if raw['compile'] is not None:
        operation(evidence, raw['compile'], COMPILE, descriptor['profile']['compileTimeoutMs'], 'compile-subject')
    if raw['binarySha256'] is not None:
        require(raw['binarySha256'] == sha(file(evidence, 'subject.pyc').read_bytes()), 'isolated Python compiled artifact drift')
    results = []
    infrastructure = raw['compile'] is None or not raw['compile']['launched'] or raw['compile']['error'] is not None
    if raw['compileError'] is None:
        require(complete(raw['compile']) and raw['binarySha256'] is not None, 'isolated Python incomplete compilation')
    elif raw['failureClass'] != 'infrastructure':
        require(raw['compile'] is not None and raw['compile']['launched'] is True and raw['compile']['error'] is None and
                raw['compile']['timedOut'] is False and type(raw['compile']['exitCode']) is int and
                raw['compile']['exitCode'] == 1 and raw['binarySha256'] is None,
                'isolated Python fabricated compilation failure')
    for index, item in enumerate(raw['results']):
        require(index < len(vectors) and type(item['index']) is int and
                encoded({k: item[k] for k in expected_vectors[index]}) == encoded(expected_vectors[index]),
                'isolated Python executed vector drift')
        result = operation(evidence, item['subject'], SUBJECT, descriptor['profile']['testTimeoutMs'], 'subject-' + str(index))
        actual = file(evidence, result['stdout']).read_bytes()
        passed = complete(result) and normalized(actual) == normalized(vectors[index]['output'].encode())
        require(type(item['passed']) is bool and item['passed'] is passed, 'isolated Python grade drift')
        infrastructure |= not result['launched'] or (result['error'] is not None and not result['timedOut']) or \
            result['exitCode'] == -9 or (payload['sourceSha256'] == descriptor['referenceSha256'] and result['timedOut'])
        results.append({'index': index, 'testId': vectors[index].get('testId'), 'passed': passed,
                        'timedOut': result['timedOut'], 'exitCode': result['exitCode'], 'error': result['error'],
                        'stdoutDigest': result['stdoutSha256'], 'stderrDigest': result['stderrSha256']})
    if raw['failureClass'] != 'infrastructure':
        require(not infrastructure and len(results) == (len(vectors) if raw['compileError'] is None else 0),
                'isolated Python settled coverage drift')
        require(raw['failureClass'] == (None if raw['compileError'] is None and all(r['passed'] for r in results) else 'assertion'),
                'isolated Python final verdict drift')
    return {'schemaVersion': 'RsiStdioOracleReport/v3', 'caseId': case_id, 'runtime': 'python3',
            'compileError': raw['compileError'], 'failureClass': raw['failureClass'], 'pythonVersion': raw['pythonVersion'],
            'outputComparison': descriptor['schemaVersion'], 'privatePythonDigest': payload['descriptorDigest'],
            'exitCodePolicy': 'completed-program-exit-zero-and-frozen-text-normalization',
            'evidenceDirectory': 'stdio-python-evidence', 'workerSha256': worker_sha, 'sharedWorkerSha256': shared_sha,
            'sourceSha256': payload['sourceSha256'], 'workerReportSha256': sha(file(evidence, 'worker-report.json').read_bytes()),
            'workerReportVersion': raw['schemaVersion'], 'results': results,
            'counts': {'total': len(vectors), 'passed': sum(r['passed'] for r in results),
                       'failed': sum(not r['passed'] for r in results), 'timedOut': sum(r['timedOut'] for r in results)},
            'passed': raw['failureClass'] is None and len(results) == len(vectors) and all(r['passed'] for r in results)}


def verify_report(workspace, report, worker_sha, shared_sha):
    if report.get('sourceMissing'):
        case = report['caseId']
        oracle = read(workspace, 'oracles/' + case + '.json')
        descriptor, vectors = oracle['privatePython'], oracle['tests']
        require(report['sourceMissing'] is True and not file(workspace, 'src/' + case + '.py').exists() and
                report['schemaVersion'] == 'RsiStdioOracleReport/v3' and report['runtime'] == 'python3' and
                report['compileError'] is None and report['pythonVersion'] == descriptor['pythonVersion'] and
                report['failureClass'] == 'target-module-absent' and report['passed'] is False and
                report['privatePythonDigest'] == sha(encoded(descriptor)) and report['outputComparison'] == descriptor['schemaVersion'],
                'isolated Python baseline drift')
        expected = [{'index': index, 'testId': vector.get('testId'), 'passed': False, 'timedOut': False,
                     'exitCode': None, 'error': 'source-missing', 'stdoutDigest': None, 'stderrDigest': None}
                    for index, vector in enumerate(vectors)]
        require(encoded(report['results']) == encoded(expected) and
                encoded(report['counts']) == encoded({'total': len(vectors), 'passed': 0, 'failed': len(vectors), 'timedOut': 0}),
                'isolated Python baseline counts drift')
        return report
    actual = replay(workspace, worker_sha, shared_sha)
    require(encoded(actual) == encoded(report), 'isolated Python retained report drift')
    return actual


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workspace', type=Path, required=True)
    parser.add_argument('--worker-sha256', required=True)
    parser.add_argument('--shared-worker-sha256', required=True)
    reports = parser.add_mutually_exclusive_group()
    reports.add_argument('--report', type=Path)
    reports.add_argument('--report-stdin', action='store_true')
    args = parser.parse_args()
    result = verify_report(args.workspace, json.load(sys.stdin) if args.report_stdin else json.loads(args.report.read_bytes()),
                           args.worker_sha256, args.shared_worker_sha256) \
        if args.report or args.report_stdin else replay(args.workspace, args.worker_sha256, args.shared_worker_sha256)
    print(json.dumps(result, ensure_ascii=False))
