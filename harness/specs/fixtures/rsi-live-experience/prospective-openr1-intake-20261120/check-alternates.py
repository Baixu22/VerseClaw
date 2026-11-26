"""Check the two digest-locked alternate C++ submissions on their original official vectors."""
import argparse
import json
from pathlib import Path
import runpy
import subprocess
import sys
import tempfile
import time

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[4]
intake = runpy.run_path(str(ROOT / 'scripts/rsi-openr1-intake.py'))
sha = intake['file_digest']
require = intake['require']
WORKER = ROOT / 'scripts/rsi-stdio-wsl-runner.py'
WORKER_SHA = '3af074f9fba5d6ff6e1a0e97415100acc98b7074219f9c6ec9ed94a6ab4dad5c'
DELTA_SHA = 'c2bed424bbddaae5a50367a646c69fc2813a25a4bcd5d4638aba8be15caa0cea'
COMPILER = 'g++ (Ubuntu 11.4.0-1ubuntu1~22.04.3) 11.4.0'
CONTROL = 'int main() { return 0; }\n'
# WSL requires sudo for bind mounts; candidate processes run unprivileged inside the chroot.
JAIL = '''set -eu
root=$(mktemp -d /tmp/rsi-oracle.XXXXXXXX)
trap 'cd /; umount -R "$root"; rmdir "$root"' EXIT
mount -t tmpfs -o size=256m tmpfs "$root"
mkdir -p "$root/usr" "$root/tmp" "$root/work" "$root/dev" "$root/etc" "$root/proc"
chmod 1777 "$root/tmp"
mount --bind /usr "$root/usr"; mount -o remount,bind,ro "$root/usr"
mount -t proc proc "$root/proc"
for dir in bin lib lib64 sbin; do ln -s "usr/$dir" "$root/$dir"; done
touch "$root/dev/null"; mount --bind /dev/null "$root/dev/null"
cp -- "$1" "$root/work/case.cpp"; cp -- "$2" "$root/work/worker.py"
chmod 0555 "$root/work"
cd "$root"
chroot . /usr/bin/setpriv --reuid=65534 --regid=65534 --clear-groups \
 --no-new-privs --bounding-set=-all --inh-caps=-all --ambient-caps=-all \
 /usr/bin/env -i PATH=/usr/bin:/bin HOME=/tmp TMPDIR=/tmp LC_ALL=C.UTF-8 \
 /usr/bin/prlimit --as=1073741824 --cpu=90 --nofile=128 --nproc=32 -- /usr/bin/python3 /work/worker.py \
 --source /work/case.cpp --shim /work --compiler g++ --compiler-version "$3" --timeout-ms 10000
'''


def wsl_path(windows_path):
    path = windows_path.resolve()
    return '/mnt/' + path.drive[0].lower() + '/' + '/'.join(path.parts[1:])


def summarize(stdout, vectors):
    report = json.loads(stdout)
    require(isinstance(report, dict) and report.get('compiler') == COMPILER and
            report.get('stage') == 'tests' and report.get('compileError') is None,
            'native compilation did not complete with the frozen toolchain')
    require(isinstance(report.get('results'), list) and len(report['results']) == len(vectors),
            'native result count mismatch')
    normalize = lambda s: '\n'.join(line.rstrip() for line in s.replace('\r\n', '\n').replace('\r', '\n').split('\n')).strip()
    results = []
    for i, (r, vector) in enumerate(zip(report['results'], vectors, strict=True)):
        require(isinstance(r, dict) and type(r.get('timedOut')) is bool and
                (type(r.get('exitCode')) is int or r.get('exitCode') is None) and
                (r.get('error') is None or isinstance(r['error'], str)) and
                isinstance(r.get('stdout'), str) and isinstance(r.get('stderr'), str),
                'malformed native test result')
        require(r['exitCode'] is not None or r['timedOut'], 'native test has no exit status')
        results.append({'index': i, 'exitCode': r['exitCode'], 'timedOut': r['timedOut'], 'error': r['error'],
                        'stdoutSha256': intake['digest'](r['stdout']),
                        'passed': r['exitCode'] == 0 and not r['timedOut'] and r['error'] is None and
                                  normalize(r['stdout']) == normalize(vector['output'])})
    passed = bool(results) and all(r['passed'] for r in results)
    return {'status': 'passed' if passed else 'rejected', 'results': results, 'passed': passed}


def classify(stdout, vectors, execution):
    if execution['exitCode'] != 0 or execution['error'] is not None:
        return {'status': 'infrastructure', 'results': [], 'passed': False,
                'reason': execution['error'] or 'isolated runner exited unsuccessfully'}
    try:
        return summarize(stdout, vectors)
    except (ValueError, TypeError, KeyError) as error:
        return {'status': 'infrastructure', 'results': [], 'passed': False, 'reason': str(error)}


