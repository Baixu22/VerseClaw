"""Compile and grade isolated C++ subjects with a frozen private native checker."""
import ctypes
import errno
import hashlib
import json
import math
import os
from pathlib import Path
import re
import resource
import shutil
import signal
import subprocess
import sys
import time

OUT = Path('/out')
PAYLOAD = Path('/payload')
PROFILE = {'compilerFlags': ['-O2', '-std=c++17', '-Wall', '-Wextra', '-Werror', '-Wno-unused-result'],
           'compileTimeoutMs': 60000, 'testTimeoutMs': 10000, 'fileLimitBytes': 16777216,
           'addressSpaceBytes': 1073741824, 'familyTimeoutMs': 1200000}
PR_SET_NO_NEW_PRIVS, PR_CAPBSET_DROP = 38, 24


def require(value, message):
    if not value:
        raise ValueError(message)


def sha(path):
    result = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1048576), b''):
            result.update(block)
    return result.hexdigest()


def relative(value):
    require(isinstance(value, str) and re.fullmatch(r'[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*', value) and
            all(part not in ('.', '..') for part in value.split('/')), 'unsafe checker path')
    return value


def make_root(name):
    root = Path('/tmp') / name
    root.mkdir()
    for directory in ('usr', 'tmp', 'work', 'dev', 'private'):
        (root / directory).mkdir()
    (root / 'tmp').chmod(0o1777)
    subprocess.run(['mount', '--bind', '/usr', str(root / 'usr')], check=True, capture_output=True)
    subprocess.run(['mount', '-o', 'remount,bind,ro', str(root / 'usr')], check=True, capture_output=True)
    for directory in ('bin', 'lib', 'lib64', 'sbin'):
        (root / directory).symlink_to('usr/' + directory)
    (root / 'dev/null').touch()
    subprocess.run(['mount', '--bind', '/dev/null', str(root / 'dev/null')], check=True, capture_output=True)
    return root


def limits(timeout):
    resource.setrlimit(resource.RLIMIT_AS, (PROFILE['addressSpaceBytes'], PROFILE['addressSpaceBytes']))
    resource.setrlimit(resource.RLIMIT_FSIZE, (PROFILE['fileLimitBytes'], PROFILE['fileLimitBytes']))
    resource.setrlimit(resource.RLIMIT_CPU, (math.ceil(timeout) + 1, math.ceil(timeout) + 2))
    resource.setrlimit(resource.RLIMIT_NOFILE, (128, 128))
    resource.setrlimit(resource.RLIMIT_NPROC, (32, 32))


def enter_root(root, timeout):
    limits(timeout)
    os.chroot(root)
    os.chdir('/tmp')
    libc = ctypes.CDLL(None, use_errno=True)
    require(libc.prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) == 0, 'cannot set no-new-privileges')
    for capability in range(64):
        if libc.prctl(PR_CAPBSET_DROP, capability, 0, 0, 0) != 0 and ctypes.get_errno() != errno.EINVAL:
            raise OSError(ctypes.get_errno(), 'cannot drop capability bounding set')
    os.setgroups([])
    os.setgid(65534)
    os.setuid(65534)


