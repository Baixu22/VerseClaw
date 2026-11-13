"""Graph counterexamples that cannot be distinguished by commit descriptions alone."""
from pathlib import Path
import copy, importlib.util, unittest

spec=importlib.util.spec_from_file_location('jj_evidence',Path(__file__).with_name('verify-jj.py'))
evidence=importlib.util.module_from_spec(spec);spec.loader.exec_module(evidence)

class GraphEvidence(unittest.TestCase):
    def setUp(self):
        self.graph=[dict(commit_id=identifier,description=description,parent_ids=parents) for identifier,description,parents in [
            ('s','tip',['a','b']),('a','same',['c','d']),('b','same',['c']),
            ('c','same',['r']),('d','same',['r']),('r','',[])]]

    def test_random_ids_do_not_change_topology(self):
        renamed=[dict(commit_id='new-'+row['commit_id'],description=row['description'],parent_ids=['new-'+parent for parent in row['parent_ids']]) for row in reversed(self.graph)]
        self.assertEqual(evidence.canonical_graph(self.graph,'s'),evidence.canonical_graph(renamed,'new-s'))

    def test_same_descriptions_cannot_hide_a_wrong_parent(self):
        changed=copy.deepcopy(self.graph);changed[2]['parent_ids']=['d']
        self.assertNotEqual(evidence.canonical_graph(self.graph,'s'),evidence.canonical_graph(changed,'s'))

    def test_merge_parent_order_is_preserved(self):
        changed=copy.deepcopy(self.graph);changed[1]['parent_ids'].reverse()
        self.assertNotEqual(evidence.canonical_graph(self.graph,'s'),evidence.canonical_graph(changed,'s'))

    def test_schema_contract_has_68_unique_cases(self):
        self.assertEqual(len(evidence.REQUIRED),68)
        self.assertEqual(len(set(evidence.REQUIRED)),68)
        self.assertEqual(len(evidence.STORE_PARITY_IDS),9)
        self.assertEqual(len(evidence.INDEPENDENT_EXECUTION_IDS),7)

    def test_schema_is_exactly_v2(self):
        manifest={'source':{'commit':'a','tree':'b'},'build':{'lockfileSha256':'c'},'artifact':{'sha256':'d'}}
        report={'schema':'CodingJjParity/v1'}
        result=evidence.verify(report,manifest,Path('.'),'a','0'*64,True)
        self.assertIn('schema mismatch',result['issues'])

    def test_report_digest_is_independent_of_key_and_json_spacing(self):
        first={'cases':[],'candidate':'a'}
        second={'candidate':'a','cases':[]}
        self.assertEqual(evidence.report_digest(first),evidence.report_digest(second))

    def test_store_parity_is_bound_to_same_immutable_store(self):
        self.assertTrue(all(case.endswith('-operation-history-store-parity') for case in evidence.STORE_PARITY_IDS))
        self.assertIn('snapshot-operation-history-store-parity',evidence.STORE_PARITY_IDS)
        self.assertIn('crash-operation-history-store-parity',evidence.STORE_PARITY_IDS)

    def test_only_sequences_with_independent_oracle_get_independent_execution(self):
        expected={'snapshot','rebase','squash','split','restore','git-ref','stale'}
        actual={case.removesuffix('-operation-history-independent-execution') for case in evidence.INDEPENDENT_EXECUTION_IDS}
        self.assertEqual(actual,expected)

    def test_split_history_cannot_reuse_a_merged_case_id(self):
        def check(condition,message):
            if not condition: raise AssertionError(message)
        rows={'split-operation-history':{'native':[],'oracle':[],'extra':{}}}
        with self.assertRaises(AssertionError):
            evidence.validate_operation_history(rows,check)

    def test_fake_paired_history_is_rejected(self):
        def check(condition,message):
            if not condition: raise AssertionError(message)
        cases={}
        for case_id in evidence.STORE_PARITY_IDS:
            cases[case_id]={'native':[{'id':'same'}],'oracle':[{'id':'same'}],'extra':{'comparison':'same immutable VG operation store'}}
        for case_id in evidence.INDEPENDENT_EXECUTION_IDS:
            cases[case_id]={'native':[['vg: snapshot',1]],'oracle':[['vg: snapshot',1]],
                'extra':{'nativeOperationIds':['n'],'pairedOperationIds':['p'],'pairedRawDescriptions':['snapshot working copy'],'normalization':'parent arity retained'}}
        cases['split-operation-history-independent-execution']['extra']['pairedOperationIds'].append('forged')
        with self.assertRaises(AssertionError):
            evidence.validate_operation_history(cases,check)

if __name__=='__main__': unittest.main()
