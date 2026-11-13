"""Verify retained TF-0777 VerseShell execution, receipt and cleanup evidence."""
from pathlib import Path
import argparse, copy, hashlib, json, re

ROOT=Path(__file__).resolve().parents[2]
EXPECTED=['process-normal','process-timeout','process-cancel','gateway-restart-boundary','cross-task-cancel-isolated','unknown-pid-preserved','sts-pytest-exit0','sts-failed-exit7','live-receipt-accepted','cleanup-zero','negative-old-candidate','negative-observation-digest','negative-forged-live-without-authority','negative-fake-exit0','negative-artifact-summary','negative-late-frame','negative-no-native-fallback']

def digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()

def verify(report,root,expected_candidate,expected_digest,allow_dirty=False,report_file_sha256=None):
    issues=[]
    def check(condition,message):
        if not condition: issues.append(message)
    try:
        check(report.get('schema')=='CodingVsExecution/v1','schema mismatch')
        check(report.get('driven_by')=='agent' and report.get('realHumanEvidence') is False,'attribution mismatch')
        check(report.get('candidate')==expected_candidate and bool(re.fullmatch(r'[a-f0-9]{40}',str(report.get('candidate','')))),'candidate mismatch')
        check(expected_digest==(report_file_sha256 or digest(report)),'report digest mismatch')
        source=report.get('sources',{}).get('clawx',{})
        check(source.get('commit')==expected_candidate and source.get('tree')==report.get('sources',{}).get('clawx',{}).get('tree'),'ClawX binding missing')
        if not allow_dirty: check(source.get('dirty') is False,'source is not frozen')
        check('d9c38a8659274c24ea776b56480a260831b4537f'==report.get('sources',{}).get('sts',{}).get('commit'),'STS source mismatch')
        binaries=report.get('binaries',{})
        check(binaries.get('verseshell',{}).get('sha256')=='3ed2174fee9b9d38ac34334211d9fd3187bc3b9a1e146a7db05eee64e9fd93f2','VerseShell binary mismatch')
        check(binaries.get('vg',{}).get('sha256')=='6fef0fab309702fafdcc716c0f8518257440efafd0a46809930fe33be865c2b4','VG binary mismatch')
        cases=report.get('cases',[])
        by_id={entry['id']:entry for entry in cases}
        check(len(by_id)==len(cases),'duplicate case identity')
        check(set(by_id)==set(EXPECTED),'case set mismatch')
        for case_id in EXPECTED:
            check(by_id.get(case_id,{}).get('passed') is True,'failed case: '+case_id)
        processes={entry['kind']:entry for entry in report.get('processes',[])}
        check(processes.get('exit',{}).get('exit',{}).get('state')=='exited','normal exit not measured')
        check(processes.get('cancel',{}).get('exit',{}).get('terminationReason')=='agent_abort','cancel reason missing')
        timeout=processes.get('timeout',{}).get('exit',{})
        check(timeout.get('timedOut') is True and timeout.get('terminationReason')=='timeout','timeout not measured')
        for entry in processes.values():
            check(entry.get('aeAlive') is False,'owned ae process survived')
            check(not entry.get('childPid') or entry.get('childAlive') is False,'owned child process survived')
        restart=report.get('restart',{})
        check(restart.get('firstDead') is True and restart.get('afterExit',{}).get('exitCode')==0 and restart.get('afterDead') is True,'restart boundary failed')
        cross=report.get('crossTask',{})
        check(cross.get('rightStillAlive') is True and cross.get('leftDead') is True and cross.get('rightDead') is True,'cross-task cancellation crossed ownership')
        sentinel=report.get('sentinel',{})
        check(sentinel.get('unknownPreserved') is True and sentinel.get('managedDead') is True,'unknown PID was touched or managed PID survived')
        check(report.get('failedReceipt',{}).get('exitCode')==7,'failed exit evidence missing')
        receipt=report.get('receipt',{})
        check(bool(re.fullmatch(r'[a-f0-9]{64}',str(receipt.get('digest','')))),'receipt digest missing')
        receipt_file=root/receipt.get('receiptFile','missing')
        receipt_bytes=receipt_file.read_bytes()
        check(hashlib.sha256(receipt_bytes).hexdigest()==receipt.get('receiptFileSha256'),'retained receipt bytes mismatch')
        stored_receipt=json.loads(receipt_bytes)
        check(digest(stored_receipt)==receipt.get('digest')==receipt.get('receiptFileDigest'),'retained receipt digest mismatch')
        check(stored_receipt.get('observationDigest')==receipt.get('observationDigest'),'receipt observation identity mismatch')
        check(bool(re.fullmatch(r'[a-f0-9]{64}',str(receipt.get('observationDigest','')))),'observation digest missing')
        check(bool(re.fullmatch(r'[a-f0-9]{64}',str(receipt.get('cleanupDigest','')))),'cleanup digest missing')
        cleanup=report.get('cleanup',{})
        check(cleanup.get('status')=='clean' and cleanup.get('processSurvivors')==0 and cleanup.get('managerProcessSurvivors')==0,'cleanup not clean')
        check(cleanup.get('processInventory',{}).get('survivorPids')==[],'cleanup survivor vector not empty')
        check(report.get('remaining')==[],'required work remains')
        commands=report.get('commands',[])
        check(isinstance(commands,list) and bool(commands),'commands missing')
        seen=set()
        for command in commands:
            check(bool(command.get('id')) and command['id'] not in seen,'duplicate command identity')
            seen.add(command.get('id'))
            check(command.get('waitedForExit') is True and isinstance(command.get('exitCode'),int),'command exit not measured')
            for channel in ('stdout','stderr'):
                artifact=command.get(channel+'Artifact')
                data=(root/artifact).read_bytes()
                check(hashlib.sha256(data).hexdigest()==command.get(channel+'Sha256'),'command output mismatch: '+command.get('id','?')+'/'+channel)
        manifest=report.get('receipt',{}).get('authorityManifest',{})
        manifest_path=root/'authority'/manifest.get('path','missing')
        data=manifest_path.read_bytes()
        check(hashlib.sha256(data).hexdigest()==manifest.get('digest'),'authority manifest digest mismatch')
        stored_manifest=json.loads(data)
        check(stored_manifest.get('aggregateDigest')==manifest.get('aggregateDigest'),'authority aggregate mismatch')
        for entry in stored_manifest.get('files',[]):
            target=root/'authority'/entry['path']
            check(target.is_file() and hashlib.sha256(target.read_bytes()).hexdigest()==entry['digest'],'authority file mismatch: '+entry['path'])
    except (KeyError,TypeError,ValueError,OSError,AttributeError) as error:
        issues.append('unreadable or malformed evidence: '+str(error))
    return dict(ok=not issues,issues=issues,acceptanceEligible=not issues and not allow_dirty)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('report',type=Path);parser.add_argument('--candidate',required=True);parser.add_argument('--expected-report-digest',required=True);parser.add_argument('--allow-dirty',action='store_true');parser.add_argument('--negative-checks',action='store_true');parser.add_argument('--expected-digest-is-file-sha256',action='store_true');parser.add_argument('--output',type=Path);args=parser.parse_args()
    report_bytes=args.report.read_bytes();report=json.loads(report_bytes.decode('utf-8-sig'));result=verify(report,args.report.parent,args.candidate,args.expected_report_digest,args.allow_dirty,hashlib.sha256(report_bytes).hexdigest() if args.expected_digest_is_file_sha256 else None)
    if args.negative_checks:
        tests=[]
        mutations=['wrong-candidate','missing-case','fake-exit','old-observation','survivor','output-tamper','digest-tamper']
        for name in mutations:
            altered=copy.deepcopy(report); altered_digest=digest(altered)
            if name=='wrong-candidate':altered['candidate']='0'*40
            elif name=='missing-case':altered['cases'].pop()
            elif name=='old-observation':
                altered['receipt']['observationDigest']='f'*64
                receipt_path=args.report.parent/altered['receipt']['receiptFile']
                stored=json.loads(receipt_path.read_text())
                stored['observationDigest']='f'*64
            elif name=='survivor':altered['cleanup']['processSurvivors']=1
            elif name=='output-tamper':altered['commands'][0]['stdoutSha256']='0'*64
            elif name=='digest-tamper':altered_digest='f'*64
            elif name=='fake-exit':next(c for c in altered['processes'] if c['kind']=='timeout')['exit']['timedOut']=False
            denied=verify(altered,args.report.parent,args.candidate,altered_digest if name!='digest-tamper' else 'f'*64,args.allow_dirty,None)
            tests.append(dict(case=name,rejected=not denied['ok'],issues=denied['issues']))
        result['negativeChecks']=tests
        if not all(entry['rejected'] for entry in tests):result['ok']=False;result['issues'].append('negative evidence accepted')
    if args.output:args.output.write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(result,indent=2));raise SystemExit(0 if result['ok'] else 1)
