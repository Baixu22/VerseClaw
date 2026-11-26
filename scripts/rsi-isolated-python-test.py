"""Agent-driven offline fixtures for isolated Python output/launch replay."""
import copy
import hashlib
import json
from pathlib import Path
import runpy
import subprocess
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
R = runpy.run_path(str(HERE / 'rsi-isolated-python-replay.py'))
sha = R['sha']


def fixture(root, exit_code=0, compile_failure=False, empty_output=False):
    evidence = root / 'stdio-python-evidence'
    evidence.mkdir()
    (root / 'src').mkdir(exist_ok=True)
    (root / 'oracles').mkdir(exist_ok=True)
    (evidence / 'inputs').mkdir()
    case = 'isolated-python-fixture'
    source = b'print(7)\n'
    descriptor = {'schemaVersion': 'RsiStdioIsolatedPython/v1', 'pythonVersion': 'Python 3.10.12',
                  'referenceSha256': sha(source), 'profile': R['PROFILE']}
    vectors = [{'kind': 'stdio', 'visibility': 'private', 'testId': 'v' + str(i),
                'input': str(i) + '\n', 'output': '7\n'} for i in range(5)]
    def put(path, value):
        path.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(value, bytes): path.write_bytes(value)
        else: path.write_text(json.dumps(value, ensure_ascii=False), encoding='utf-8')
    oracles = list((root / 'oracles').glob('*.json'))
    if oracles:
        assert len(oracles) == 1
        case = oracles[0].stem
        oracle = json.loads(oracles[0].read_bytes())
        descriptor, vectors = oracle['privatePython'], oracle['tests']
        source = (root / 'src' / (case + '.py')).read_bytes()
    else:
        put(root / 'src' / (case + '.py'), source)
        put(root / 'oracles' / (case + '.json'), {'privatePython': descriptor, 'tests': vectors})
    put(evidence / 'inputs/source.py', source)
    worker_source = (HERE / 'rsi-isolated-python-worker.py').read_bytes()
    shared_source = (HERE / 'rsi-native-checker-worker.py').read_bytes()
    put(evidence / 'worker.py', worker_source)
    put(evidence / 'inputs/shared-worker.py', shared_source)
    worker, shared = sha(worker_source), sha(shared_source)
    encoded_vectors = []
    for i, vector in enumerate(vectors):
        put(evidence / f'inputs/{i}.in', vector['input'].encode())
        put(evidence / f'inputs/{i}.expected', vector['output'].encode())
        encoded_vectors.append({'index': i, 'testId': vector['testId'], 'inputSha256': sha(vector['input'].encode()),
                                'expectedSha256': sha(vector['output'].encode())})
    payload = {'caseId': case, 'workerSha256': worker, 'sharedWorkerSha256': shared,
               'sourceSha256': sha(source), 'descriptor': descriptor, 'descriptorDigest': sha(R['encoded'](descriptor)),
               'vectors': encoded_vectors}
    put(evidence / 'payload.json', payload)
    put(evidence / 'started.json', {'schemaVersion': 'RsiIsolatedPythonStarted/v1', 'driven_by': 'agent',
        'caseId': case, 'payloadSha256': sha((evidence / 'payload.json').read_bytes()), 'sourceSha256': sha(source),
        'workerSha256': worker, 'sharedWorkerSha256': shared})
    put(evidence / 'runner.stdout', b'agent fixture\n')
    put(evidence / 'runner.stderr', b'')
    put(evidence / 'runner-process.json', {'exitCode': 0, 'signal': None, 'error': None,
        'stdoutSha256': sha(b'agent fixture\n'), 'stderrSha256': sha(b'')})
    def operation(name, command, code, stdout, timeout):
        put(evidence / (name + '.stdout'), stdout)
        put(evidence / (name + '.stderr'), b'')
        launch = [{'stage': 'started', 'command': command, 'uid': 65534, 'gid': 65534, 'namespacePid': 1},
                  {'stage': 'completed', 'exitCode': code}]
        raw = b''.join(R['encoded'](row) + b'\n' for row in launch)
        put(evidence / (name + '.launch.jsonl'), raw)
        return {'command': command, 'timeoutMs': timeout, 'timedOut': False, 'launched': True, 'wrapperExitCode': 0,
                'exitCode': code, 'error': None, 'stdout': name + '.stdout', 'stderr': name + '.stderr',
                'stdoutSha256': sha(stdout), 'stderrSha256': sha(b''), 'launch': name + '.launch.jsonl',
                'launchSha256': sha(raw)}
    compile_op = operation('compile-subject', R['COMPILE'], 1 if compile_failure else 0, b'', 60000)
    if not compile_failure:
        put(evidence / 'subject.pyc', b'agent fixture bytecode')
    results = [] if compile_failure else [{**vector, 'passed': exit_code == 0 and not empty_output,
                'subject': operation('subject-' + str(i), R['SUBJECT'], exit_code,
                                     b'' if empty_output else vectors[i]['output'].encode(), 10000)}
               for i, vector in enumerate(encoded_vectors)]
    raw = {'schemaVersion': 'RsiIsolatedPythonWorker/v1', 'driven_by': 'agent', 'realHumanEvidence': False,
           'modelRequests': 0, 'caseId': case, 'workerSha256': worker, 'sharedWorkerSha256': shared,
           'sourceSha256': sha(source), 'descriptorDigest': payload['descriptorDigest'],
           'pythonVersion': descriptor['pythonVersion'], 'compile': compile_op,
           'compileError': 'Python compilation did not complete' if compile_failure else None,
           'binarySha256': None if compile_failure else sha(b'agent fixture bytecode'),
           'failureClass': 'assertion' if compile_failure or exit_code != 0 or empty_output else None,
           'results': results}
    put(evidence / 'worker-report.json', raw)
    return worker, shared


