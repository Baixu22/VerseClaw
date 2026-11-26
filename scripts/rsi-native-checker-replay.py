"""Independently replay private checker grades from retained files without execution."""
import argparse
import hashlib
import json
from pathlib import Path
import re


def require(value, message):
    if not value:
        raise ValueError(message)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def encoded(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode('utf-8')


def file(root, relative):
    require(isinstance(relative, str) and re.fullmatch(r'[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*', relative) and
            all(part not in ('.', '..') for part in relative.split('/')), 'unsafe native replay path')
    path = root
    for part in relative.split('/'):
        path /= part
        require(not path.is_symlink(), 'native replay symlink')
    return path


def read(root, relative):
    return json.loads(file(root, relative).read_bytes())


def complete(operation):
    return isinstance(operation, dict) and operation.get('error') is None and operation.get('timedOut') is False and \
        type(operation.get('exitCode')) is int and operation['exitCode'] == 0


def verify(workspace, report, worker_sha):
    require(type(report.get('passed')) is bool and
            all(type(report.get('counts', {}).get(key)) is int for key in ['total', 'passed', 'failed', 'timedOut']) and
            all(type(row.get('index')) is int and type(row.get('passed')) is bool and type(row.get('timedOut')) is bool
                for row in report.get('results', [])), 'native replay report field type drift')
    case_id = report['caseId']
    oracle = read(workspace, 'oracles/' + case_id + '.json')
    checker, vectors = oracle['nativeChecker'], oracle['tests']
    require(checker['schemaVersion'] == 'RsiStdioNativeChecker/v1' and
            report['nativeCheckerDigest'] == sha(encoded(checker)) and
            report['schemaVersion'] == 'RsiStdioOracleReport/v2' and
            report['outputComparison'] == checker['schemaVersion'], 'native replay contract drift')
    source = file(workspace, 'src/' + case_id + '.cpp')
    if report.get('sourceMissing'):
        require(not source.exists() and report['passed'] is False and report['failureClass'] == 'target-module-absent',
                'native replay baseline drift')
        require(len(report['results']) == len(vectors) and all(row['error'] == 'source-missing' and not row['passed']
                                                            for row in report['results']), 'native replay missing source results')
        require(report['counts'] == {'total': len(vectors), 'passed': 0, 'failed': len(vectors), 'timedOut': 0},
                'native replay baseline counts drift')
        require(all(row['index'] == index and row['testId'] == vectors[index].get('testId')
                    for index, row in enumerate(report['results'])), 'native replay baseline vector drift')
        return {'caseId': case_id, 'passed': False, 'failureClass': 'target-module-absent', 'vectors': len(vectors)}
    evidence = file(workspace, 'native-checker-evidence')
    payload, started = read(evidence, 'payload.json'), read(evidence, 'started.json')
    require(started['schemaVersion'] == 'RsiNativeCheckerStarted/v1' and started['driven_by'] == 'agent' and
            started['caseId'] == payload['caseId'] == case_id, 'native replay started identity drift')
    require(started['payloadSha256'] == sha(file(evidence, 'payload.json').read_bytes()), 'native replay payload drift')
    require(started['workerSha256'] == payload['workerSha256'] == worker_sha == sha(file(evidence, 'worker.py').read_bytes()),
            'native replay worker drift')
    require(started['sourceSha256'] == payload['sourceSha256'] == sha(source.read_bytes()) ==
            sha(file(evidence, 'inputs/source.cpp').read_bytes()), 'native replay candidate drift')
    require(payload['checker'] == checker and payload['checkerDigest'] == sha(encoded(checker)), 'native replay checker drift')
    expected_vectors = [{'index': index, 'testId': vector.get('testId'), 'inputSha256': sha(vector['input'].encode()),
                         'expectedSha256': sha(vector['output'].encode())} for index, vector in enumerate(vectors)]
    require(all(type(row.get('index')) is int for row in payload['vectors']), 'native replay vector type drift')
    require(payload['vectors'] == expected_vectors, 'native replay vector order drift')
    for path, expected in checker['sourceFilesSha256'].items():
        require(sha(file(workspace, checker['basePath'] + '/' + path).read_bytes()) == expected ==
                sha(file(evidence, 'inputs/bundle/' + path).read_bytes()), 'native replay checker source drift')
    for index, vector in enumerate(vectors):
        for suffix, value in [('in', vector['input']), ('expected', vector['output'])]:
            require(sha(file(evidence, 'inputs/' + str(index) + '.' + suffix).read_bytes()) == sha(value.encode()),
                    'native replay private input drift')
    runner = read(evidence, 'runner-process.json')
    require(runner['exitCode'] == 0 and runner['signal'] is None and runner['error'] is None, 'native replay runner failure')
    for stream in ['stdout', 'stderr']:
        require(runner[stream + 'Sha256'] == sha(file(evidence, 'runner.' + stream).read_bytes()), 'native replay runner log drift')
    raw = read(evidence, 'worker-report.json')
    require(raw['schemaVersion'] in ['RsiNativeCheckerWorker/v1', 'RsiNativeCheckerWorker/v2'] and
            raw['driven_by'] == 'agent' and type(raw['modelRequests']) is int and raw['modelRequests'] == 0 and
            raw['caseId'] == case_id and raw['workerSha256'] == worker_sha and raw['profile'] == checker['profile'] and
            raw['compiler'] == checker['compilerVersion'] and raw['sourceSha256'] == payload['sourceSha256'] and
            raw['checkerDigest'] == payload['checkerDigest'], 'native replay executed bindings drift')
    operations = list(raw['compiles'].values())
    require(set(raw['compiles']) <= {'subject', 'checker'}, 'native replay compilation roles drift')
    require(raw['compileError'] is None or isinstance(raw['compileError'], str), 'native replay compile error drift')
    for operation in operations:
        require(operation['timeoutMs'] == checker['profile']['compileTimeoutMs'], 'native replay compilation timeout drift')
    for row in raw['results']:
        for operation in [row['subject'], row.get('checker')]:
            if operation:
                require(operation['timeoutMs'] == checker['profile']['testTimeoutMs'], 'native replay execution timeout drift')
    if raw['schemaVersion'] == 'RsiNativeCheckerWorker/v2':
        def includes(directories):
            return [argument for directory in directories for argument in ['-I', '/bundle/' + directory]]
        reference = payload['sourceSha256'] == checker['referenceSha256']
        commands = {
            'subject': ['g++', *checker['profile']['compilerFlags'],
                        *includes(checker['includeDirs'] + checker['referenceIncludeDirs'] if reference else []),
                        '/work/source.cpp', '-o', '/tmp/subject'],
            'checker': ['g++', *checker['profile']['compilerFlags'], *includes(checker['includeDirs']),
                        '/bundle/' + checker['entryPath'], '-o', '/tmp/checker']}
        for role, operation in raw['compiles'].items():
            require(operation['command'] == commands[role], 'native replay compilation command drift')
        for row in raw['results']:
            require(row['subject']['command'] == ['/program'], 'native replay subject command drift')
            if row.get('checker'):
                require(row['checker']['command'] == ['/tmp/checker', '/private/input', '/private/actual', '/private/expected'],
                        'native replay checker command drift')
    operations += [operation for row in raw['results'] for operation in [row['subject'], row.get('checker')] if operation]
    for operation in operations:
        require(type(operation['timedOut']) is bool and (operation['error'] is None or isinstance(operation['error'], str)) and
                (operation['exitCode'] is None or type(operation['exitCode']) is int), 'native replay process record drift')
        for stream in ['stdout', 'stderr']:
            require(sha(file(evidence, operation[stream]).read_bytes()) == operation[stream + 'Sha256'], 'native replay operation log drift')
        if raw['schemaVersion'] == 'RsiNativeCheckerWorker/v2':
            launch_bytes = file(evidence, operation['launch']).read_bytes()
            require(sha(launch_bytes) == operation['launchSha256'], 'native replay launch record drift')
            records = [json.loads(line) for line in launch_bytes.split(b'\n') if line]
            require(all(isinstance(row, dict) for row in records), 'native replay malformed launch record')
            launched = bool(records and records[0].get('stage') == 'started' and
                            records[0].get('command') == operation['command'] and records[0].get('uid') == 65534 and
                            records[0].get('gid') == 65534 and type(records[0].get('namespacePid')) is int and
                            records[0].get('namespacePid') == 1)
            require(operation['launched'] is launched, 'native replay launch state drift')
            if operation['error'] is None:
                require(launched and operation['wrapperExitCode'] == 0 and len(records) == 2 and
                        records[1].get('stage') == 'completed' and type(records[1].get('exitCode')) is int and
                        records[1]['exitCode'] == operation['exitCode'], 'native replay program exit drift')
    for path, expected in raw['binarySha256'].items():
        require(path in ['subject.binary', 'checker.binary'] and sha(file(evidence, path).read_bytes()) == expected,
                'native replay binary drift')
    if raw['compileError'] is None:
        require(complete(raw['compiles']['subject']) and complete(raw['compiles']['checker']) and
                set(raw['binarySha256']) == {'subject.binary', 'checker.binary'}, 'native replay incomplete compilation')
    results = []
    for index, row in enumerate(raw['results']):
        require(type(row.get('index')) is int and index < len(vectors) and
                all(row[key] == value for key, value in expected_vectors[index].items()),
                'native replay executed vector drift')
        subject = row['subject']
        passed = complete(subject) and complete(row.get('checker'))
        require(row['passed'] is passed, 'native replay checker verdict drift')
        results.append({'index': index, 'testId': vectors[index].get('testId'), 'passed': passed,
                        'timedOut': subject['timedOut'], 'exitCode': subject['exitCode'], 'error': subject['error'],
                        'stdoutDigest': subject['stdoutSha256'], 'stderrDigest': subject['stderrSha256'], 'checker': row.get('checker')})
    require(raw['failureClass'] in [None, 'assertion', 'infrastructure'], 'native replay failure class drift')
    if raw['failureClass'] != 'infrastructure':
        require(len(results) == (len(vectors) if raw['compileError'] is None else 0), 'native replay settled coverage drift')
        require(raw['failureClass'] == (None if raw['compileError'] is None and all(row['passed'] for row in results) else 'assertion'),
                'native replay failure verdict drift')
    expected = {'schemaVersion': 'RsiStdioOracleReport/v2', 'caseId': case_id, 'runtime': 'cpp',
                'compileError': raw['compileError'], 'failureClass': raw['failureClass'], 'cppToolchain': 'gcc-libstdc++',
                'compiler': raw['compiler'], 'executionEnvironment': 'Ubuntu-22.04/WSL2-isolated-native-checker-C++17',
                'exitCodePolicy': 'completed-program-and-official-checker-exit-zero', 'outputComparison': checker['schemaVersion'],
                'normalization': 'none; native checker owns output semantics', 'nativeCheckerDigest': raw['checkerDigest'],
                'workerSha256': worker_sha, 'sourceSha256': raw['sourceSha256'], 'evidenceDirectory': 'native-checker-evidence',
                'results': results, 'counts': {'total': len(vectors), 'passed': sum(row['passed'] for row in results),
                                             'failed': sum(not row['passed'] for row in results),
                                             'timedOut': sum(row['timedOut'] for row in results)},
                'passed': raw['failureClass'] is None and raw['compileError'] is None and len(results) == len(vectors) and
                          all(row['passed'] for row in results)}
    if raw['schemaVersion'] == 'RsiNativeCheckerWorker/v2':
        expected['workerReportVersion'] = raw['schemaVersion']
    require(report == expected, 'native replay oracle report drift')
    return {'caseId': case_id, 'passed': expected['passed'], 'failureClass': expected['failureClass'],
            'vectors': len(vectors), 'completedVectors': len(results)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workspace', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    parser.add_argument('--worker-sha256', required=True)
    args = parser.parse_args()
    result = verify(args.workspace, json.loads(args.report.read_bytes()), args.worker_sha256)
    print(json.dumps({'schemaVersion': 'RsiNativeCheckerReplay/v1', 'driven_by': 'agent',
                      'actor': 'codex/rsi-native-checker-replay', 'modelRequests': 0,
                      'workerSha256': args.worker_sha256, 'result': result}))
