"""Check family bridges, historical exclusions and original source replay."""
import json
from pathlib import Path
import runpy
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
F = runpy.run_path(str(ROOT / 'scripts/rsi-usaco-family-review.py'))
U = runpy.run_path(str(ROOT / 'scripts/rsi-usaco-source-intake-test.py'))
M = F['M']


def old(fid, keys, shapes=(), status='planned'):
    return {'familyId': fid, 'identityKeys': sorted(keys), 'knownReferenceShapes': list(shapes),
            'status': status, 'excludedByHistoricalShape': status == 'excluded'}


def candidate(cpid, prompt='An independent public problem contract.', extra=()):
    return {'sourceIdentity': 'usaco:' + str(cpid), 'prompt': prompt,
            'identityKeys': ['usaco:' + str(cpid), *extra]}


class FamilyTests(unittest.TestCase):
    def test_real_excluded_base_shape_and_late_bridge_are_both_excluded(self):
        historical = F['historical_keys']()
        shape = '6cebc8966c49708e6c956c28575ac7115a5c8085d33569caa21f191500c36f2f'
        self.assertTrue(any({'shape:' + shape, 'codeforces:1057:C',
                             'p:2e5f2c598fa331cf8c9f1f46953ef15fdca587a3d82a52c035f864ef4027d8d0'} <= set(keys)
                            for keys in historical))
        results = F['join_families']([old('earlier', ['usaco:12'])], [candidate(12), candidate(13)],
                                     ['b' * 64, shape], historical)
        self.assertEqual([(r['status'], r['oldFamilyIds'], r['sourceIdentities']) for r in results],
                         [('excluded-observed', ['earlier'], ['usaco:12', 'usaco:13'])])

    def test_url_aliases_merge_without_counting_old_family_twice(self):
        queue = [old('one', ['url:http://www.usaco.org/index.php?cpid=1347&page=viewproblem2'])]
        result = F['join_families'](queue, [candidate(1347)], ['a' * 64], [])
        self.assertEqual(result[0]['status'], 'existing-component')
        self.assertEqual(result[0]['oldFamilyIds'], ['one'])

    def test_same_prompt_or_renamed_reference_shares_one_family(self):
        prompt = 'Same original problem'
        queue = [old('same-prompt', [M['prompt_key'](prompt)])]
        rows = [candidate(1, prompt), candidate(2, 'Different wording'), candidate(3, 'Unrelated wording')]
        result = F['join_families'](queue, rows, ['a' * 64, 'a' * 64, 'b' * 64], [])
        existing = next(r for r in result if r['status'] == 'existing-component')
        self.assertEqual(existing['sourceIdentities'], ['usaco:1', 'usaco:2'])
        self.assertEqual(sum(r['status'] == 'new-component' for r in result), 1)

    def test_late_bridge_propagates_history_to_every_new_and_old_member(self):
        queue = [old('seen', ['usaco:1'], status='excluded'), old('held', ['usaco:2'], status='held')]
        rows = [candidate(2), candidate(1, extra=('alias',))]
        result = F['join_families'](queue, rows, ['a' * 64] * 2, [])
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]['status'], 'excluded-observed')
        self.assertEqual(result[0]['oldFamilyIds'], ['held', 'seen'])
        self.assertEqual(result, F['join_families'](list(reversed(queue)), list(reversed(rows)), ['a' * 64] * 2, []))

    def test_observed_prompt_shape_and_source_each_exclude_candidates(self):
        for keys in ([M['prompt_key']('Original problem')], ['shape:' + 'a' * 64], ['usaco:1347']):
            with self.subTest(keys=keys):
                result = F['join_families']([], [candidate(1347, 'Original problem')], ['a' * 64], [keys])
                self.assertEqual(result[0]['status'], 'excluded-observed')

    def test_duplicate_source_or_missing_shape_fails(self):
        for rows, shapes in [([candidate(1), candidate(1)], ['a' * 64] * 2), ([candidate(1)], []),
                             ([candidate(1)], ['invalid'])]:
            with self.assertRaises(ValueError):
                F['join_families']([], rows, shapes, [])

    def test_plan_replay_rejects_rewritten_candidate_and_report(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            U['invoke'](root, U['fixture'](root))
            selection = root / 'selection.json'
            queue_path = root / 'source-queue.jsonl.gz'
            queue_path.write_bytes(b'pinned-test-queue')
            selection.write_text(json.dumps({'schemaVersion': 'RsiProspectiveSourceSelection/v1',
                'compressedIndexSha256': M['file_digest'](queue_path), 'indexSha256': 'f' * 64}), encoding='utf-8')
            manifest = {'schemaVersion': 'RsiUsacoFamilyReviewPlan/v1', 'driven_by': 'agent',
                'sourceFilesSha256': {name: M['file_digest'](ROOT / name) for name in sorted(set(F['SOURCES']))},
                'shapeRuntime': {'nodeVersion': subprocess.check_output(['node', '--version'], encoding='utf-8').strip(),
                                 'typescriptSha256': M['file_digest'](ROOT / 'node_modules/typescript/lib/typescript.js')},
                'selection': {'path': str(selection), 'sha256': M['file_digest'](selection)},
                'candidates': [{'plan': str(root / 'plan.json'), 'planSha256': M['file_digest'](root / 'plan.json'),
                                'directory': str(root / 'out')}]}
            plan = root / 'family-plan.json'
            plan.write_text(json.dumps(manifest), encoding='utf-8')
            globals_ = F['build_review'].__globals__
            with patch.dict(F['Q'], {'checked_index': lambda *_: []}), \
                 patch.dict(globals_, {'reference_shapes': lambda *_: ['a' * 64], 'historical_keys': lambda: []}):
                result = F['inspect'](plan, M['file_digest'](plan), root / 'review')
                self.assertEqual(result['counts'], {'new-component': 1})
                self.assertEqual(result['qualifiedFamilyIncrement'], 0)
                self.assertFalse(result['formalAdmission'] or result['runnerCalibration'])
                F['inspect'](plan, M['file_digest'](plan), root / 'review', verify=True)
                report_path = root / 'review/family-review.json'
                report = json.loads(report_path.read_bytes())
                report['qualifiedFamilyIncrement'] = 1
                report_path.write_text(json.dumps(report), encoding='utf-8')
                with self.assertRaisesRegex(ValueError, 'review replay drift'):
                    F['inspect'](plan, M['file_digest'](plan), root / 'review', verify=True)
                row_path = root / 'out/source-candidate.json'
                row = json.loads(row_path.read_bytes())
                row['prompt'] = 'mutated'
                row_path.write_text(json.dumps(row), encoding='utf-8')
                with self.assertRaisesRegex(ValueError, 'candidate replay drift'):
                    F['build_review'](plan, M['file_digest'](plan))


if __name__ == '__main__':
    unittest.main()
