"""Exercise complete archive intake and explicit reference/source binding."""
import io
import json
from pathlib import Path
import runpy
import stat
import tempfile
import unittest
from unittest.mock import patch
import warnings
import zipfile

ROOT = Path(__file__).resolve().parents[1]
M = runpy.run_path(str(ROOT / 'scripts/rsi-usaco-source-intake.py'))
BASE = M['M']
URL = 'https://usaco.org/'
FULL = '\n# Full credit\nprint(sum(map(int, input().split())))\n'


def fixture(root, extras=(), omit=(), problem=None):
    texts = {
        'results': '<a href="index.php?page=viewproblem2&amp;cpid=1347">Problem</a>'
                   '<a href="current/data/prob1_bronze_dec23.zip">Tests</a>'
                   '<a href="current/data/sol_prob1_bronze_dec23.html">Solution</a>',
        'problem': '<span id="probtext-text">Sum the given integers. '
                   '<span class="math">All numbers are integers.</span>'
                   '<h4>INPUT FORMAT (stdin):</h4>Read one line.'
                   '<h4>OUTPUT FORMAT (stdout):</h4>Print the sum.'
                   '<h4>SAMPLE INPUT:</h4><pre class="in">0 2\n</pre>'
                   '<h4>SAMPLE OUTPUT:</h4><pre class="out">2\n</pre></span>'
                   '<script>window.location="index.php?page=viewproblem2&cpid=1347&lang="; /*private*/</script>',
        'solution': '<pre>print(0) # partial credit</pre><pre>' + FULL + '</pre>',
    }
    urls = {'results': 'index.php?page=dec23results', 'problem': 'index.php?page=viewproblem2&cpid=1347',
            'solution': 'current/data/sol_prob1_bronze_dec23.html', 'tests': 'current/data/prob1_bronze_dec23.zip'}
    if problem is not None:
        texts['problem'] = problem
    for name, text in texts.items():
        (root / (name + '.html')).write_text(text, encoding='utf-8')
    with warnings.catch_warnings():
        warnings.simplefilter('ignore', UserWarning)
        with zipfile.ZipFile(root / 'tests.zip', 'w') as archive:
            for i in range(5):
                for suffix, body in [('in', f'{i} 2\r\n'), ('out', f'{i + 2}\r\n')]:
                    if f'{i}.{suffix}' not in omit:
                        archive.writestr(f'{i}.{suffix}', body)
            for name, body in extras:
                archive.writestr(name, body)
    plan = {'schemaVersion': 'RsiUsacoSourceIntakePlan/v1', 'driven_by': 'agent', 'executionMode': 'source-only',
            'officialVectorCount': 5,
            'sourceFilesSha256': {name: BASE['file_digest'](ROOT / name) for name in M['SOURCES']},
            'artifacts': {}, 'referenceSelection': {'preIndex': 1, 'runtime': 'python3',
            'purpose': 'full-credit-calibration', 'basis': 'Full credit section, after partial solution.',
            'sha256': BASE['digest'](FULL)}}
    for name, url in urls.items():
        path = root / (name + ('.zip' if name == 'tests' else '.html'))
        plan['artifacts'][name] = {'file': path.name, 'url': URL + url, 'sha256': BASE['file_digest'](path)}
    captured = {name: {'url': a['url'], 'sha256': a['sha256']} for name, a in plan['artifacts'].items()}
    capture = root / 'capture.json'
    capture.write_text(json.dumps({'schemaVersion': 'RsiUsacoSnapshotReceipt/v1', 'artifacts': captured}), encoding='utf-8')
    plan['snapshotReceipt'] = {'file': capture.name, 'sha256': BASE['file_digest'](capture)}
    return plan


def invoke(root, plan):
    path = root / 'plan.json'
    path.write_text(json.dumps(plan), encoding='utf-8')
    return M['inspect'](path, BASE['file_digest'](path), root / 'out')


