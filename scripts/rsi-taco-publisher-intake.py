"""Index pinned TACO identities and explicitly selected vectors without executing submissions."""
import argparse
from collections import Counter
import json
from pathlib import Path
import runpy
import subprocess

ROOT = Path(__file__).resolve().parents[1]
BASE = runpy.run_path(str(ROOT / 'scripts/rsi-openr1-intake.py'))


def worker_projection(row):
    projected = dict(row)
    serialized_io_sha = BASE['digest'](row['input_output']) if isinstance(row.get('input_output'), str) else None
    try:
        io = json.loads(row['input_output'])
        if isinstance(io, dict) and not io.get('fn_name'):
            projected['input_output'] = io
        solutions = json.loads(row['solutions']) if isinstance(row['solutions'], str) else row['solutions']
        if isinstance(solutions, list):
            first = next((value for value in solutions if isinstance(value, str) and BASE['SPACE'].sub('', value)), None)
            projected['solutions'] = [first] if first is not None else []
    except (ValueError, TypeError, KeyError):
        pass
    return projected, serialized_io_sha


def inspect(sources, plan_path, plan_sha, output, identity_only=False, all_native=False):
    plan = BASE['checked_json'](plan_path, plan_sha)
    BASE['require'](plan['schemaVersion'] == 'RsiTacoPublisherIntakePlan/v1' and plan['modelRequests'] == 0,
                    'offline intake plan required')
    BASE['require'](not output.exists(), 'new output directory required')
    BASE['require'](plan.get('selection', {}).get('identityOnly', False) is identity_only,
                    'identity-only selection must be frozen in the plan')
    BASE['require'](plan.get('selection', {}).get('allNativeRecords', False) is all_native and
                    not (identity_only and all_native), 'all-native selection must be frozen separately')
    BASE['require'](subprocess.check_output(['node', '--version'], text=True).strip() == plan['nodeVersion'], 'Node version drift')
    for name, expected in plan['sourceFilesSha256'].items():
        BASE['require'](BASE['file_digest'](ROOT / name) == expected, 'source drift: ' + name)
    for shard in plan['shards']:
        BASE['require'](shard['nativeSplit'] in ('train', 'test') and
                        shard['path'].startswith('ALL/' + shard['nativeSplit'] + '-'), 'native split drift')
        path = sources / Path(shard['path']).name
        BASE['require'](path.stat().st_size == shard['bytes'] and BASE['file_digest'](path) == shard['sha256'],
                        'source shard drift: ' + shard['path'])
    BASE['require'](BASE['file_digest'](sources / 'README.md') == plan['datasetCardSha256'], 'dataset card drift')
    import pyarrow.parquet as pq
    output.mkdir(parents=True)
    counts, reasons, kinds, origins = Counter(), Counter(), Counter(), Counter()
    stderr_path = output / 'canonicalizer.stderr'
    error_log = stderr_path.open('xb')
    worker = subprocess.Popen(['node', '--max-old-space-size=384', str(ROOT / 'scripts/rsi-taco-record-index.mjs')] +
                              (['--identity-only'] if identity_only else []),
                              stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=error_log)
    index = output / ('identity-index.jsonl' if identity_only else 'record-index.jsonl')
    try:
        with index.open('x', encoding='utf-8', newline='\n') as target:
            for shard in plan['shards']:
                path = sources / Path(shard['path']).name
                selected, total = None, shard['rows']
                if not (identity_only or all_native or shard['nativeSplit'] == 'test'):
                    selected, total = set(), 0
                    for batch in pq.ParquetFile(path).iter_batches(batch_size=1, columns=['input_output']):
                        for row in batch.to_pylist():
                            try:
                                io = json.loads(row['input_output'])
                                if not io.get('fn_name') and any(isinstance(value, list) for value in
                                                                 io.get('inputs', []) + io.get('outputs', [])):
                                    selected.add(total)
                            except (ValueError, TypeError, AttributeError):
                                pass
                            total += 1
                    BASE['require'](total == shard['rows'], 'source row coverage drift')
                row_index = 0
                columns = ['question', 'source', 'name', 'url'] + ([] if identity_only else ['solutions', 'input_output'])
                for batch in pq.ParquetFile(path).iter_batches(batch_size=1, columns=columns):
                    for row in batch.to_pylist():
                        current = row_index
                        row_index += 1
                        if selected is not None and current not in selected:
                            continue
                        source_projection_sha = BASE['digest'](BASE['compact']({
                            'row': row, 'revision': plan['revision'], 'shard': shard['path'], 'rowIndex': current}))
                        projected, serialized_io_sha = (row, None) if identity_only else worker_projection(row)
                        payload = BASE['compact']({'row': projected, 'revision': plan['revision'],
                                                   'shard': shard['path'], 'rowIndex': current,
                                                   'serializedIoSha256': serialized_io_sha})
                        worker.stdin.write((payload + '\n').encode('utf-8'))
                        worker.stdin.flush()
                        response = worker.stdout.readline()
                        if not response:
                            raise RuntimeError('canonicalization worker exited; see ' + str(stderr_path))
                        meta = json.loads(response)
                        BASE['require'](meta['upstreamId'] == f"taco:{shard['path']}#{current}", 'worker identity drift')
                        BASE['require'](isinstance(meta['sourceIdentity'], str) and meta.get('sourceIdentityEvidence') in
                                        ('upstream-url', 'source-name', 'pinned-row'), 'worker source identity drift')
                        meta.update(nativeSplit=shard['nativeSplit'], promptDigest=BASE['prompt_key'](row['question'] or '')[2:],
                                    sourceProjectionSha256=source_projection_sha)
                        target.write(BASE['compact'](meta) + '\n')
                        counts[shard['nativeSplit'] + ':rows'] += 1
                        origins[meta['source'] or 'unknown'] += 1
                        if identity_only:
                            BASE['require'](meta['eligible'] is False and meta['referenceShape'] is None,
                                            'identity-only worker admitted a record')
                        elif meta['eligible']:
                            counts[shard['nativeSplit'] + ':eligible'] += 1
                        else:
                            reasons[shard['nativeSplit'] + ':' + meta['rejection']] += 1
                        if not identity_only:
                            kinds[shard['nativeSplit'] + ':' + meta.get('kind', 'unparsed')] += 1
                BASE['require'](row_index == total, 'canonical record coverage drift')
                print(json.dumps({'shard': shard['path'], 'scanned': total,
                                  'selected': total if selected is None else len(selected)}), flush=True)
        worker.stdin.close()
        BASE['require'](worker.wait(timeout=30) == 0, 'canonicalization worker failed')
    except Exception as error:
        if worker.poll() is None:
            worker.stdin.close()
            worker.wait(timeout=30)
        error_log.flush()
        BASE['write_report'](output / 'failure.json', {
            'schemaVersion': 'RsiTacoPublisherIntakeFailure/v1', 'driven_by': 'agent',
            'actor': 'codex/rsi-taco-publisher-intake', 'realHumanEvidence': False, 'modelRequests': 0,
            'status': 'infrastructure', 'planSha256': plan_sha, 'error': str(error),
            'workerExitCode': worker.returncode, 'partialCounts': dict(counts),
            'partialIndexSha256': BASE['file_digest'](index) if index.exists() else None,
            'stderrSha256': BASE['file_digest'](stderr_path)})
        raise
    finally:
        if worker.poll() is None:
            worker.stdin.close()
            worker.wait(timeout=30)
        error_log.close()
    report = {'schemaVersion': 'RsiTacoPublisherIdentityIntake/v2' if identity_only else
                              'RsiTacoPublisherIntake/v2' if all_native else 'RsiTacoPublisherIntake/v1', 'driven_by': 'agent',
              'actor': 'codex/rsi-taco-publisher-intake', 'realHumanEvidence': False, 'modelRequests': 0,
              'planSha256': plan_sha, 'sourceFilesSha256': plan['sourceFilesSha256'],
              'workerExitCode': worker.returncode, 'stderrSha256': BASE['file_digest'](stderr_path),
              'identityIndexSha256' if identity_only else 'recordIndexSha256': BASE['file_digest'](index),
              'rows': sum(counts[key] for key in counts if key.endswith(':rows')),
              'selection': {'identityOnly': identity_only, 'allNativeRecords': all_native},
              'sourceIdentityContract': 'native-url-source-name-or-pinned-row',
              'workerTransport': 'parsed-string-vectors-with-original-serialization-digest',
              'counts': dict(counts), 'kinds': dict(kinds),
              'rejections': dict(reasons), 'sources': dict(origins), 'formalAdmission': False, 'runnerCalibration': False}
    BASE['write_report'](output / 'intake.json', report)
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sources', type=Path, required=True)
    parser.add_argument('--plan', type=Path, required=True)
    parser.add_argument('--plan-sha256', required=True)
    parser.add_argument('--output-directory', type=Path, required=True)
    parser.add_argument('--identity-only', action='store_true', help='Index every native prompt and URL; admit no rows.')
    parser.add_argument('--all-native-records', action='store_true', help='Screen all native rows under a separate frozen selection.')
    args = parser.parse_args()
    inspect(args.sources, args.plan, args.plan_sha256, args.output_directory, args.identity_only, args.all_native_records)