def grade(source, vectors, folder, log_prefix):
    path = folder / 'case.cpp'
    path.write_bytes(source.encode())
    budget = 90 + 10 * len(vectors)
    args = ['wsl.exe', '-d', 'Ubuntu-22.04', '--exec', 'sudo', '-n', 'timeout', '--kill-after=5s',
            str(budget) + 's', 'unshare', '--kill-child', '--mount',
            '--propagation', 'private', '--net', '--pid', '--fork', 'sh', '-c', JAIL, 'rsi',
            wsl_path(path), wsl_path(WORKER), COMPILER]
    started = time.monotonic()
    stdout, stderr = b'', b''
    execution = {'exitCode': None, 'error': None, 'errorCode': None, 'timeoutSeconds': budget + 10}
    try:
        run = subprocess.run(args, input=json.dumps([{'input': t['input']} for t in vectors]).encode(),
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=budget + 10)
        stdout, stderr = run.stdout, run.stderr
        execution['exitCode'] = run.returncode
    except subprocess.TimeoutExpired as error:
        stdout, stderr = error.stdout or b'', error.stderr or b''
        execution['error'] = 'isolated runner timed out'
    except OSError as error:
        execution['error'] = str(error)
        execution['errorCode'] = getattr(error, 'winerror', None) or error.errno
    execution['elapsedMs'] = round((time.monotonic() - started) * 1000)
    execution['logs'] = {}
    for stream, raw in (('stdout', stdout), ('stderr', stderr)):
        log = log_prefix.with_name(log_prefix.name + '.' + stream)
        with log.open('xb') as f:
            f.write(raw)
        execution['logs'][stream] = {'file': log.name, 'sha256': sha(log), 'bytes': len(raw)}
    return {**classify(stdout, vectors, execution), 'execution': execution}


def load_targets(openr1, cc):
    require(sha(WORKER) == WORKER_SHA, 'native worker digest mismatch')
    targets = [r for r in intake['checked_rows'](HERE / 'codecontests-delta.jsonl', DELTA_SHA) if r['tier'] == 'alternateReference']
    require(len(targets) == 2, 'alternate count drift')
    source_manifest = intake['checked_json'](intake['MANIFEST'], intake['MANIFEST_SHA'])
    sub, = [r for r in source_manifest if r['repo'] == 'codeforces-submissions']
    require(sha(openr1 / sub['name']) == sub['sha256'], 'submission shard drift')
    receipt_dir = intake['CC_RECEIPTS'] / 'admission-mixed-20261115'
    audit = intake['checked_json'](receipt_dir / 'runner-audit-mixed.json', intake['CC_AUDIT_SHA'])
    manifest = intake['checked_json'](receipt_dir / 'audit-inputs-mixed-manifest.json', audit['sourceIdentity']['auditInputsManifestSha256'])
    chunks = {x['file']: x['sha256'] for x in manifest['chunks']}
    wanted = {r['reference']['row'] for r in targets}
    submissions = {i: v for i, v in enumerate(intake['rows'](openr1, sub['name'], ['problem_id', 'submission_id', 'source'])) if i in wanted}
    verified = []
    for target in targets:
        ref = target['reference']; v = submissions[ref['row']]; chunk = target['auditChunk']
        item, = [x for i, x in enumerate(intake['checked_rows'](cc / 'audit-inputs-mixed' / chunk, chunks[chunk])) if i == target['auditRow']]
        vectors = intake['official_subset'](item['tests'])
        require(str(v['submission_id']) == str(ref['submissionId']) and v['problem_id'] == ref['origin'] and
                intake['digest'](v['source']) == ref['sha256'] and item['familyId'] == target['familyId'] and
                intake['digest'](intake['compact'](vectors)) == target['officialSubsetSha256'], 'alternate reference/oracle drift')
        require(ref['runtime'] == 'cpp' and ref['sha256'] != target['originalReferenceSha256'] and
                intake['vector_issue'](vectors) is None, 'alternate execution contract mismatch')
        verified.append((target, v['source'], vectors))
    return verified, {'sourceManifestSha256': intake['MANIFEST_SHA'], 'submissionShardSha256': sub['sha256'],
                      'historicalAuditSha256': intake['CC_AUDIT_SHA'],
                      'auditInputsManifestSha256': audit['sourceIdentity']['auditInputsManifestSha256'],
                      'nativeWorkerSha256': WORKER_SHA, 'deltaIndexSha256': DELTA_SHA,
                      'checkerSha256': sha(Path(__file__)), 'intakeScriptSha256': sha(ROOT / 'scripts/rsi-openr1-intake.py')}


