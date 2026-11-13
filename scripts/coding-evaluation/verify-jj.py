"""Read retained JJ parity evidence and reject missing or changed bindings."""
from pathlib import Path
import argparse, copy, hashlib, json, re

ROOT=Path(__file__).resolve().parents[2]
ORACLE_SHA256='53c6ee72346f477bc464e383d4df45f8d3862ad5a17fa5f4d8f4849bcf2d96cc'
REQUIRED=[
    'snapshot-tree',
    'snapshot-graph',
    'readonly-dirty-preserved',
    'normal-readonly-control-preserved',
    'change-commit-identity',
    'snapshot-operation-history-store-parity',
    'snapshot-operation-history-independent-execution',
    'rebase-tree',
    'rebase-graph',
    'rebase-operation-history-store-parity',
    'rebase-operation-history-independent-execution',
    'squash-tree',
    'squash-result-graph',
    'squash-operation-history-store-parity',
    'squash-operation-history-independent-execution',
    'split-tree',
    'split-graph',
    'split-first-result-tree',
    'split-second-result-tree',
    'split-operation-history-store-parity',
    'split-operation-history-independent-execution',
    'restore-path-tree',
    'restore-operation-tree',
    'restore-new-history-identity',
    'restore-operation-history-store-parity',
    'restore-operation-history-independent-execution',
    'snapshot-operation-history',
    'rebase-operation-history',
    'squash-operation-history',
    'split-operation-history',
    'restore-operation-history',
    'unknown-operation-rejected',
    'repeat-request-idempotent',
    'repeat-request-graph',
    'git-root-readonly-no-jj',
    'git-root-readonly-control-preserved',
    'git-root-import-preserves-dirty',
    'git-root-oracle-readable',
    'git-root-import-preserves-git',
    'git-root-import-working-copy-tree',
    'git-root-import-recorded-dirty-bytes',
    'git-root-import-ignored-files',
    'git-root-import-ignored-objects-absent',
    'git-root-native-retention-refs',
    'git-root-import-versioned',
    'git-root-reopen-readonly',
    'git-worktree-readonly-no-jj',
    'git-worktree-readonly-control-preserved',
    'git-worktree-unsupported-before-jj',
    'git-worktree-import-preserves-control',
    'unsupported-shape-before-jj',
    'git-export-ref-content',
    'git-import-ref-adoption',
    'git-ref-operation-history-store-parity',
    'git-ref-operation-history-independent-execution',
    'partial-failure-visible',
    'partial-no-replay',
    'partial-operation-history-store-parity',
    'stale-readonly-preserved',
    'stale-write-refused',
    'stale-recovered-tree',
    'stale-operation-history-store-parity',
    'stale-operation-history-independent-execution',
    'concurrent-readonly-preserved',
    'concurrent-divergence-bounded',
    'owned-process-crash',
    'crash-surviving-bytes-reconciled',
    'crash-operation-history-store-parity',
]

STORE_PARITY_IDS=[case_id for case_id in REQUIRED if case_id.endswith('-operation-history-store-parity')]
INDEPENDENT_EXECUTION_IDS=[case_id for case_id in REQUIRED if case_id.endswith('-operation-history-independent-execution')]

def canonical_graph(entries, subject):
    """Number the rooted DAG by parent order, retaining shared and duplicate-label nodes."""
    by_id={entry['commit_id']:entry for entry in entries}
    if len(by_id)!=len(entries): raise ValueError('duplicate graph identity')
    numbers,rows,active={},{},set()
    def visit(identifier):
        if identifier in active: raise ValueError('cyclic graph')
        if identifier in numbers: return numbers[identifier]
        entry=by_id[identifier]
        number=len(numbers);numbers[identifier]=number
        active.add(identifier)
        parents=[visit(parent) for parent in entry['parent_ids']]
        active.remove(identifier)
        rows[number]=dict(node=number,description=entry['description'] or '<root>',parents=parents)
        return number
    visit(subject)
    if len(numbers)!=len(entries): raise ValueError('unreachable graph entry')
    return [rows[number] for number in range(len(rows))]