def execute(root, command, name, timeout_ms, input_path=None):
    timeout = timeout_ms / 1000
    result = {'exitCode': None, 'timedOut': False, 'error': None, 'command': command,
              'stdout': name + '.stdout', 'stderr': name + '.stderr', 'timeoutMs': timeout_ms,
              'launch': name + '.launch.jsonl', 'launched': False, 'wrapperExitCode': None}
    started = time.monotonic()
    process = None
    with (OUT / result['stdout']).open('xb') as stdout, (OUT / result['stderr']).open('xb') as stderr, \
            (OUT / result['launch']).open('xb') as launch:
        source = input_path.open('rb') if input_path else subprocess.DEVNULL
        try:
            invocation = ['/usr/bin/unshare', '--pid', '--fork', '--kill-child', '/usr/bin/python3', __file__,
                          '--execute', str(root), str(timeout), json.dumps(command), str(launch.fileno())]
            process = subprocess.Popen(invocation, stdin=source, stdout=stdout, stderr=stderr,
                                       env={'PATH': '/usr/bin:/bin', 'HOME': '/tmp', 'TMPDIR': '/tmp', 'LC_ALL': 'C.UTF-8'},
                                       start_new_session=True, preexec_fn=lambda: limits(timeout), pass_fds=(launch.fileno(),))
            try:
                result['wrapperExitCode'] = process.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                result.update(wrapperExitCode=process.wait(), timedOut=True, error='process timeout')
        except (OSError, subprocess.SubprocessError) as error:
            result.update(error=str(error), errorCode=getattr(error, 'errno', None))
        finally:
            if input_path:
                source.close()
    launch_bytes = (OUT / result['launch']).read_bytes()
    result['launchSha256'] = hashlib.sha256(launch_bytes).hexdigest()
    try:
        records = [json.loads(line) for line in launch_bytes.split(b'\n') if line]
        require(all(isinstance(row, dict) for row in records), 'malformed native launch record')
        result['launched'] = bool(records and records[0].get('stage') == 'started' and
                                  records[0].get('command') == command and records[0].get('uid') == 65534 and
                                  records[0].get('gid') == 65534 and type(records[0].get('namespacePid')) is int and
                                  records[0].get('namespacePid') == 1)
        if result['timedOut']:
            result['exitCode'] = None
        else:
            if records and records[-1].get('stage') == 'infrastructure':
                result.update(error=records[-1]['error'], errorCode=records[-1].get('errorCode'))
            require(result['wrapperExitCode'] == 0 and result['launched'] and len(records) == 2 and
                    records[1].get('stage') == 'completed' and type(records[1].get('exitCode')) is int,
                    'isolated launcher did not complete')
            result['exitCode'] = records[1]['exitCode']
    except (ValueError, TypeError, KeyError) as error:
        result.update(error=result['error'] or str(error), exitCode=None)
    result.update(stdoutSha256=sha(OUT / result['stdout']), stderrSha256=sha(OUT / result['stderr']),
                  elapsedSeconds=round(time.monotonic() - started, 4))
    return result


def complete(result, codes=(0,)):
    return result and result['error'] is None and not result['timedOut'] and type(result['exitCode']) is int and result['exitCode'] in codes