def evaluate(verified, run_grade):
    cases = []
    for i, (target, source, vectors) in enumerate(verified):
        control = run_grade(i, 'control', CONTROL, vectors)
        case = {'familyId': target['familyId'], 'origin': target['origin'], 'originalVerdict': target['originalVerdict'],
                'referenceSha256': target['reference']['sha256'], 'officialSubsetSha256': target['officialSubsetSha256'],
                'vectors': len(vectors), 'distinctInputs': target['officialDistinctInputs'],
                'noOutputControl': control, 'reference': None, 'qualified': False}
        cases.append(case)
        clean_control = control['status'] == 'rejected' and all(
            r['exitCode'] == 0 and not r['timedOut'] and r['error'] is None and
            r['stdoutSha256'] == intake['digest']('') for r in control['results'])
        if not clean_control:
            case.update(status='infrastructure', reason='no-output control did not complete and reject the oracle')
            break
        reference = run_grade(i, 'reference', source, vectors)
        case.update(reference=reference, status=reference['status'], qualified=reference['status'] == 'passed')
        if reference['status'] == 'infrastructure':
            break
    return cases


def make_report(verified, bindings, cases, logs):
    infrastructure = any(c['status'] == 'infrastructure' for c in cases)
    out = {'schemaVersion': 'RsiAlternateReferenceCheck/v1', 'driven_by': 'agent', 'actor': 'codex/rsi-openr1-intake',
           'realHumanEvidence': False, 'modelRequests': 0, 'formalAdmission': False, 'compiler': COMPILER,
           'status': 'infrastructure' if infrastructure else 'complete', 'bindings': bindings,
           'nativeWorkerSha256': WORKER_SHA, 'deltaIndexSha256': DELTA_SHA, 'controlSha256': intake['digest'](CONTROL),
           'logsDirectory': logs, 'qualifiedAlternates': sum(c['qualified'] for c in cases),
           'notRunFamilies': [target['familyId'] for target, _, _ in verified[len(cases):]], 'cases': cases}
    return out


def replay(openr1, cc, output):
    logs = output.with_suffix('.logs')
    require(not output.exists() and not logs.exists(), 'new output file and log directory required')
    verified, bindings = load_targets(openr1, cc)
    logs.mkdir()
    with tempfile.TemporaryDirectory(prefix='rsi-alternate-') as tmp:
        cases = evaluate(verified, lambda i, role, source, vectors:
                         grade(source, vectors, Path(tmp), logs / f'{i:02}-{role}'))
    out = make_report(verified, bindings, cases, logs.name)
    intake['write_report'](output, out)
    print(json.dumps({'status': out['status'], 'qualifiedAlternates': out['qualifiedAlternates'],
                      'report': str(output), 'sha256': sha(output)}))
    return out


def check(openr1, cc, output, report_sha):
    require(isinstance(report_sha, str) and len(report_sha) == 64, 'retained report SHA-256 required')
    retained = intake['checked_json'](output, report_sha)
    verified, bindings = load_targets(openr1, cc)
    logs = output.with_suffix('.logs')

    def read_grade(i, role, source, vectors):
        case = retained['cases'][i]
        receipt = case['noOutputControl' if role == 'control' else 'reference']
        execution = receipt['execution']
        for stream in ('stdout', 'stderr'):
            artifact = execution['logs'][stream]
            name = f'{i:02}-{role}.{stream}'
            require(artifact['file'] == name, 'raw log filename mismatch')
            path = logs / name
            require(path.stat().st_size == artifact['bytes'] and sha(path) == artifact['sha256'], 'raw log digest mismatch')
        replayed = {**classify((logs / f'{i:02}-{role}.stdout').read_bytes(), vectors, execution), 'execution': execution}
        require(replayed == receipt, 'retained grade does not reproduce')
        return replayed

    cases = evaluate(verified, read_grade)
    require(make_report(verified, bindings, cases, logs.name) == retained, 'alternate report binding or verdict mismatch')
    print(json.dumps({'status': 'verified', 'executionStatus': retained['status'],
                      'qualifiedAlternates': retained['qualifiedAlternates'], 'modelRequests': 0}))
    return retained


if __name__ == '__main__':
    cli = argparse.ArgumentParser(description=__doc__)
    for name in ('openr1', 'codecontests', 'output'):
        cli.add_argument('--' + name, type=Path, required=True)
    cli.add_argument('--check', action='store_true', help='Replay retained logs without executing submissions')
    cli.add_argument('--report-sha256', help='Original report digest required by --check')
    args = cli.parse_args()
    report = check(args.openr1, args.codecontests, args.output, args.report_sha256) if args.check else replay(args.openr1, args.codecontests, args.output)
    sys.exit(1 if report['status'] == 'infrastructure' else 0)