class IsolatedPythonTests(unittest.TestCase):
    def test_original_source_and_five_outputs_replay(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            report = R['replay'](root, *fixture(root))
            self.assertTrue(report['passed'])
            self.assertEqual(report['counts']['passed'], 5)

    def test_vector_cannot_reuse_another_vectors_success_logs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            worker, shared = fixture(root)
            evidence = root / 'stdio-python-evidence'
            path = evidence / 'worker-report.json'
            raw = json.loads(path.read_bytes())
            failed = raw['results'][1]
            (evidence / failed['subject']['stdout']).write_bytes(b'wrong\n')
            failed['subject']['stdoutSha256'] = sha(b'wrong\n')
            failed['passed'] = False
            raw['failureClass'] = 'assertion'
            path.write_text(json.dumps(raw), encoding='utf-8')
            self.assertFalse(R['replay'](root, worker, shared)['passed'])
            failed['subject'] = copy.deepcopy(raw['results'][0]['subject'])
            failed['passed'] = True
            raw['failureClass'] = None
            path.write_text(json.dumps(raw), encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'operation log identity drift'):
                R['replay'](root, worker, shared)

    def test_report_stdin_reuses_the_frozen_report_verifier(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            worker, shared = fixture(root)
            report = R['replay'](root, worker, shared)
            command = [sys.executable, '-B', str(HERE / 'rsi-isolated-python-replay.py'),
                       '--workspace', str(root), '--worker-sha256', worker, '--shared-worker-sha256', shared]
            result = subprocess.run(command + ['--report-stdin'], input=json.dumps(report),
                                    text=True, capture_output=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout), report)
            invalid = subprocess.run(command + ['--report-stdin', '--report', str(root / 'report.json')],
                                     input=json.dumps(report), text=True, capture_output=True, timeout=10)
            self.assertEqual(invalid.returncode, 2)
            self.assertIn('not allowed with argument', invalid.stderr)

    def test_correct_output_with_nonzero_exit_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            report = R['replay'](root, *fixture(root, exit_code=3))
            self.assertFalse(report['passed'])
            self.assertEqual(report['failureClass'], 'assertion')

    def test_completed_compile_failure_remains_an_assertion(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            report = R['replay'](root, *fixture(root, compile_failure=True))
            self.assertEqual(report['failureClass'], 'assertion')
            self.assertFalse(report['passed'])
            self.assertEqual(report['results'], [])

    def test_baseline_requires_a_literal_missing_source_marker(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            worker, shared = fixture(root)
            case = 'isolated-python-fixture'
            (root / 'src' / (case + '.py')).unlink()
            descriptor = json.loads((root / 'oracles' / (case + '.json')).read_bytes())['privatePython']
            report = {'schemaVersion': 'RsiStdioOracleReport/v3', 'caseId': case, 'runtime': 'python3',
                      'sourceMissing': 1, 'compileError': None, 'pythonVersion': descriptor['pythonVersion'],
                      'failureClass': 'target-module-absent', 'passed': False,
                      'privatePythonDigest': sha(R['encoded'](descriptor)), 'outputComparison': descriptor['schemaVersion']}
            with self.assertRaisesRegex(ValueError, 'baseline drift'):
                R['verify_report'](root, report, worker, shared)

    def test_killed_compiler_cannot_be_reclassified_as_source_rejection(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            worker, shared = fixture(root, compile_failure=True)
            evidence = root / 'stdio-python-evidence'
            path = evidence / 'worker-report.json'
            raw = json.loads(path.read_bytes())
            operation = raw['compile']
            launch = evidence / operation['launch']
            records = [json.loads(line) for line in launch.read_bytes().split(b'\n') if line]
            records[1]['exitCode'] = operation['exitCode'] = -9
            launch.write_bytes(b''.join(R['encoded'](row) + b'\n' for row in records))
            operation['launchSha256'] = sha(launch.read_bytes())
            path.write_text(json.dumps(raw), encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'fabricated compilation failure'):
                R['replay'](root, worker, shared)
            raw['failureClass'] = 'infrastructure'
            path.write_text(json.dumps(raw), encoding='utf-8')
            report = R['replay'](root, worker, shared)
            self.assertEqual(report['failureClass'], 'infrastructure')
            self.assertFalse(report['passed'])

    def test_coherent_namespace_boolean_mutation_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            worker, shared = fixture(root)
            evidence = root / 'stdio-python-evidence'
            raw = json.loads((evidence / 'worker-report.json').read_bytes())
            op = raw['results'][0]['subject']
            path = evidence / op['launch']
            records = [json.loads(line) for line in path.read_bytes().splitlines()]
            records[0]['namespacePid'] = True
            path.write_bytes(b''.join(R['encoded'](row) + b'\n' for row in records))
            op['launchSha256'] = sha(path.read_bytes())
            (evidence / 'worker-report.json').write_text(json.dumps(raw), encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'launch state drift'):
                R['replay'](root, worker, shared)

    def test_coherent_command_mutation_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            worker, shared = fixture(root)
            path = root / 'stdio-python-evidence/worker-report.json'
            raw = json.loads(path.read_bytes())
            raw['results'][0]['subject']['command'] = ['/usr/bin/python3', '/program.pyc']
            path.write_text(json.dumps(raw), encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'process field drift'):
                R['replay'](root, worker, shared)

    def test_fabricated_compilation_failure_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            worker, shared = fixture(root)
            path = root / 'stdio-python-evidence/worker-report.json'
            raw = json.loads(path.read_bytes())
            raw.update(compileError='fabricated', failureClass='assertion', results=[])
            path.write_text(json.dumps(raw), encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'fabricated compilation failure'):
                R['replay'](root, worker, shared)

    def test_boolean_model_counter_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            worker, shared = fixture(root)
            path = root / 'stdio-python-evidence/worker-report.json'
            raw = json.loads(path.read_bytes())
            raw['modelRequests'] = False
            path.write_text(json.dumps(raw), encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'executed binding drift'):
                R['replay'](root, worker, shared)

    def test_text_normalization_preserves_internal_whitespace(self):
        self.assertEqual(R['normalized'](b'  alpha\r\n beta \t\r\n'), 'alpha\n beta')
        self.assertNotEqual(R['normalized'](b'a  b\n'), R['normalized'](b'a b\n'))


if __name__ == '__main__':
    unittest.main()
