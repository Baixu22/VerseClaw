"""Counterexamples for the independent VS evidence verifier."""
from pathlib import Path
import copy, hashlib, importlib.util, json, tempfile, unittest

spec=importlib.util.spec_from_file_location('vs_evidence',Path(__file__).with_name('verify-vs.py'))
evidence=importlib.util.module_from_spec(spec);spec.loader.exec_module(evidence)

def fixture():
 root=Path(tempfile.mkdtemp(prefix='tf0777-vs-test-',dir='D:/tmp')); (root/'outputs').mkdir(); out=b'ok\n'; (root/'outputs'/'one.stdout').write_bytes(out); (root/'outputs'/'one.stderr').write_bytes(b'');
 (root/'authority').mkdir(); manifest=dict(schema='clawx.versegit.host-evidence-manifest/v1',files=[],aggregateDigest=evidence.digest([])); (root/'authority'/'manifest.json').write_text(json.dumps(manifest)); (root/'receipt').mkdir(); receipt=dict(observationDigest='2'*64); (root/'receipt'/'receipt.json').write_text(json.dumps(receipt)); manifest_data=(root/'authority'/'manifest.json').read_bytes();
 report=dict(schema='CodingVsExecution/v1',driven_by='agent',realHumanEvidence=False,candidate='a'*40,sources=dict(clawx=dict(commit='a'*40,tree='b'*40,dirty=False),sts=dict(commit='d9c38a8659274c24ea776b56480a260831b4537f')),binaries=dict(verseshell=dict(sha256='3ed2174fee9b9d38ac34334211d9fd3187bc3b9a1e146a7db05eee64e9fd93f2'),vg=dict(sha256='6fef0fab309702fafdcc716c0f8518257440efafd0a46809930fe33be865c2b4')),cases=[dict(id=x,passed=True) for x in evidence.EXPECTED],processes=[dict(kind='exit',aeAlive=False,childAlive=None,childPid=None,exit=dict(state='exited',exitCode=0,timedOut=False,terminationReason=None)),dict(kind='cancel',aeAlive=False,childPid=2,childAlive=False,exit=dict(state='killed',exitCode=1,timedOut=False,terminationReason='agent_abort')),dict(kind='timeout',aeAlive=False,childPid=3,childAlive=False,exit=dict(state='killed',exitCode=1,timedOut=True,terminationReason='timeout'))],restart=dict(firstDead=True,afterDead=True,afterExit=dict(exitCode=0)),crossTask=dict(rightStillAlive=True,leftDead=True,rightDead=True),sentinel=dict(unknownPreserved=True,managedDead=True),failedReceipt=dict(exitCode=7),receipt=dict(digest=evidence.digest(receipt),receiptFile='receipt/receipt.json',receiptFileSha256=hashlib.sha256((root/'receipt'/'receipt.json').read_bytes()).hexdigest(),receiptFileDigest=evidence.digest(receipt),observationDigest='2'*64,cleanupDigest='3'*64,authorityManifest=dict(path='manifest.json',digest=hashlib.sha256(manifest_data).hexdigest(),aggregateDigest=manifest['aggregateDigest'])),cleanup=dict(status='clean',processSurvivors=0,managerProcessSurvivors=0,processInventory=dict(survivorPids=[])),commands=[dict(id='one',waitedForExit=True,exitCode=0,stdoutArtifact='outputs/one.stdout',stderrArtifact='outputs/one.stderr',stdoutSha256=hashlib.sha256(out).hexdigest(),stderrSha256=hashlib.sha256(b'').hexdigest())],remaining=[])
 return root,report

class VsEvidence(unittest.TestCase):
 def test_exact_case_set(self):
  root,report=fixture(); self.assertEqual(evidence.verify(report,root,'a'*40,evidence.digest(report))['ok'],True)
  altered=copy.deepcopy(report);altered['cases'].pop(); self.assertIn('case set mismatch',evidence.verify(altered,root,'a'*40,evidence.digest(altered))['issues'])
 def test_fake_success_rejected(self):
  root,report=fixture();altered=copy.deepcopy(report);next(c for c in altered['processes'] if c['kind']=='timeout')['exit']['timedOut']=False;self.assertEqual(evidence.verify(altered,root,'a'*40,evidence.digest(altered))['ok'],False)
 def test_output_and_manifest_are_recomputed(self):
  root,report=fixture();altered=copy.deepcopy(report);altered['commands'][0]['stdoutSha256']='0'*64;self.assertEqual(evidence.verify(altered,root,'a'*40,evidence.digest(altered))['ok'],False)
  altered=copy.deepcopy(report);altered['receipt']['authorityManifest']['digest']='0'*64;self.assertEqual(evidence.verify(altered,root,'a'*40,evidence.digest(altered))['ok'],False)
 def test_unknown_and_cross_task_are_not_survivors(self):
  root,report=fixture();altered=copy.deepcopy(report);altered['sentinel']['unknownPreserved']=False;self.assertEqual(evidence.verify(altered,root,'a'*40,evidence.digest(altered))['ok'],False)
  altered=copy.deepcopy(report);altered['crossTask']['rightStillAlive']=False;self.assertEqual(evidence.verify(altered,root,'a'*40,evidence.digest(altered))['ok'],False)

if __name__=='__main__':unittest.main()
