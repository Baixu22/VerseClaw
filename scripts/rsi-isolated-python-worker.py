"""Execute Python subjects in the existing unprivileged native launcher."""
import hashlib
import json
import os
from pathlib import Path
import re
import runpy
import shutil
import signal
import subprocess
import sys

OUT, PAYLOAD = Path('/out'), Path('/payload')
COMPILE = ['/usr/bin/python3', '-I', '-S', '-c',
           "import py_compile;py_compile.compile('/work/source.py',cfile='/tmp/program.pyc',doraise=True)"]
SUBJECT = ['/usr/bin/python3', '-I', '-S', '/program.pyc']
SPACE = r'[\u0009-\u000d \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]'


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1048576), b''):
            h.update(block)
    return h.hexdigest()


def normalize(value):
    value = value.replace('\r\n', '\n').replace('\r', '\n')
    value = '\n'.join(re.sub(SPACE + '+$', '', line) for line in value.split('\n'))
    return re.sub('^' + SPACE + '+|' + SPACE + '+$', '', value)


def require(value, message):
    if not value:
        raise ValueError(message)


def grade(payload):
    report = {'schemaVersion': 'RsiIsolatedPythonWorker/v1', 'driven_by': 'agent',
              'actor': 'codex/rsi-isolated-python-worker', 'realHumanEvidence': False, 'modelRequests': 0,
              'caseId': payload['caseId'], 'workerSha256': digest(Path(__file__)),
              'sharedWorkerSha256': digest(PAYLOAD / 'shared-worker.py'), 'sourceSha256': payload['sourceSha256'],
              'descriptorDigest': payload['descriptorDigest'], 'pythonVersion': None,
              'compileError': None, 'failureClass': 'infrastructure', 'compile': None,
              'results': [], 'binarySha256': None}
    try:
        require(report['workerSha256'] == payload['workerSha256'] and
                report['sharedWorkerSha256'] == payload['sharedWorkerSha256'], 'isolated Python worker source drift')
        require(os.geteuid() == 0 and not Path('/mnt').exists(), 'isolated Python outer root drift')
        helper = runpy.run_path(str(PAYLOAD / 'shared-worker.py'))
        descriptor = payload['descriptor']
        require(descriptor['schemaVersion'] == 'RsiStdioIsolatedPython/v1' and
                descriptor['profile'] == helper['PROFILE'], 'isolated Python profile drift')
        version = subprocess.run(['/usr/bin/python3', '--version'], capture_output=True, check=True, timeout=10)
        report['pythonVersion'] = version.stdout.decode('utf-8').strip()
        require(report['pythonVersion'] == descriptor['pythonVersion'], 'isolated Python interpreter drift')
        require(digest(PAYLOAD / 'source.py') == payload['sourceSha256'], 'isolated Python subject drift')
        compile_root = helper['make_root']('python-compile-root')
        subject_root = helper['make_root']('python-subject-root')
        shutil.copyfile(PAYLOAD / 'source.py', compile_root / 'work/source.py')
        operation = helper['execute'](compile_root, COMPILE, 'compile-subject', descriptor['profile']['compileTimeoutMs'])
        report['compile'] = operation
        if not helper['complete'](operation):
            report.update(compileError='Python compilation did not complete',
                          failureClass='assertion' if operation['launched'] and operation['error'] is None and
                          not operation['timedOut'] and type(operation['exitCode']) is int and
                          operation['exitCode'] == 1 else 'infrastructure')
            return report
        shutil.copyfile(compile_root / 'tmp/program.pyc', subject_root / 'program.pyc')
        (subject_root / 'program.pyc').chmod(0o555)
        shutil.copyfile(subject_root / 'program.pyc', OUT / 'subject.pyc')
        report['binarySha256'] = digest(OUT / 'subject.pyc')
        report['failureClass'] = None
        reference = payload['sourceSha256'] == descriptor['referenceSha256']
        for index, vector in enumerate(payload['vectors']):
            require(type(vector['index']) is int and vector['index'] == index, 'isolated Python vector order drift')
            input_path = PAYLOAD / (str(index) + '.in')
            expected_path = PAYLOAD / (str(index) + '.expected')
            require(digest(input_path) == vector['inputSha256'] and digest(expected_path) == vector['expectedSha256'],
                    'isolated Python vector source drift')
            operation = helper['execute'](subject_root, SUBJECT, 'subject-' + str(index),
                                          descriptor['profile']['testTimeoutMs'], input_path)
            actual = (OUT / operation['stdout']).read_bytes().decode('utf-8', 'replace')
            expected = expected_path.read_bytes().decode('utf-8')
            passed = bool(helper['complete'](operation) and normalize(actual) == normalize(expected))
            report['results'].append({**vector, 'subject': operation, 'passed': passed})
            infrastructure = not operation['launched'] or (operation['error'] is not None and not operation['timedOut']) or \
                operation['exitCode'] == -signal.SIGKILL or (reference and operation['timedOut'])
            if infrastructure:
                report['failureClass'] = 'infrastructure'
                return report
            if not passed:
                report['failureClass'] = 'assertion'
        return report
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as error:
        report.update(compileError=str(error), failureClass='infrastructure')
        return report


if __name__ == '__main__':
    os.nice(10)
    result = grade(json.load(sys.stdin))
    (OUT / 'worker-report.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'caseId': result['caseId'], 'failureClass': result['failureClass'], 'modelRequests': 0}))
