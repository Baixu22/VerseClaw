"""Check isolated calibration packs retain every original vector and exclude old families."""
import gzip
import json
from pathlib import Path
import runpy
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
P = runpy.run_path(str(ROOT / 'scripts/rsi-usaco-measurement.py'))
F = P['F']
M = P['M']
U = runpy.run_path(str(ROOT / 'scripts/rsi-usaco-source-intake-test.py'))


def fixture(root, test):
    plan = U['fixture'](root)
    captured = json.loads((root / 'capture.json').read_bytes())['artifacts']
    contracts = root / 'reviewed.json'
    contracts.write_text(json.dumps({'usaco:1347': {'artifacts': captured, 'comparison': 'normalized-text'}}), encoding='utf-8')
    for importer in (U['M'], P['U']):
        binding = patch.dict(importer['build_candidate'].__globals__, {'CONTRACTS': str(contracts)})
        binding.start()
        test.addCleanup(binding.stop)
    U['invoke'](root, plan)
    row = json.loads((root / 'out/source-candidate.json').read_bytes())
    manifest = {'schemaVersion': 'RsiUsacoFamilyReviewPlan/v1', 'driven_by': 'agent',
                'candidates': [{'plan': str(root / 'plan.json'), 'planSha256': M['file_digest'](root / 'plan.json'),
                                'directory': str(root / 'out')}]}
    path = root / 'family-plan.json'
    path.write_text(json.dumps(manifest), encoding='utf-8')
    family = F['join_families']([], [row], ['a' * 64], [])[0]
    review = {'schemaVersion': 'RsiUsacoFamilyReview/v2', 'families': [family], 'planSha256': M['file_digest'](path),
              'formalAdmission': False, 'qualifiedFamilyIncrement': 0}
    directory = root / 'family'
    directory.mkdir()
    (directory / 'family-review.json').write_text(json.dumps(review), encoding='utf-8')
    return path, directory, row, review


def fake_command(args, **_):
    return {'--porcelain': '', 'HEAD': '1' * 40, 'HEAD^{tree}': '2' * 40, '--version': 'v22.0.0'}[args[-1]]


class MeasurementTests(unittest.TestCase):
    def test_only_new_python_sources_are_selected_and_all_original_vectors_survive(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _, directory, row, review = fixture(root, self)
            family = review['families'][0]
            jobs = P['selected_sources'](review, {row['sourceIdentity']: row})
            self.assertEqual(len(jobs), 1)
            pack = P['pack_case'](row, jobs[0], family, 'Python 3.10.12', M['file_digest'](directory / 'family-review.json'))
            item = pack['cases'][0]
            self.assertEqual([(v['input'], v['output']) for v in item['vectors']],
                             [(v['input'], v['output']) for v in row['vectors']])
            self.assertEqual(item['reference'], row['reference'])
            self.assertEqual([v['visibility'] for v in item['vectors']], ['public', *['private'] * 4])
            self.assertEqual(item['privatePython']['referenceSha256'], M['digest'](row['reference']))
            self.assertEqual(pack['usage'], 'scripted-control')
            for status in ('existing-component', 'excluded-observed'):
                family['status'] = status
                self.assertEqual(P['selected_sources'](review, {row['sourceIdentity']: row}), [])
                with self.assertRaisesRegex(ValueError, 'new unobserved'):
                    P['pack_case'](row, jobs[0], family, 'Python 3.10.12', 'a' * 64)
            family['status'] = 'new-component'
            for comparison in ('pending', 'custom-checker'):
                row['outputComparison'] = comparison
                self.assertEqual(P['selected_sources'](review, {row['sourceIdentity']: row}), [])
                with self.assertRaisesRegex(ValueError, 'normalized-text'):
                    P['pack_case'](row, jobs[0], family, 'Python 3.10.12', 'a' * 64)
            row['outputComparison'] = 'normalized-text'
            row['runtime'] = 'cpp'
            self.assertEqual(P['selected_sources'](review, {row['sourceIdentity']: row}), [])

    def test_prepare_and_replay_reject_pack_report_plan_and_family_mutation(self):
        for artifact in ('pack', 'report', 'plan', 'family'):
            with self.subTest(artifact=artifact), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                plan, directory, _, review = fixture(root, self)
                with patch.dict(F, {'inspect': lambda *_args, **_kwargs: review}), \
                     patch('subprocess.check_output', side_effect=fake_command):
                    output = root / 'inputs'
                    args = (plan, M['file_digest'](plan), directory, output, 'Python 3.10.12')
                    report = P['prepare'](*args)
                    self.assertEqual((report['preparedSources'], report['preparedFamilies'], report['modelRequests']), (1, 1, 0))
                    P['prepare'](*args, verify=True)
                    if artifact == 'pack':
                        path = output / report['cases'][0]['path']
                        value = json.loads(gzip.decompress(path.read_bytes()))
                        value['cases'][0]['vectors'].pop()
                        path.write_bytes(gzip.compress(json.dumps(value).encode(), mtime=0))
                    else:
                        path = output / {'report': 'report.json', 'plan': 'plan.json', 'family': 'family-review.json'}[artifact]
                        value = json.loads(path.read_bytes())
                        value['formalAdmission'] = True
                        path.write_text(json.dumps(value), encoding='utf-8')
                    with self.assertRaisesRegex(ValueError, 'drift'):
                        P['prepare'](*args, verify=True)

    def test_dirty_executor_and_missing_new_sources_cannot_prepare(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            plan, directory, _, review = fixture(root, self)
            args = (plan, M['file_digest'](plan), directory, root / 'inputs', 'Python 3.10.12')
            with patch('subprocess.check_output', return_value=' M source.py'):
                with self.assertRaisesRegex(ValueError, 'clean measurement'):
                    P['prepare'](*args)
            review['families'][0]['status'] = 'excluded-observed'
            with patch.dict(F, {'inspect': lambda *_args, **_kwargs: review}), \
                 patch('subprocess.check_output', side_effect=fake_command):
                with self.assertRaisesRegex(ValueError, 'no new Python'):
                    P['prepare'](*args)
            self.assertFalse((root / 'inputs').exists())


if __name__ == '__main__':
    unittest.main()
