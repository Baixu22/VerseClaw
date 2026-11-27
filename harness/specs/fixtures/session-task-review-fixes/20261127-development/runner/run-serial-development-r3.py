from pathlib import Path
from datetime import datetime
import hashlib
import json
import os
import re
import subprocess
import time
import psutil

COUNT_FIELDS = ['numTotalTests', 'numPassedTests', 'numFailedTests', 'numPendingTests', 'numTodoTests']

def require_all_passed(result):
    counts = {key: result.get(key) for key in COUNT_FIELDS}
    if (result.get('success') is not True
        or any(type(value) is not int or value < 0 for value in counts.values())
        or counts['numTotalTests'] <= 0
        or counts['numPassedTests'] != counts['numTotalTests']
        or any(counts[key] != 0 for key in ['numFailedTests', 'numPendingTests', 'numTodoTests'])):
        raise ValueError('Incomplete or inconsistent test result: ' + str(counts))
    return counts

raw = Path(__file__).parent
out = raw / 'development-serial-r3'
root = Path('D:/ClawX-work/session-task-review-fixes-20261125-01a21019')
out.mkdir(exist_ok=True)
report_path = out / 'report.json'
assert not report_path.exists(), 'Preserve existing results; use a fresh output for a new attempt'
def git(*args):
    return subprocess.check_output(['git', *args], cwd=root, text=True).strip()
def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()
candidate = {'commit': git('rev-parse', 'HEAD'), 'tree': git('rev-parse', 'HEAD^{tree}')}
previous = json.loads((raw / 'r1/unit-results.json').read_text(encoding='utf-8'))
files = [Path(item['name']).relative_to(root).as_posix() for item in previous['testResults']]
scope = 'tests/unit/session-task-scope-completion.test.ts'
files.remove(scope)
files.insert(0, scope)
config = (raw / 'vitest-r1.config.mts').read_text(encoding='utf-8')
config = config.replace('/r1/', '/development-serial-r3/')
config_path = out / 'vitest.config.mts'
config_path.write_text(config, encoding='utf-8')
sources = json.loads((raw / 'plan-r2.json').read_text(encoding='utf-8'))['sources']
for source in sources:
    source['sha256'] = digest(root / source['path'])
    source['gitBlob'] = git('rev-parse', 'HEAD:' + source['path'])
report = {'schema': 'session-task-serial-development/v1', 'driven_by': 'agent', 'actor': 'codex/tf0950-relay',
    'candidate': candidate, 'sources': sources, 'configSha256': digest(config_path), 'runnerSha256': digest(Path(__file__)),
    'expectedTests': previous['numTotalTests'], 'files': files, 'steps': [], 'status': 'running',
    'limits': {'maxWorkers': 1, 'nodeHeapMiB': 384, 'treeRssCeilingMiB': 896, 'cpuAffinityCount': 1, 'memoryPressureFloorMiB': 384, 'timeoutSecondsPerFile': 240},
    'startedAt': datetime.now().astimezone().isoformat(), 'heavyAcceptance': 'deferred_by_user'}
def save():
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
def verify():
    assert git('rev-parse', 'HEAD') == candidate['commit']
    assert not git('status', '--porcelain', '--untracked-files=no')
    for source in sources:
        assert digest(root / source['path']) == source['sha256'], source['path']
env = {**os.environ, 'TEMP': 'D:/tmp', 'TMP': 'D:/tmp', 'TMPDIR': 'D:/tmp', 'NODE_OPTIONS': '--max-old-space-size=384',
       'CLAWX_SESSION_TASK_REVIEW_METRICS_DIR': str(out / 'metrics'), 'VITEST_MAX_WORKERS': '1', 'UV_THREADPOOL_SIZE': '1'}
assert not Path(env['CLAWX_SESSION_TASK_REVIEW_METRICS_DIR']).exists(), 'Exercise automatic metrics directory creation'
retained_path = raw / 'development-serial-r2/report.json'
retained = json.loads(retained_path.read_text(encoding='utf-8'))
assert retained['candidate'] == candidate and retained['sources'] == sources
completed_files = []
for step in retained['steps']:
    assert step['exitCode'] == 0 and not step['resourceStop']
    for field in ['stdout', 'stderr', 'result']:
        assert digest(Path(step[field + 'Path'])) == step[field + 'Sha256']
    value = json.loads(Path(step['resultPath']).read_text(encoding='utf-8'))
    require_all_passed(value)
    step['tests'] = require_all_passed(value)
    for item in step['observedProcesses']:
        try:
            assert abs(psutil.Process(item['pid']).create_time() - item['createdAt']) >= .001
        except psutil.NoSuchProcess:
            pass
    completed_files.append(step['file'])