class UsacoIntakeTests(unittest.TestCase):
    def test_problem_page_and_acquisition_record_independently_reject_mislabelled_sources(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            plan = fixture(root)
            page = root / 'problem.html'
            page.write_text(page.read_text(encoding='utf-8').replace('cpid=1347', 'cpid=1348'), encoding='utf-8')
            plan['artifacts']['problem']['sha256'] = BASE['file_digest'](page)
            with self.assertRaisesRegex(ValueError, 'page cpid'):
                invoke(root, plan)
            plan = fixture(root)
            archive = root / 'tests.zip'
            with zipfile.ZipFile(archive, 'a') as z:
                z.comment = b'other captured archive'
            plan['artifacts']['tests']['sha256'] = BASE['file_digest'](archive)
            with self.assertRaisesRegex(ValueError, 'acquisition receipt'):
                invoke(root, plan)

    def test_public_sample_pairs_use_order_and_do_not_cross_match(self):
        page = M['Page']('<span id="probtext-text"><h4>SAMPLE INPUT 1:</h4><pre>a</pre>'
                         '<h4>SAMPLE OUTPUT 1:</h4><pre>x</pre><pre class="in">b</pre><pre class="out">y</pre></span>')
        self.assertEqual(page.public_pairs(), {('a', 'x'), ('b', 'y')})
        with self.assertRaisesRegex(ValueError, 'unpaired'):
            M['Page']('<span id="probtext-text"><pre class="in">a</pre></span>').public_pairs()

    def test_captured_multi_answer_problem_cannot_self_approve_text_comparison(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            plan = fixture(root, problem='<span id="probtext-text">Given two integers in stdin, write them '
                           'to stdout in either order. Any valid order is accepted.</span>')
            plan['outputComparison'] = 'normalized-text'
            invoke(root, plan)
            row = json.loads((root / 'out/source-candidate.json').read_bytes())
            self.assertEqual(row['outputComparison'], 'pending')

    def test_keeps_all_vectors_and_explicit_full_reference_without_execution(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            result = invoke(root, fixture(root))
            row = json.loads((root / 'out/source-candidate.json').read_bytes())
            self.assertEqual(row['reference'], FULL)
            self.assertEqual(row['sourceIdentity'], 'usaco:1347')
            self.assertEqual((result['vectors'], result['distinctInputs']), (5, 5))
            self.assertEqual(row['vectors'][0]['input'], '0 2\r\n')
            self.assertEqual([v['visibility'] for v in row['vectors']], ['public', *['private'] * 4])
            self.assertEqual(row['outputComparison'], 'pending')
            self.assertNotIn('private', row['prompt'])
            self.assertIn('Print the sum.', row['prompt'])
            self.assertEqual((result['modelRequests'], result['executedPrograms']), (0, 0))
            self.assertFalse(result['formalAdmission'] or result['runnerCalibration'])
            self.assertFalse(result['referenceFullCreditVerified'])
            with self.assertRaisesRegex(ValueError, 'new output'):
                invoke(root, fixture(root))

    def test_snapshot_mutation_is_rejected(self):
        for key in ('results', 'problem', 'solution', 'tests'):
            with self.subTest(key=key), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                plan = fixture(root)
                with (root / plan['artifacts'][key]['file']).open('ab') as target:
                    target.write(b'changed')
                with self.assertRaisesRegex(ValueError, 'snapshot drift'):
                    invoke(root, plan)

    def test_replay_rebuilds_candidate_and_report_from_original_sources(self):
        for artifact, field, value in [('source-candidate.json', 'prompt', 'rewritten prompt'),
                                       ('source-candidate.json', 'reference', 'print(0)'),
                                       ('intake.json', 'formalAdmission', True),
                                       ('intake.json', 'vectors', 1)]:
            with self.subTest(artifact=artifact, field=field), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                invoke(root, fixture(root))
                plan = root / 'plan.json'
                row, receipt = M['replay'](plan, BASE['file_digest'](plan), root / 'out')
                self.assertEqual(row['sourceIdentity'], receipt['sourceIdentity'])
                target = root / 'out' / artifact
                changed = json.loads(target.read_bytes())
                changed[field] = value
                target.write_text(json.dumps(changed), encoding='utf-8')
                with self.assertRaisesRegex(ValueError, 'replay drift'):
                    M['replay'](plan, BASE['file_digest'](plan), root / 'out')

    def test_missing_official_output_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with self.assertRaisesRegex(ValueError, 'complete official'):
                invoke(root, fixture(root, omit=('4.out',)))

    def test_oversized_archive_is_rejected_before_reading_vectors(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            fixture(root)
            with patch.dict(M['official_pairs'].__globals__, {'LIMIT': 1}):
                with self.assertRaisesRegex(ValueError, 'exceeds intake bound'):
                    M['official_pairs'](root / 'tests.zip')

    def test_duplicate_traversal_and_link_archive_entries_are_rejected(self):
        symlink = zipfile.ZipInfo('link.in')
        symlink.create_system = 3
        symlink.external_attr = (stat.S_IFLNK | 0o777) << 16
        for name in ('0.in', '../outside.in', symlink):
            with self.subTest(name=str(name)), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                with self.assertRaisesRegex(ValueError, 'archive member'):
                    invoke(root, fixture(root, extras=((name, '0'),)))

    def test_unbounded_decompression_formats_are_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            fixture(root)
            with zipfile.ZipFile(root / 'tests.zip', 'w', compression=zipfile.ZIP_BZIP2) as archive:
                archive.writestr('0.in', '0\n')
                archive.writestr('0.out', '0\n')
            with self.assertRaisesRegex(ValueError, 'archive member'):
                M['official_pairs'](root / 'tests.zip')

    def test_full_reference_selection_must_be_explicit_and_byte_bound(self):
        for key, value in [('preIndex', 0), ('preIndex', -1), ('preIndex', True), ('preIndex', 9),
                           ('sha256', '0' * 64), ('purpose', 'already-verified'), ('basis', '')]:
            with self.subTest(key=key, value=value), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                plan = fixture(root)
                plan['referenceSelection'][key] = value
                with self.assertRaises(ValueError):
                    invoke(root, plan)

    def test_review_label_never_claims_reference_execution_success(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            plan = fixture(root)
            plan['referenceSelection']['preIndex'] = 0
            plan['referenceSelection']['sha256'] = BASE['digest']('print(0) # partial credit')
            result = invoke(root, plan)
            self.assertFalse(result['referenceFullCreditVerified'] or result['formalAdmission'])
            self.assertEqual(result['status'], 'pending-family-review-and-native-calibration')

    def test_runtime_and_frozen_archive_count_cannot_drift(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            plan = fixture(root)
            plan['referenceSelection']['runtime'] = 'cpp'
            with self.assertRaisesRegex(ValueError, r'C\+\+ main'):
                invoke(root, plan)
            plan['referenceSelection']['runtime'] = 'python3'
            plan['officialVectorCount'] = 6
            with self.assertRaisesRegex(ValueError, 'vector count drift'):
                invoke(root, plan)

    def test_adjacent_questions_and_foreign_contests_cannot_supply_resources(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            plan = fixture(root)
            results = root / 'results.html'
            with results.open('a', encoding='utf-8') as stream:
                stream.write('<a href="index.php?page=viewproblem2&amp;cpid=1348">Next</a>'
                             '<a href="current/data/prob2_bronze_dec23.zip">Tests</a>'
                             '<a href="current/data/sol_prob2_bronze_dec23.html">Solution</a>')
            plan['artifacts']['results']['sha256'] = BASE['file_digest'](results)
            for name in ('tests', 'solution'):
                plan['artifacts'][name]['url'] = plan['artifacts'][name]['url'].replace('prob1_', 'prob2_')
            with self.assertRaisesRegex(ValueError, 'test/solution binding'):
                invoke(root, plan)
            for name in ('tests', 'solution'):
                plan['artifacts'][name]['url'] = plan['artifacts'][name]['url'].replace('prob2_', 'prob1_')
            plan['artifacts']['results']['url'] = URL + 'index.php?page=jan23results'
            with self.assertRaisesRegex(ValueError, 'test/solution binding'):
                invoke(root, plan)

    def test_foreign_or_mismatched_artifact_urls_are_rejected(self):
        for key, url in [('problem', URL + 'index.php?page=viewproblem2&cpid=1348'),
                         ('tests', URL + 'current/data/prob2_bronze_dec23.zip'),
                         ('solution', 'https://example.org/solution.html')]:
            with self.subTest(key=key), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                plan = fixture(root)
                plan['artifacts'][key]['url'] = url
                with self.assertRaises(ValueError):
                    invoke(root, plan)

    def test_executor_and_plan_hashes_are_checked(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            plan = fixture(root)
            plan['sourceFilesSha256'][M['SOURCES'][0]] = '0' * 64
            with self.assertRaisesRegex(ValueError, 'executor drift'):
                invoke(root, plan)
            with self.assertRaises(ValueError):
                M['inspect'](root / 'plan.json', '0' * 64, root / 'out')

    def test_distinct_input_and_numeric_checker_gates_are_reused(self):
        for output in ('2\n', '2.1\n'):
            with self.subTest(output=output), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                plan = fixture(root)
                with zipfile.ZipFile(root / 'tests.zip', 'w') as archive:
                    for i in range(5):
                        archive.writestr(f'{i}.in', '0\n' if output == '2\n' else str(i))
                        archive.writestr(f'{i}.out', output)
                plan['artifacts']['tests']['sha256'] = BASE['file_digest'](root / 'tests.zip')
                with self.assertRaisesRegex(ValueError, 'distinct|numeric-checker'):
                    invoke(root, plan)


if __name__ == '__main__':
    unittest.main()
