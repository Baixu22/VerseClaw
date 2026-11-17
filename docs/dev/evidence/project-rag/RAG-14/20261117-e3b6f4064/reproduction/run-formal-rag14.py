import argparse,datetime,json,os,shutil,subprocess,time
from pathlib import Path
parser=argparse.ArgumentParser()
parser.add_argument('--candidate',required=True)
parser.add_argument('--root',type=Path,default=Path('D:/tmp/project-rag-g2-relay-01a1dca0/source-projection'))
args=parser.parse_args()
root=args.root
base=Path(__file__).parent
candidate=args.candidate
actor='codex-g2-rag14-20261117'
def git(*argv): return subprocess.check_output(['git',*argv],cwd=root).decode().strip()
assert git('rev-parse','HEAD')==candidate and not git('status','--porcelain')
out=base/('formal-chain-'+candidate[:9])
out.mkdir(exist_ok=False)
receipt={'schema':'ProjectRagFormalGateChain/v1','actor':actor,'driven_by':'agent','realHumanEvidence':False,'candidate':candidate,'tree':git('rev-parse','HEAD^{tree}'),'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'phases':[],'status':'running'}
def save(): (out/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n',encoding='utf-8')
save()
for phase in ['unit','types','build','electron','control-e2e','checks','lint','runtime-lint','format','ci']:
    if git('rev-parse','HEAD')!=candidate or git('status','--porcelain'): raise RuntimeError('Candidate changed before '+phase)
    if phase in ['unit','types','build','electron','ci']:
        while shutil.disk_usage('D:/').free < 2*1024**3:
            print('Waiting for D drive space before '+phase,flush=True)
            time.sleep(30)
            assert git('rev-parse','HEAD')==candidate and not git('status','--porcelain')
    folder='formal-'+phase+'-'+candidate[:9]
    argv=['python',str(base/'run-rag14.py'),'--phase',phase,'--out',folder,'--root',str(root),'--formal']
    print('Formal '+phase,flush=True)
    result=subprocess.run(argv,env=dict(os.environ,TEMP='D:/tmp',TMP='D:/tmp',PYTHONUTF8='1'))
    raw=json.loads((base/folder/'receipt.json').read_text(encoding='utf-8-sig'))
    verified=result.returncode==0 and raw['status']=='pass' and raw['sourceUnchanged'] and raw['candidate']['head']==candidate and not raw['candidate']['dirty']
    receipt['phases'].append({'phase':phase,'argv':argv,'exitCode':result.returncode,'receipt':str(base/folder/'receipt.json'),'verifiedFromDisk':verified})
    save()
    if not verified:
        receipt['status']='fail'
        break
else: receipt['status']='pass'
receipt['completedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat()
save()
raise SystemExit(0 if receipt['status']=='pass' else 1)