report['steps'] = retained['steps'].copy()
report['retainedReport'] = {'path': str(retained_path), 'sha256': digest(retained_path), 'originalStatus': retained['status'], 'observedProcessesNowExited': True}
report['metricsDirectory'] = retained['metricsDirectory']
files = [file for file in files if file not in completed_files]
psutil.Process().nice(psutil.BELOW_NORMAL_PRIORITY_CLASS)
psutil.Process().cpu_affinity([psutil.Process().cpu_affinity()[-1]])
save()
try:
    verify()
    for index, file in enumerate(files):
        verify()
        available = psutil.virtual_memory().available / 1048576
        if available < 1024:
            raise RuntimeError(f'Need 1024 MiB before one bounded file; observed {available:.0f} MiB')
        name = f'{index + 1:02d}-' + Path(file).stem
        stdout_path, stderr_path, results_path = [out / (name + suffix) for suffix in ['.stdout.txt', '.stderr.txt', '.json']]
        command = ['C:/Program Files/nodejs/node.exe', '--max-old-space-size=384', 'node_modules/vitest/vitest.mjs',
                   'run', file, '--config', str(config_path), '--outputFile.json=' + str(results_path)]
        start = time.time()
        peak = 0
        processes = {}
        stopped = None
        with stdout_path.open('wb') as stdout, stderr_path.open('wb') as stderr:
            child = subprocess.Popen(command, cwd=root, env=env, stdout=stdout, stderr=stderr, creationflags=subprocess.CREATE_NO_WINDOW | subprocess.BELOW_NORMAL_PRIORITY_CLASS)
            while child.poll() is None:
                try:
                    parent = psutil.Process(child.pid)
                    members = [parent, *parent.children(recursive=True)]
                except psutil.NoSuchProcess:
                    members = []
                usage = 0
                for p in members:
                    try:
                        processes[(p.pid, p.create_time())] = p
                        usage += p.memory_info().rss / 1048576
                    except psutil.NoSuchProcess:
                        pass
                peak = max(peak, usage)
                free = psutil.virtual_memory().available / 1048576
                if usage > 896 or free < 384 or time.time() - start > 240:
                    stopped = {'treeRssMiB': round(usage, 2), 'availableMiB': round(free, 2), 'elapsedSeconds': round(time.time() - start, 2)}
                    for p in reversed(members):
                        try: p.kill()
                        except psutil.NoSuchProcess: pass
                    child.wait()
                    break
                time.sleep(0.2)
        psutil.wait_procs(list(processes.values()), timeout=5)
        live = []
        for (pid, created), p in processes.items():
            try:
                if p.is_running() and abs(psutil.Process(pid).create_time() - created) < 0.001:
                    live.append(pid)
            except psutil.NoSuchProcess:
                pass
        result = json.loads(results_path.read_text(encoding='utf-8')) if results_path.exists() else None
        step = {'file': file, 'argv': command, 'exitCode': child.returncode, 'seconds': round(time.time() - start, 2),
                'peakTreeRssMiB': round(peak, 2), 'availableMiBBefore': round(available, 2), 'resourceStop': stopped,
                'stdoutPath': str(stdout_path), 'stdoutSha256': digest(stdout_path), 'stderrPath': str(stderr_path), 'stderrSha256': digest(stderr_path),
                'resultPath': str(results_path), 'resultSha256': digest(results_path) if result else None,
                'tests': {key: result[key] for key in COUNT_FIELDS} if result else None,
                'observedProcesses': [{'pid': pid, 'createdAt': created} for pid, created in processes], 'liveProcessIdsAfter': live}
        report['steps'].append(step)
        save()
        print(json.dumps({'file': file, 'exitCode': child.returncode, 'tests': step['tests'], 'peakTreeRssMiB': step['peakTreeRssMiB']}, ensure_ascii=False), flush=True)
        verify()
        assert child.returncode == 0 and result and not stopped and not live, f'File needs attention: {file}'
        require_all_passed(result)
    counts = {key: sum(step['tests'][key] for step in report['steps']) for key in COUNT_FIELDS}
    require_all_passed({'success': True, **counts})
    assert counts['numTotalTests'] == report['expectedTests']
    verify()
    report['counts'] = counts
    report['status'] = 'passed'
except Exception as error:
    report['status'] = 'failed'
    report['error'] = str(error)
    raise
finally:
    report['endedAt'] = datetime.now().astimezone().isoformat()
    save()
