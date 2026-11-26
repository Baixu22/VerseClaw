"""Offline regression checks for the pinned cross-source census (no Parquet dependency)."""
from pathlib import Path
import hashlib
import json
import runpy
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

m = runpy.run_path(str(Path(__file__).with_name('rsi-openr1-intake.py')))
publisher = runpy.run_path(str(Path(__file__).with_name('rsi-taco-publisher-census.py')))
publisher_intake = runpy.run_path(str(Path(__file__).with_name('rsi-taco-publisher-intake.py')))
supplemental = runpy.run_path(str(Path(__file__).with_name('rsi-supplemental-review.py')))
shape_review = runpy.run_path(str(Path(__file__).with_name('rsi-candidate-shape-review.py')))
alternates = runpy.run_path(str(Path(__file__).resolve().parents[1] /
                              'harness/specs/fixtures/rsi-live-experience/prospective-openr1-intake-20261120/check-alternates.py'))


class IntakeTests(unittest.TestCase):
    def test_identity_worker_preserves_native_names_without_vectors_or_references(self):
        records = [{'question': 'fresh prompt', 'source': ' AIZU ', 'name': 'Ａ\u2028B', 'url': None},
                   {'question': 'observed prompt', 'source': 'aizu', 'name': 'a b', 'url': ''}]
        payloads = [{'row': row, 'revision': 'd' * 40, 'shard': 'ALL/train-00000-of-00009.parquet',
                     'rowIndex': i} for i, row in enumerate(records)]
        result = subprocess.run(['node', str(Path(__file__).with_name('rsi-taco-record-index.mjs')), '--identity-only'],
                                input=''.join(m['compact'](row) + '\n' for row in payloads).encode('utf-8'),
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr.decode('utf-8'))
        identities = [json.loads(line) for line in result.stdout.split(b'\n') if line]
        self.assertEqual(len(identities), 2)
        for row, original in zip(identities, records, strict=True):
            self.assertEqual((row['sourceIdentity'], row['sourceIdentityEvidence']),
                             ('taco-origin:aizu:a b', 'source-name'))
            self.assertEqual((row['eligible'], row['referenceShape'], row['referenceSha256']), (False, None, None))
            row['promptDigest'] = m['prompt_key'](original['question'])[2:]
        graph = m['Families']()
        graph.join(['base', identities[0]['sourceIdentity']])
        tiers = {'base': [('base', None)], 'openR1': [], 'codeContestsPassed': [],
                 'alternateReference': [], 'supplementalNamed': [], 'supplementalHeld': []}
        report, _, fresh = publisher['publisher_census'](graph, {m['prompt_key']('observed prompt')},
                                                       tiers, [], [], set(), set(), identities)
        self.assertEqual((report['tiers']['base']['historical'], report['screenedUpperBound']), (1, 0))
        self.assertEqual(fresh, [])

    def test_all_native_screening_requires_a_separate_frozen_selection(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = root / 'plan.json'
            plan = {'schemaVersion': 'RsiTacoPublisherIntakePlan/v1', 'modelRequests': 0,
                    'selection': {'identityOnly': False}}
            path.write_text(json.dumps(plan), encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'all-native selection must be frozen'):
                publisher_intake['inspect'](root, path, m['file_digest'](path), root / 'out', all_native=True)
            self.assertFalse((root / 'out').exists())

    def test_worker_projection_preserves_official_vectors_and_serialized_function_numbers(self):
        ios = [json.dumps({'inputs': [[str(i), ' \u2028 '] for i in range(5)],
                           'outputs': [[str(i), ''] for i in range(5)]}, ensure_ascii=False),
               '{"fn_name":"echo","inputs":[[0],[1],[2],[3],[9007199254740993]],'
               '"outputs":[[0],[1],[2],[3],[9007199254740993]]}']
        for io in ios:
            with self.subTest(io=io[:40]):
                row = {'question': 'Read the given values and return them unchanged according to the stated input format.',
                       'source': 'aizu', 'name': 'echo', 'url': None,
                       'solutions': json.dumps(['\ufeff', 'def echo(value):\n    return value', 'print(1)']),
                       'input_output': io}
                projected, serialized_sha = publisher_intake['worker_projection'](row)
                self.assertEqual(serialized_sha, m['digest'](io))
                self.assertEqual(projected['solutions'], ['def echo(value):\n    return value'])
                if 'fn_name' in io:
                    self.assertEqual(projected['input_output'], io)
                payloads = [{'row': value, 'revision': 'd' * 40, 'shard': 'ALL/train-00000-of-00009.parquet',
                             'rowIndex': 0, 'serializedIoSha256': serialized_sha} for value in (row, projected)]
                result = subprocess.run(['node', str(Path(__file__).with_name('rsi-taco-record-index.mjs'))],
                                        input=''.join(m['compact'](value) + '\n' for value in payloads).encode('utf-8'),
                                        stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)
                self.assertEqual(result.returncode, 0, result.stderr.decode('utf-8'))
                original, transferred = [json.loads(line) for line in result.stdout.split(b'\n') if line]
                self.assertEqual(original, transferred)
                self.assertEqual(transferred['serializedIoSha256'], serialized_sha)
                self.assertTrue(transferred['eligible'])
                self.assertEqual(transferred['vectors'], 5)
                self.assertEqual(len(transferred['vectorsSha256']), 64)

    def test_only_declared_namespace_gets_a_contest_alias(self):
        for key in ('cf-123-a1', 'codeforces:123:a1', 'https://codeforces.com/contest/123/problem/A1',
                    'https://www.codeforces.com/problemset/problem/123/A1?locale=en'):
            self.assertEqual(m['cf_key'](key), 'codeforces:123:A1')
        self.assertEqual(m['cf_key']('123/a1'), '123/a1')
        self.assertEqual(m['cf_key']('123/a1', openr1=True), 'codeforces:123:A1')
        self.assertEqual(m['cf_key']('https://codeforces.com/gym/123/problem/A1'), 'codeforces:gym:123:A1')
        self.assertNotEqual(m['cf_key']('https://elsewhere/contest/123/problem/A1'), 'codeforces:123:A1')

    def test_only_complete_distinct_official_inputs_count(self):
        base = [{'kind': 'stdio', 'visibility': 'private', 'provenanceField': 'private_tests',
                 'input': str(i), 'output': '5'} for i in range(5)]
        packed = dict(base[0], input='3\n1\n2\n3')
        mixed = [packed] * 4 + [dict(base[1], provenanceField='generated_tests'),
                                 dict(base[2], provenanceField='public_tests')]
        self.assertEqual(m['vector_issue'](m['official_subset'](mixed)), 'under-five-distinct-official-inputs')
        self.assertIsNone(m['vector_issue'](m['official_subset'](base)))
        self.assertEqual(m['vector_issue'](base + [dict(base[0], output='6')]), 'conflicting-output')
        self.assertEqual(m['vector_issue'](base + [dict(base[0], input='6', output='1e-9')]), 'numeric-checker-not-bound')

    def test_verdict_binds_the_executed_inputs(self):
        item = {'familyId': 'x', 'representative': 'x1', 'runtime': 'cpp', 'tests': [1, 2, 3, 4, 5]}
        receipt = dict(item, status='passed', tests=5, passed=5, failed=0, timedOut=0, processError=0)
        self.assertEqual(m['audit_status'](receipt, item), 'passed')
        self.assertEqual(m['audit_status'](dict(receipt, status='mismatch', passed=0, processError=1), item), 'mismatch')
        for changes in ({'status': 'pass'}, {'familyId': 'other'}, {'passed': 4}, {'timedOut': 1}, {'tests': 4}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                m['audit_status'](dict(receipt, **changes), item)

    def test_replacement_needs_a_different_blob_on_the_same_origin(self):
        refs = {'codeforces:1:A': {0: {'sha256': 'old'}, 2: {'sha256': 'later'}, 1: {'sha256': 'new'}}}
        self.assertEqual(m['alternate_ref'](refs, 'codeforces:1:A', 'old'), {'sha256': 'new'})
        self.assertIsNone(m['alternate_ref'](refs, 'codeforces:1:B', 'old'))
        self.assertIsNone(m['alternate_ref']({'x': {0: {'sha256': 'old'}}}, 'x', 'old'))

    def test_late_bridges_and_precedence_apply_to_every_tier(self):
        graph = m['Families']()
        graph.join(['old', 'rejected-sibling']); graph.join(['base-lost', 'rejected-sibling'])
        graph.join(['base', 'open-dup']); graph.join(['cc', 'alternate-dup', 'supp-dup'])
        tiers = {'base': [('base-lost', None), ('base', None)], 'openR1': [('open-dup', None), ('open', None)],
                 'codeContestsPassed': [('cc', {'familyId': 'b'}), ('cc', {'familyId': 'a'})],
                 'alternateReference': [('alternate-dup', {'familyId': 'y'}), ('alt', {'familyId': 'z'})],
                 'supplementalNamed': [('supp-dup', None), ('named', None)], 'supplementalHeld': [('held', None)]}
        r, ds = m['joint_census'](graph, {'old'}, tiers)
        self.assertEqual([r[k] for k in ('screenedUpperBound', 'withAlternateUpperBound',
                                           'withAlternateAndNamedSupplementalUpperBound', 'allListedRoutesUpperBound')], [3, 4, 5, 6])
        self.assertEqual(r['tiers']['base']['historical'], 1)
        self.assertEqual({d['familyId'] for d in ds}, {'a', 'z'})
        for tier in tiers.values():
            tier.reverse()
        self.assertEqual((r, ds), m['joint_census'](graph, {'old'}, tiers))

    def test_bad_chunk_or_wrong_manifest_yields_no_report(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); path = root / 'crosswalk.json'; path.write_bytes(b'{"n":1}\n')
            sha = hashlib.sha256(path.read_bytes()).hexdigest()
            self.assertEqual(list(m['checked_rows'](path, sha)), [{'n': 1}])
            path.write_bytes(json.dumps({'n': 2}).encode())
            with self.assertRaisesRegex(ValueError, 'digest mismatch'):
                list(m['checked_rows'](path, sha))
            with self.assertRaisesRegex(ValueError, 'base family manifest digest'):
                m['inspect'](root, path, root / 'out')
            self.assertFalse((root / 'out').exists())
            with self.assertRaisesRegex(ValueError, 'needs both'):
                m['inspect'](root, path, root / 'out', root)


class SupplementalTests(unittest.TestCase):
    def test_record_screening_preserves_bindings_and_refuses_conflicting_vectors(self):
        row = {'id': 'fixture', 'origin': {'source': 'deepcoder/taco', 'upstream_id': 'fixture-row'},
               'prompt': 'Test fixture statement.', 'reference': 'print(input())',
               'tests': [[str(i), str(i)] for i in range(5)]}
        result = supplemental['screen_record'](row)
        self.assertEqual((result['vectorIssue'], result['referenceIssue'], result['distinctInputs']), (None, None, 5))
        self.assertEqual(result['referenceSha256'], m['digest'](row['reference']))
        original = result['serializedRecordSha256']
        row['tests'].append(['0', 'wrong'])
        result = supplemental['screen_record'](row)
        self.assertEqual(result['vectorIssue'], 'conflicting-output')
        self.assertNotEqual(result['serializedRecordSha256'], original)

    def test_altered_component_membership_writes_no_review(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            keys = ['supplemental:original']
            component = {'tier': 'supplementalHeld', 'identityKeys': keys,
                         'componentSha256': m['digest'](m['compact'](keys)), 'supplementalIds': ['changed']}
            path = root / 'fixture-components.jsonl'
            path.write_text(json.dumps(component) + '\n', encoding='utf-8')
            sha = hashlib.sha256(path.read_bytes()).hexdigest()
            with self.assertRaisesRegex(ValueError, 'component identity drift'):
                supplemental['inspect'](path, sha, root / 'absent-source.jsonl', root / 'out')
            self.assertFalse((root / 'out').exists())


class ShapeReviewTests(unittest.TestCase):
    def test_known_shapes_join_families_and_propagate_historical_exclusions(self):
        shape, observed = 'a' * 64, 'b' * 64
        def component(tier, key, row):
            keys = [key]
            return {'tier': tier, 'identityKeys': keys, 'componentSha256': m['digest'](m['compact'](keys)),
                    'candidateRecords': [{'tier': tier, 'identityKey': key, 'record': row}]}
        components = [component('base', 'p:base', None),
                      component('tacoTestStrings', 'taco:fresh', {'referenceShape': shape}),
                      component('tacoTrainStrings', 'taco:observed', {'referenceShape': observed}),
                      component('supplementalHeld', 'supplemental:unknown', None)]
        base = [{'members': [{'promptDigest': 'base', 'referenceShape': shape}]}]
        counts, groups = shape_review['review_components'](components, base, {observed})
        self.assertEqual(counts['componentsAfterKnownShapeBridges'], 3)
        self.assertEqual(counts['historicalShapeComponents'], 1)
        self.assertEqual((counts['screenedUpperBound'], counts['namedUpperBound'], counts['allListedUpperBound']), (1, 1, 2))
        self.assertTrue(any(len(row['componentIds']) == 2 for row in groups))
        self.assertEqual((counts, groups), shape_review['review_components'](list(reversed(components)), base, {observed}))
        extra = [{'runtime': 'python3', 'referenceSha256': 'c' * 64,
                  'identityKey': 'supplemental:unknown', 'shape': shape}]
        complete, _ = shape_review['review_components'](components, base, {observed}, extra)
        self.assertEqual((complete['allListedUpperBound'], complete['unreviewedSources']), (1, 0))
        with self.assertRaisesRegex(ValueError, 'conflicting reference shape'):
            shape_review['review_components'](components, base, {observed}, extra + [{**extra[0], 'shape': observed}])
        components[0]['identityKeys'] = ['altered']
        with self.assertRaisesRegex(ValueError, 'membership drift'):
            shape_review['review_components'](components, base, {observed})


class PublisherTests(unittest.TestCase):
    def test_complete_native_census_requires_current_screening_for_legacy_base_credit(self):
        graph = m['Families']()
        graph.join(['base-good', 'url:https://example.test/good'])
        graph.join(['base-rejected', 'url:https://example.test/rejected'])
        graph.join(['base-unknown', 'p:unknown'])
        tiers = {'base': [('base-good', None), ('base-rejected', None), ('base-unknown', None)],
                 'openR1': [], 'codeContestsPassed': [], 'alternateReference': [],
                 'supplementalNamed': [], 'supplementalHeld': []}
        records = [{'upstreamId': name, 'sourceIdentity': 'https://example.test/' + name,
                    'promptDigest': name, 'referenceShape': name, 'nativeSplit': 'train',
                    'kind': 'strings', 'eligible': eligible} for name, eligible in [('good', True), ('rejected', False)]]
        components = []
        report, _, _ = publisher['publisher_census'](graph, set(), tiers, [], records, set(), set(),
                                                     candidate_components=components, require_screened_base=True)
        self.assertEqual(report['screenedUpperBound'], 1)
        self.assertEqual(report['withAlternateAndNamedSupplementalUpperBound'], 1)
        self.assertEqual(report['allListedRoutesUpperBound'], 3)
        self.assertEqual(report['legacyBaseHeldRows'], 2)
        self.assertEqual({row['tier'] for row in components}, {'base', 'legacyBaseHeld'})

    def test_candidate_export_keeps_late_source_alternatives_and_excludes_observed_families(self):
        def execute(reverse=False):
            graph = m['Families']()
            graph.join(['base', 'https://example.test/base', 'url:https://example.test/base', 'open-alias'])
            graph.join(['old', 'supplemental:old'])
            tiers = {'base': [('base', None)], 'openR1': [('open-alias', {'id': 'source-alternative'})],
                     'codeContestsPassed': [], 'alternateReference': [], 'supplementalNamed': [],
                     'supplementalHeld': [('supplemental:old', None), ('supplemental:held', None)]}
            records = [{'upstreamId': 'late-base', 'sourceIdentity': 'https://example.test/base',
                        'promptDigest': 'base-prompt', 'referenceShape': 'new-shape',
                        'nativeSplit': 'test', 'kind': 'strings', 'eligible': True}]
            if reverse:
                for rows in tiers.values():
                    rows.reverse()
            components = []
            report = publisher['publisher_census'](graph, {'old'}, tiers, [], records, set(), set(),
                                                    candidate_components=components)[0]
            return report, sorted(components, key=lambda row: row['componentSha256'])
        report, components = execute()
        self.assertEqual(len(components), report['allListedRoutesUpperBound'])
        self.assertEqual(len(components), 2)
        base = next(row for row in components if row['tier'] == 'base')
        self.assertEqual({row['tier'] for row in base['candidateRecords']}, {'base', 'openR1', 'tacoTestStrings'})
        self.assertTrue(all('supplemental:old' not in row['identityKeys'] for row in components))
        for row in components:
            self.assertEqual(row['componentSha256'], m['digest'](m['compact'](row['identityKeys'])))
        self.assertEqual((report, components), execute(reverse=True))

    def test_new_census_requires_complete_publisher_identity_input(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / 'out'
            with self.assertRaisesRegex(ValueError, 'complete publisher identity index required'):
                publisher['inspect'](SimpleNamespace(output_directory=output))
            self.assertFalse(output.exists())

    def test_unselected_native_rows_close_late_historical_alias_chains(self):
        def execute(identities):
            graph = m['Families']()
            graph.join(['old', 'url:https://example.test/prior'])
            graph.join(['base', 'p:base-prompt', 'url:https://example.test/base'])
            graph.join(['supplemental:held', 'p:held-prompt'])
            tiers = {'base': [('base', None)], 'openR1': [], 'codeContestsPassed': [], 'alternateReference': [],
                     'supplementalNamed': [], 'supplementalHeld': [('supplemental:held', None)]}
            return publisher['publisher_census'](graph, {'old'}, tiers, [], [], set(), set(), identities)[0]
        identities = [
            {'upstreamId': 'unselected-base', 'promptDigest': 'base-prompt',
             'sourceIdentity': 'https://example.test/prior', 'referenceShape': None, 'eligible': False},
            {'upstreamId': 'unselected-held', 'promptDigest': 'held-prompt',
             'sourceIdentity': 'https://example.test/base', 'referenceShape': None, 'eligible': False}]
        self.assertEqual(execute([])['allListedRoutesUpperBound'], 2)
        result = execute(identities)
        self.assertEqual(result['allListedRoutesUpperBound'], 0)
        self.assertEqual(result['tiers']['base']['historical'], 1)
        self.assertEqual(result['tiers']['supplementalHeld']['historical'], 1)
        self.assertEqual(result, execute(list(reversed(identities))))

    def test_remaining_supplemental_index_omits_covered_and_historical_components(self):
        graph = m['Families']()
        graph.join(['base', 'supplemental:covered'])
        graph.join(['old', 'supplemental:old'])
        graph.join(['supplemental:a', 'supplemental:z'])
        tiers = {'base': [('base', None)], 'openR1': [], 'codeContestsPassed': [], 'alternateReference': [],
                 'supplementalNamed': [('supplemental:covered', None), ('supplemental:a', None), ('supplemental:z', None)],
                 'supplementalHeld': [('supplemental:old', None), ('supplemental:held', None)]}
        components = []
        result = publisher['publisher_census'](graph, {'old'}, tiers, [], [], set(), set(),
                                                supplemental_components=components)[0]
        self.assertEqual(result['allListedRoutesUpperBound'], 3)
        self.assertEqual({tuple(row['supplementalIds']) for row in components}, {('a', 'z'), ('held',)})
        for row in components:
            self.assertEqual(row['componentSha256'], m['digest'](m['compact'](sorted(row['identityKeys']))))

    def test_identity_only_mode_requires_its_own_frozen_selection(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = root / 'fixture-plan.json'
            plan = {'schemaVersion': 'RsiTacoPublisherIntakePlan/v1', 'modelRequests': 0,
                    'driven_by': 'agent', 'actor': 'unit-fixture', 'selection': {}}
            path.write_text(json.dumps(plan), encoding='utf-8')
            sha = hashlib.sha256(path.read_bytes()).hexdigest()
            with self.assertRaisesRegex(ValueError, 'selection must be frozen'):
                publisher_intake['inspect'](root, path, sha, root / 'out', identity_only=True)
            self.assertFalse((root / 'out').exists())

    def test_rejected_rows_bridge_existing_families_before_new_rows_are_counted(self):
        def execute(records):
            graph = m['Families']()
            graph.join(['base-lost', 'url:https://example.test/problem/x'])
            graph.join(['base', 'origin-base'])
            tiers = {'base': [('base-lost', None), ('base', None)], 'openR1': [], 'codeContestsPassed': [],
                     'alternateReference': [], 'supplementalNamed': [], 'supplementalHeld': [('held', None)]}
            return publisher['publisher_census'](graph, {'p:prior'}, tiers, [], records, {'observed-shape'}, set())
        def record(uid, origin, prompt, *, split='test', kind='strings', eligible=True, shape='fresh-shape'):
            return {'upstreamId': uid, 'sourceIdentity': origin, 'promptDigest': prompt, 'referenceShape': shape,
                    'nativeSplit': split, 'kind': kind, 'eligible': eligible}
        records = [record('rejected', 'https://www.example.test/problem/x#fragment', 'prior', eligible=False),
                   record('train-lines', 'https://example.test/problem/a', 'new-a', split='train', kind='lines'),
                   record('test-alias', 'https://www.example.test/problem/a#different', 'new-a-alias'),
                   record('test-function', 'https://example.test/problem/b', 'new-b', kind='function', shape='observed-shape'),
                   record('test-strings', 'https://example.test/problem/c', 'new-c')]
        report, deltas, fresh = execute(records)
        self.assertEqual(report['tiers']['base']['historical'], 1)
        self.assertEqual(report['tiers']['tacoTrainLines']['additional'], 1)
        self.assertEqual(report['tiers']['tacoTestStrings']['alreadyCovered'], 1)
        self.assertEqual(report['tiers']['tacoTestFunctions']['historical'], 1)
        self.assertEqual((report['screenedUpperBound'], report['withAlternateAndNamedSupplementalUpperBound'],
                          report['allListedRoutesUpperBound']), (3, 3, 4))
        self.assertEqual({row['upstreamId'] for row in fresh}, {'train-lines', 'test-strings'})
        self.assertEqual((report, deltas, fresh), execute(list(reversed(records))))
        self.assertEqual((report['formalAdmission'], report['modelRequests']), (False, 0))

    def test_url_bridges_preserve_query_identity_and_separate_gym_problems(self):
        keys = publisher['source_keys']('https://WWW.example.test//task/a/?version=2#fragment')
        self.assertIn('url:https://example.test/task/a?version=2', keys)
        self.assertNotIn('url:https://example.test/task/a', keys)
        self.assertIn('codeforces:gym:123:A', publisher['source_keys']('https://codeforces.com/gym/123/problem/A'))
        self.assertNotIn('codeforces:123:A', publisher['source_keys']('https://codeforces.com/gym/123/problem/A'))


class AlternateTests(unittest.TestCase):
    def setUp(self):
        self.vectors = [{'input': str(i), 'output': '1'} for i in range(5)]
        self.target = {'familyId': 'test-family', 'origin': 'codeforces:1:A', 'originalVerdict': 'mismatch',
                       'reference': {'sha256': m['digest']('reference')}, 'officialSubsetSha256': m['digest']('vectors'),
                       'officialDistinctInputs': 5}

    def response(self, output='1\r\n', **changes):
        report = {'compiler': alternates['COMPILER'], 'stage': 'tests', 'compileError': None,
                  'results': [{'stdout': output, 'stderr': '', 'exitCode': 0, 'timedOut': False, 'error': None}
                              for _ in self.vectors]}
        return json.dumps({**report, **changes}).encode()

    def test_only_complete_valid_responses_receive_a_reference_verdict(self):
        execution = {'exitCode': 0, 'error': None}
        self.assertEqual(alternates['classify'](self.response(), self.vectors, execution)['status'], 'passed')
        self.assertEqual(alternates['classify'](self.response('2'), self.vectors, execution)['status'], 'rejected')
        for raw in (b'', b'{', b'[]', self.response(results=[]), self.response(compiler='different'),
                    self.response(stage='compile', compileError='permission denied'),
                    self.response(results=[{'stdout': '1'}] * 5)):
            with self.subTest(raw=raw):
                result = alternates['classify'](raw, self.vectors, execution)
                self.assertEqual(result['status'], 'infrastructure')
                self.assertFalse(result['passed'])
                self.assertEqual(result['results'], [])

    def test_failed_runner_keeps_exit_status_and_raw_logs(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            run = subprocess.CompletedProcess([], 32, b'partial output', b'mount denied')
            with patch.object(subprocess, 'run', return_value=run):
                result = alternates['grade']('int main(){}', self.vectors, root, root / 'failed')
            self.assertEqual(result['status'], 'infrastructure')
            self.assertEqual(result['execution']['exitCode'], 32)
            self.assertEqual((root / 'failed.stderr').read_bytes(), run.stderr)
            self.assertEqual(result['execution']['logs']['stdout']['sha256'], m['file_digest'](root / 'failed.stdout'))
            self.assertGreaterEqual(result['execution']['elapsedMs'], 0)

    def test_timeout_keeps_partial_output_without_a_reference_rejection(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            error = subprocess.TimeoutExpired('worker', 1, output=b'{partial', stderr=b'stopped')
            with patch.object(subprocess, 'run', side_effect=error):
                result = alternates['grade']('int main(){}', self.vectors, root, root / 'timeout')
            self.assertEqual(result['status'], 'infrastructure')
            self.assertEqual(result['execution']['error'], 'isolated runner timed out')
            self.assertIsNone(result['execution']['exitCode'])
            self.assertEqual((root / 'timeout.stdout').read_bytes(), b'{partial')

    def test_missing_wsl_keeps_the_operating_system_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with patch.object(subprocess, 'run', side_effect=FileNotFoundError(2, 'missing wsl')):
                result = alternates['grade']('int main(){}', self.vectors, root, root / 'missing')
            self.assertEqual(result['status'], 'infrastructure')
            self.assertEqual(result['execution']['errorCode'], 2)
            self.assertIn('missing wsl', result['execution']['error'])
            self.assertEqual((root / 'missing.stderr').read_bytes(), b'')

    def test_control_failure_stops_before_reference_or_next_family(self):
        calls = []
        def runner(i, role, source, vectors):
            calls.append((i, role))
            return {'status': 'infrastructure', 'passed': False, 'results': []}
        cases = alternates['evaluate']([(self.target, 'reference', self.vectors)] * 2, runner)
        self.assertEqual(calls, [(0, 'control')])
        self.assertEqual(cases[0]['status'], 'infrastructure')
        self.assertIsNone(cases[0]['reference'])
        self.assertFalse(cases[0]['qualified'])

    def test_reference_infrastructure_stops_before_next_family(self):
        calls = []
        control = alternates['summarize'](self.response(''), self.vectors)
        def runner(i, role, source, vectors):
            calls.append((i, role))
            return control if role == 'control' else {'status': 'infrastructure', 'passed': False, 'results': []}
        cases = alternates['evaluate']([(self.target, 'reference', self.vectors)] * 2, runner)
        self.assertEqual(calls, [(0, 'control'), (0, 'reference')])
        self.assertEqual(len(cases), 1)
        self.assertFalse(cases[0]['qualified'])

    def test_disk_replay_rejects_changed_logs_or_report_and_never_dispatches(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); output = root / 'report.json'
            verified = [(self.target, 'reference', self.vectors)]
            namespace = alternates['replay'].__globals__
            with patch.dict(namespace, load_targets=lambda *_: (verified, {'fixture': 'mock-only'})):
                runs = [subprocess.CompletedProcess([], 0, self.response(''), b''),
                        subprocess.CompletedProcess([], 0, self.response(), b'')]
                with patch.object(subprocess, 'run', side_effect=runs):
                    retained = alternates['replay'](root, root, output)
                report_sha = m['file_digest'](output)
                with patch.object(subprocess, 'run', side_effect=AssertionError('replay dispatched')):
                    self.assertEqual(alternates['check'](root, root, output, report_sha), retained)
                    (root / 'report.logs/00-reference.stdout').write_bytes(b'changed')
                    with self.assertRaisesRegex(ValueError, 'raw log digest mismatch'):
                        alternates['check'](root, root, output, report_sha)
                    output.write_bytes(b'{}')
                    with self.assertRaisesRegex(ValueError, 'digest mismatch'):
                        alternates['check'](root, root, output, report_sha)


if __name__ == '__main__':
    unittest.main()
