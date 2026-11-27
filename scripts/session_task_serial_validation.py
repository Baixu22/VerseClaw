"""Validate serial test receipts before reusing or accepting their results."""
import argparse
import hashlib
import json
from pathlib import Path

COUNT_FIELDS = ('numTotalTests', 'numPassedTests', 'numFailedTests', 'numPendingTests', 'numTodoTests')


def require_all_passed(result):
    counts = {key: result.get(key) for key in COUNT_FIELDS}
    if (result.get('success') is not True
            or any(type(value) is not int or value < 0 for value in counts.values())
            or counts['numTotalTests'] <= 0
            or counts['numPassedTests'] != counts['numTotalTests']
            or any(counts[key] != 0 for key in COUNT_FIELDS[2:])):
        raise ValueError('Incomplete or inconsistent test counts')
    return counts


def require_step_files(steps, expected_files, *, complete):
    files = [step['file'] for step in steps]
    if (not expected_files or len(set(expected_files)) != len(expected_files)
            or len(set(files)) != len(files) or not set(files) <= set(expected_files)
            or complete and set(files) != set(expected_files)):
        raise ValueError('Missing, duplicate or unexpected test files')


def require_step_result(step, result, root):
    counts = require_all_passed(result)
    argv = step['argv']
    if 'run' not in argv or argv[argv.index('run') + 1:argv.index('run') + 2] != [step['file']]:
        raise ValueError('Command does not match the test file')
    suites = result.get('testResults', [])
    if len(suites) != 1 or Path(suites[0]['name']).resolve() != (Path(root) / step['file']).resolve():
        raise ValueError('Result does not match the test file')
    assertions = suites[0].get('assertionResults', [])
    if (suites[0].get('status') != 'passed' or len(assertions) != counts['numTotalTests']
            or any(item.get('status') != 'passed' for item in assertions)):
        raise ValueError('Assertions do not match the passing counts')
    return counts


def verify_report(report, plan):
    if report['candidate'] != plan['candidate']:
        raise ValueError('Candidate differs from the verification plan')
    require_step_files(report['steps'], plan['files'], complete=True)
    counts = dict.fromkeys(COUNT_FIELDS, 0)
    for step in report['steps']:
        if step['exitCode'] != 0 or step.get('resourceStop'):
            raise ValueError('Test execution failed')
        for key in ('stdout', 'stderr', 'result'):
            if hashlib.sha256(Path(step[key + 'Path']).read_bytes()).hexdigest() != step[key + 'Sha256']:
                raise ValueError('Receipt hash differs: ' + key)
        result = json.loads(Path(step['resultPath']).read_text(encoding='utf-8'))
        actual = require_step_result(step, result, plan['root'])
        if step['tests'] != actual:
            raise ValueError('Recorded counts differ from the original result')
        for key in COUNT_FIELDS:
            counts[key] += actual[key]
    require_all_passed({'success': True, **counts})
    if counts['numTotalTests'] != plan['expectedTests']:
        raise ValueError('Total differs from the verification plan')
    return counts


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--report', type=Path, required=True)
    parser.add_argument('--plan', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    report = json.loads(args.report.read_text(encoding='utf-8'))
    plan = json.loads(args.plan.read_text(encoding='utf-8'))
    counts = verify_report(report, plan)
    output = {'driven_by': 'agent', 'actor': 'session-task-serial-validator', 'status': 'passed',
              'testCandidate': report['candidate'], 'counts': counts, 'files': len(report['steps']),
              'reportSha256': hashlib.sha256(args.report.read_bytes()).hexdigest(),
              'planSha256': hashlib.sha256(args.plan.read_bytes()).hexdigest(),
              'validatorSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), 'testsRerun': 0}
    with args.output.open('x', encoding='utf-8') as stream:
        json.dump(output, stream, indent=2)
        stream.write('\n')
    print(json.dumps(output))