def validate_operation_history(by_id, check):
    for case_id in STORE_PARITY_IDS:
        case=by_id.get(case_id,{})
        check(isinstance(case.get('native'),list) and bool(case.get('native')) and case.get('native')==case.get('oracle'),
              'empty or inconsistent store parity: '+case_id)
        check('same immutable VG operation store' in str(case.get('extra',{}).get('comparison','')),
              'store parity reader description missing: '+case_id)
    for case_id in INDEPENDENT_EXECUTION_IDS:
        case=by_id.get(case_id,{})
        native=case.get('native'); oracle=case.get('oracle'); extra=case.get('extra',{})
        check(isinstance(native,list) and bool(native) and native==oracle,
              'empty or inconsistent independent execution: '+case_id)
        check(isinstance(extra.get('nativeOperationIds'),list) and len(extra['nativeOperationIds'])==len(native),
              'native operation identities missing: '+case_id)
        check(isinstance(extra.get('pairedOperationIds'),list) and len(extra['pairedOperationIds'])==len(extra.get('pairedRawDescriptions',[])),
              'paired operation identities missing: '+case_id)
        check(bool(extra.get('normalization')) and 'parent arity' in str(extra.get('normalization','')),
              'independent execution normalization missing: '+case_id)

def report_digest(report):
    return hashlib.sha256(json.dumps(report,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()

def verify(report,manifest,root,expected_candidate,expected_report_digest,allow_development=False):
    issues=[]
    def check(condition,message):
        if not condition: issues.append(message)
    try:
        check(report.get('schema')=='CodingJjParity/v2','schema mismatch')
        check(report.get('driven_by')=='agent' and report.get('realHumanEvidence') is False,'attribution mismatch')
        check(bool(re.fullmatch(r'[a-f0-9]{40}',str(report.get('candidate','')))),'candidate identity missing')
        check(report.get('candidate')==expected_candidate,'frozen candidate mismatch')
        check(bool(re.fullmatch(r'[a-f0-9]{64}',expected_report_digest)) and report_digest(report)==expected_report_digest,
              'retained report digest mismatch')
        sources=report.get('sources',{})
        clawx=sources.get('clawx',{})
        native=sources.get('provider',{})
        check(clawx.get('commit')==expected_candidate and bool(clawx.get('inputs')),'ClawX source binding missing')
        if not allow_development:
            check(clawx.get('dirty') is False and native.get('dirty') is False,'source is not a clean frozen candidate')
        check(native.get('commit')==manifest['source']['commit'] and native.get('tree')==manifest['source']['tree'],
              'native source tree mismatch')
        check(native.get('lockfileSha256')==manifest['build']['lockfileSha256'] and native.get('jjLibVersion')=='0.46.0',
              'native lock or library mismatch')
        provider=report.get('provider',{})
        check(provider.get('binarySha256')==manifest['artifact']['sha256'],'provider binary changed')
        check(provider.get('sourceCommit')==manifest['source']['commit'],'provider source changed')
        check(provider.get('jjLibVersion')=='0.46.0','provider library version changed')
        oracle=report.get('oracle',{})
        check(oracle.get('binarySha256')==ORACLE_SHA256,'independent oracle digest changed')
        check(str(oracle.get('version','')).startswith('jj 0.46.0-'),'oracle version changed')
        cases=report.get('cases',[])
        check(isinstance(cases,list),'case list missing')
        by_id={case['id']:case for case in cases}
        check(len(by_id)==len(cases),'duplicate case identity')
        check(set(by_id)==set(REQUIRED),'case set differs from CodingJjParity/v2 contract')
        for case_id in REQUIRED:
            case=by_id.get(case_id,{})
            check(case.get('passed') is True and case.get('equal') is True and case.get('native')==case.get('oracle'),
                  'missing or inconsistent case: '+case_id)
        for case_id in ['snapshot-tree','rebase-tree','split-tree','split-first-result-tree','split-second-result-tree','restore-operation-tree']:
            check(bool(by_id.get(case_id,{}).get('native')),'empty tree evidence: '+case_id)
        for case_id in ['snapshot-graph','rebase-graph','split-graph','squash-result-graph']:
            check(len(by_id.get(case_id,{}).get('native',[]))>=2,'empty graph evidence: '+case_id)
        validate_operation_history(by_id, check)
        check(report.get('remaining')==[],'required work remains')
        check(report.get('cleanup',{}).get('commandsAllExited') is True and report.get('cleanup',{}).get('unknownPidsTerminated')==0,'cleanup incomplete')
        check(report.get('cleanup',{}).get('survivingOwnedPids')==[],'owned process survived')
        commands=report.get('commands',[])
        check(isinstance(commands,list) and len(commands)>0,'command evidence missing')
        for command in commands:
            check(isinstance(command.get('exitCode'),int) and isinstance(command.get('argv'),list),'malformed command')
            check(command.get('waitedForExit') is True,'command exit not awaited')
            for channel in ['stdout','stderr']:
                artifact=command.get(channel+'Artifact')
                if artifact:
                    target=(root/artifact).resolve()
                    check(target.is_relative_to(root.resolve()),'artifact path escapes evidence root')
                    if not target.is_relative_to(root.resolve()): continue
                    data=target.read_bytes()
                else:
                    data=command.get(channel,'').encode('utf-8')
                check(hashlib.sha256(data).hexdigest()==command.get(channel+'Sha256'),'command output mismatch: '+command.get('id','unknown')+'/'+channel)
                if channel+'Artifact' in command:
                    check(artifact==command.get(channel+'Artifact'),'command output field differs from retained artifact: '+command.get('id','unknown')+'/'+channel)
                    if not command.get(channel+'Truncated',False):
                        check(command.get(channel)==data.decode('utf-8',errors='replace'),'command text differs from retained artifact: '+command.get('id','unknown')+'/'+channel)
        killed=[command for command in commands if command.get('id')=='owned-crash-kill']
        check(len(killed)==1 and killed[0].get('killedBy')=='runner-owned-process-handle' and killed[0].get('effectWindowObserved') is True and killed[0].get('exitCode')!=0,'real crash window not measured')
        crash=by_id.get('owned-process-crash',{}).get('extra',{})
        check(crash.get('identityBefore')==crash.get('identityAfter') and bool(crash.get('identityBefore')),
              'crash was committed before the observed kill')
    except (KeyError,TypeError,ValueError,OSError,AttributeError) as error:
        issues.append('unreadable or malformed evidence: '+str(error))
    return dict(ok=not issues,issues=issues,acceptanceEligible=not issues and not allow_development)

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('report',type=Path)
    parser.add_argument('--manifest',type=Path,default=ROOT/'resources/versegit/manifest.json')
    parser.add_argument('--output',type=Path)
    parser.add_argument('--candidate',required=True)
    parser.add_argument('--expected-report-digest',required=True,help='Canonical digest retained separately when the runner sealed the report')
    parser.add_argument('--allow-development',action='store_true',help='Check an iteration; this mode never produces acceptance-eligible evidence')
    parser.add_argument('--negative-checks',action='store_true')
    args=parser.parse_args()
    report=json.loads(args.report.read_text(encoding='utf-8-sig'))
    manifest=json.loads(args.manifest.read_text(encoding='utf-8-sig'))
    result=verify(report,manifest,args.report.parent,args.candidate,args.expected_report_digest,args.allow_development)
    if args.negative_checks:
        negative=[]
        for case in ['delete-case','wrong-candidate','changed-oracle','changed-output','failed-case','restore-operation-parent-tamper','self-consistent-forgery']:
            altered=copy.deepcopy(report)
            if case=='delete-case': altered['cases'].pop()
            elif case=='wrong-candidate': altered['candidate']='0'*40
            elif case=='changed-oracle': altered['oracle']['binarySha256']='0'*64
            elif case=='changed-output':
                entry=next(row for row in altered['commands'] if row.get('stdoutArtifact'))
                entry['stdout']='tampered'
            elif case=='failed-case': altered['cases'][0]['passed']=False
            elif case=='restore-operation-parent-tamper':
                entry=next(row for row in altered['cases'] if row['id']=='restore-operation-history-store-parity')
                entry['native'][0]['parents']=['f'*128]
            else:
                entry=next(row for row in altered['cases'] if row['id']=='rebase-graph')
                entry['native']=entry['oracle']=[dict(node=0,description='forged',parents=[1]),dict(node=1,description='<root>',parents=[])]
            # Structural counterexamples must be rejected on their own merits.
            # The forged graph keeps the externally retained digest as its only trust anchor.
            expected=args.expected_report_digest if case=='self-consistent-forgery' else report_digest(altered)
            rejected=verify(altered,manifest,args.report.parent,args.candidate,expected,args.allow_development)
            negative.append(dict(case=case,rejected=not rejected['ok'],issues=rejected['issues']))
        result['negativeChecks']=negative
        if not all(case['rejected'] for case in negative):
            result['ok']=False;result['issues'].append('negative evidence was accepted')
    if args.output: args.output.write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(result,indent=2))
    raise SystemExit(0 if result['ok'] else 1)
