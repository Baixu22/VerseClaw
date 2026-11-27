"""Regression checks for mismatched serial test receipts."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from session_task_serial_validation import require_all_passed, require_step_files, require_step_result, verify_report


class SerialResultsTest(unittest.TestCase):
    def test_counts(self):
        good = dict(success=True, numTotalTests=2, numPassedTests=2,
                    numFailedTests=0, numPendingTests=0, numTodoTests=0)
        self.assertEqual(require_all_passed(good)['numPassedTests'], 2)
        for changes in [dict(numPassedTests=1, numTodoTests=1), dict(numTodoTests=1),
                        dict(numPassedTests=1, numPendingTests=1), dict(numFailedTests=1),
                        dict(numPassedTests=1), dict(numTodoTests=None),
                        dict(numTotalTests=0, numPassedTests=0), dict(success=False),
                        dict(numPassedTests=2.0)]:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                require_all_passed({**good, **changes})

    def test_file_coverage(self):
        expected = ['a.test.ts', 'b.test.ts']
        require_step_files([{'file': f} for f in expected], expected, complete=True)
        require_step_files([{'file': expected[0]}], expected, complete=False)
        for files in [['a.test.ts', 'a.test.ts'], ['a.test.ts'], ['a.test.ts', 'c.test.ts']]:
            with self.subTest(files=files), self.assertRaises(ValueError):
                require_step_files([{'file': f} for f in files], expected, complete=True)
        with self.assertRaises(ValueError):
            require_step_files([{'file': 'a.test.ts'}, {'file': 'a.test.ts'}], expected, complete=False)

    def test_receipt_identity_and_assertions(self):
        root = Path.cwd()
        step = {'file': 'a.test.ts', 'argv': ['node', 'vitest', 'run', 'a.test.ts']}
        result = dict(success=True, numTotalTests=1, numPassedTests=1, numFailedTests=0,
                      numPendingTests=0, numTodoTests=0,
                      testResults=[{'name': str(root / 'a.test.ts'), 'status': 'passed',
                                    'assertionResults': [{'status': 'passed'}]}])
        require_step_result(step, result, root)
        for key, value in [('name', str(root / 'b.test.ts')), ('status', 'failed'),
                           ('assertionResults', []), ('assertionResults', [{'status': 'todo'}])]:
            wrong = deepcopy(result)
            wrong['testResults'][0][key] = value
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                require_step_result(step, wrong, root)
        with self.assertRaises(ValueError):
            require_step_result({**step, 'argv': ['node', 'vitest', 'run', 'b.test.ts']}, result, root)

    def test_complete_report_rejects_same_count_receipt_substitution(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            plan = {'candidate': {'commit': 'candidate'}, 'root': directory,
                    'files': ['a.test.ts', 'b.test.ts'], 'expectedTests': 2}
            steps = []
            counts = dict(numTotalTests=1, numPassedTests=1, numFailedTests=0, numPendingTests=0, numTodoTests=0)
            for name in plan['files']:
                result = {**counts, 'success': True, 'testResults': [{'name': str(root / name), 'status': 'passed',
                           'assertionResults': [{'status': 'passed'}]}]}
                step = {'file': name, 'argv': ['node', 'vitest', 'run', name], 'tests': counts,
                        'exitCode': 0, 'resourceStop': None}
                for key, data in [('stdout', b''), ('stderr', b''), ('result', json.dumps(result).encode())]:
                    path = root / (name + '.' + key)
                    path.write_bytes(data)
                    step[key + 'Path'] = str(path)
                    step[key + 'Sha256'] = hashlib.sha256(data).hexdigest()
                steps.append(step)
            report = {'candidate': plan['candidate'], 'steps': steps}
            self.assertEqual(verify_report(report, plan)['numPassedTests'], 2)
            duplicate = deepcopy(report)
            duplicate['steps'][1] = deepcopy(duplicate['steps'][0])
            with self.assertRaises(ValueError):
                verify_report(duplicate, plan)
            substituted = deepcopy(report)
            for key in ('resultPath', 'resultSha256'):
                substituted['steps'][0][key] = substituted['steps'][1][key]
            with self.assertRaises(ValueError):
                verify_report(substituted, plan)
            stale_counts = deepcopy(report)
            stale_counts['steps'][0]['tests']['numPassedTests'] = 0
            with self.assertRaises(ValueError):
                verify_report(stale_counts, plan)


if __name__ == '__main__':
    unittest.main()