def grade(payload):
    checker = payload['checker']
    report = {'schemaVersion': 'RsiNativeCheckerWorker/v2', 'driven_by': 'agent',
              'actor': 'codex/rsi-native-checker-worker', 'caseId': payload['caseId'], 'modelRequests': 0,
              'workerSha256': sha(Path(__file__)), 'sourceSha256': payload['sourceSha256'],
              'checkerDigest': payload['checkerDigest'], 'profile': PROFILE, 'compiler': None,
              'compileError': None, 'failureClass': 'infrastructure', 'compiles': {}, 'results': [], 'binarySha256': {}}
    try:
        require(report['workerSha256'] == payload['workerSha256'], 'worker source drift')
        require(checker['schemaVersion'] == 'RsiStdioNativeChecker/v1' and checker['profile'] == PROFILE, 'checker profile drift')
        require(os.geteuid() == 0 and not Path('/mnt').exists(), 'outer worker isolation drift')
        version = subprocess.run(['g++', '--version'], capture_output=True, timeout=10, check=True)
        report['compiler'] = version.stdout.decode().splitlines()[0]
        require(report['compiler'] == checker['compilerVersion'], 'frozen checker compiler drift')
        require(sha(PAYLOAD / 'source.cpp') == payload['sourceSha256'], 'subject source drift')
        subject_root, checker_root = make_root('subject-root'), make_root('checker-root')
        for path, expected in checker['sourceFilesSha256'].items():
            relative(path)
            source = PAYLOAD / 'bundle' / path
            require(sha(source) == expected, 'private checker source drift')
            target = checker_root / 'bundle' / path
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
        reference = payload['sourceSha256'] == checker['referenceSha256']
        compile_root = checker_root if reference else subject_root
        shutil.copyfile(PAYLOAD / 'source.cpp', compile_root / 'work/source.cpp')
        include_dirs = checker['includeDirs'] + (checker['referenceIncludeDirs'] if reference else [])
        if not reference:
            include_dirs = []
        command = ['g++', *PROFILE['compilerFlags']]
        for directory in include_dirs:
            command += ['-I', '/bundle/' + relative(directory)]
        result = execute(compile_root, [*command, '/work/source.cpp', '-o', '/tmp/subject'], 'compile-subject',
                         PROFILE['compileTimeoutMs'])
        report['compiles']['subject'] = result
        if not complete(result):
            report.update(compileError='subject compilation did not complete',
                          failureClass='assertion' if result['exitCode'] == 1 and result['error'] is None else 'infrastructure')
            return report
        shutil.copyfile(compile_root / 'tmp/subject', subject_root / 'program')
        (subject_root / 'program').chmod(0o555)
        shutil.copyfile(subject_root / 'program', OUT / 'subject.binary')
        report['binarySha256']['subject.binary'] = sha(OUT / 'subject.binary')
        command = ['g++', *PROFILE['compilerFlags']]
        for directory in checker['includeDirs']:
            command += ['-I', '/bundle/' + relative(directory)]
        result = execute(checker_root, [*command, '/bundle/' + relative(checker['entryPath']), '-o', '/tmp/checker'],
                         'compile-checker', PROFILE['compileTimeoutMs'])
        report['compiles']['checker'] = result
        require(complete(result), 'private checker compilation did not complete')
        shutil.copyfile(checker_root / 'tmp/checker', OUT / 'checker.binary')
        report['binarySha256']['checker.binary'] = sha(OUT / 'checker.binary')
        report['failureClass'] = None
        for index, vector in enumerate(payload['vectors']):
            require(vector['index'] == index, 'vector order drift')
            input_path, expected_path = PAYLOAD / (str(index) + '.in'), PAYLOAD / (str(index) + '.expected')
            require(sha(input_path) == vector['inputSha256'] and sha(expected_path) == vector['expectedSha256'], 'official vector drift')
            row = {**vector, 'passed': False, 'checker': None}
            report['results'].append(row)
            result = execute(subject_root, ['/program'], 'subject-' + str(index), PROFILE['testTimeoutMs'], input_path)
            row['subject'] = result
            if not complete(result):
                infrastructure = not result['launched'] or (result['error'] is not None and not result['timedOut']) or \
                    result['exitCode'] == -signal.SIGKILL or (reference and result['timedOut'])
                report['failureClass'] = 'infrastructure' if infrastructure else 'assertion'
                if infrastructure:
                    return report
                continue
            for name, source in [('input', input_path), ('expected', expected_path), ('actual', OUT / result['stdout'])]:
                target = checker_root / 'private' / name
                shutil.copyfile(source, target)
            result = execute(checker_root, ['/tmp/checker', '/private/input', '/private/actual', '/private/expected'],
                             'checker-' + str(index), PROFILE['testTimeoutMs'])
            row['checker'] = result
            require(complete(result, (0, 1, 2)), 'private checker infrastructure failure')
            row['passed'] = result['exitCode'] == 0
            if not row['passed']:
                report['failureClass'] = 'assertion'
        return report
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        report.update(failureClass='infrastructure', compileError=str(error))
        return report


if __name__ == '__main__':
    if sys.argv[1:2] == ['--execute']:
        command = json.loads(sys.argv[4])
        with os.fdopen(int(sys.argv[5]), 'w', encoding='utf-8') as launch:
            def record(value):
                value = {'driven_by': 'agent', 'actor': 'codex/rsi-native-launcher', **value}
                launch.write(json.dumps(value) + '\n')
                launch.flush()
            try:
                enter_root(Path(sys.argv[2]), float(sys.argv[3]))
                require(os.getpid() == 1, 'child PID namespace missing')
                signal.signal(signal.SIGINT, signal.SIG_DFL)
                child = subprocess.Popen(command, stdin=sys.stdin.buffer, stdout=sys.stdout.buffer, stderr=sys.stderr.buffer,
                                         env={'PATH': '/usr/bin:/bin', 'HOME': '/tmp', 'TMPDIR': '/tmp', 'LC_ALL': 'C.UTF-8'},
                                         close_fds=True)
                record({'stage': 'started', 'command': command, 'uid': os.geteuid(), 'gid': os.getegid(), 'namespacePid': os.getpid()})
                record({'stage': 'completed', 'exitCode': child.wait()})
            except (OSError, ValueError, subprocess.SubprocessError) as error:
                record({'stage': 'infrastructure', 'error': str(error), 'errorCode': getattr(error, 'errno', None)})
                raise SystemExit(1)
        raise SystemExit(0)
    os.nice(10)
    result = grade(json.load(sys.stdin))
    (OUT / 'worker-report.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'status': result['failureClass'], 'caseId': result['caseId'], 'modelRequests': 0}))
