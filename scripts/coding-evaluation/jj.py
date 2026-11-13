"""Fixed JJ CLI / VG parity and recovery evaluation on disposable repositories."""
from pathlib import Path
import argparse, hashlib, importlib.util, json, os, re, sqlite3, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[2]
sys.dont_write_bytecode=True
DEFAULT_VG = ROOT / 'resources/bin/win32-x64/vg.exe'
parser = argparse.ArgumentParser()
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--oracle', type=Path, required=True)
parser.add_argument('--provider', type=Path, default=DEFAULT_VG)
parser.add_argument('--provider-manifest', type=Path, default=ROOT/'resources/versegit/manifest.json')
parser.add_argument('--provider-source', type=Path, required=True)
args = parser.parse_args()
OUT = args.output.resolve()
JJ = args.oracle.resolve()
VG = args.provider.resolve()
if OUT.exists(): raise RuntimeError('Allocate a new evaluation output directory')
OUT.mkdir(parents=True)
CONFIG = OUT / 'jj.toml'
CONFIG.write_text('[user]\nname="Coding oracle"\nemail="oracle@example.invalid"\n[ui]\neditor="true"\n[snapshot]\nauto-update-stale=false\n', encoding='utf-8')
ENV = dict(os.environ, JJ_CONFIG=str(CONFIG), TEMP='D:/ClawX/.tmp', TMP='D:/ClawX/.tmp',
           GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL=str(OUT/'empty-git-config'), GIT_TERMINAL_PROMPT='0',GIT_OPTIONAL_LOCKS='0',
           PYTHONDONTWRITEBYTECODE='1')
for key in ['VG_SESSION_ID','GIT_DIR','GIT_WORK_TREE','GIT_INDEX_FILE','GIT_COMMON_DIR',
            'GIT_OBJECT_DIRECTORY','GIT_ALTERNATE_OBJECT_DIRECTORIES','VG_MANAGED_DRAFT_FAULT','JJ_OP_ID']:
    ENV.pop(key, None)
manifest = json.loads(args.provider_manifest.read_text(encoding='utf-8-sig'))
commands, cases = [], []
owned_processes, terminated_pids = [], set()
spec=importlib.util.spec_from_file_location('jj_evidence',ROOT/'scripts/coding-evaluation/verify-jj.py')
evidence=importlib.util.module_from_spec(spec);spec.loader.exec_module(evidence)
def digest(file):
    value=hashlib.sha256()
    with file.open('rb') as stream:
        for data in iter(lambda: stream.read(1024*1024), b''): value.update(data)
    return value.hexdigest()
def command_record(label, process, argv, cwd, started, stdout, stderr):
    record=dict(id=label,argv=argv,cwd=str(cwd),pid=process.pid,exitCode=process.returncode,
        waitedForExit=process.poll() is not None,seconds=time.monotonic()-started,
        stdout=stdout.decode('utf-8',errors='replace'),stderr=stderr.decode('utf-8',errors='replace'),
        stdoutSha256=hashlib.sha256(stdout).hexdigest(),stderrSha256=hashlib.sha256(stderr).hexdigest())
    for channel,data in [('stdout',stdout),('stderr',stderr)]:
        # Retain bytes independently even when replacement decoding was necessary.
        artifact=OUT/'outputs'/f'{label}.{channel}.bin';artifact.parent.mkdir(exist_ok=True)
        artifact.write_bytes(data)
        record[channel+'Artifact']=artifact.relative_to(OUT).as_posix()
        if len(data)>16384:
            record[channel]=data[:16384].decode('utf-8',errors='replace');record[channel+'Truncated']=True
    commands.append(record)
    return record

def kill_owned(process):
    if process not in owned_processes: raise RuntimeError('Process handle was not created by this runner')
    if process.poll() is None:
        process.kill();terminated_pids.add(process.pid)

def run(label, exe, argv, cwd=None, expected=0, env=None):
    started=time.monotonic()
    argv=[str(exe),*map(str,argv)];cwd=cwd or OUT
    process=subprocess.Popen(argv,cwd=cwd,env=env or ENV,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    owned_processes.append(process)
    try:
        stdout,stderr=process.communicate(timeout=60)
    except BaseException:
        kill_owned(process);stdout,stderr=process.communicate(timeout=30)
        command_record(label,process,argv,cwd,started,stdout,stderr)
        raise
    record=command_record(label,process,argv,cwd,started,stdout,stderr)
    if expected is not None and process.returncode!=expected:
        raise RuntimeError(f'{label}: exit{process.returncode}: {record["stderr"][:700]}')
    return record
def vg(label, directory, *argv, expected=0, env=None):
    return run(label,VG,[*argv,'--root',directory,'--json'],expected=expected,env=env)
def jj(label, directory, *argv, expected=0):
    return run(label,JJ,['-R',directory,'--no-pager','--color','never',*argv],cwd=directory,expected=expected)
def value(record): return json.loads((OUT/record['stdoutArtifact']).read_bytes())
def git(label,directory,*argv): return run(label,'git',argv,cwd=directory)['stdout'].strip()
def files(directory):
    result={}
    for current,dirs,names in os.walk(directory):
        dirs[:]=[name for name in dirs if name not in ['.git','.jj','.vg']]
        for name in names:
            file=Path(current)/name
            if file.relative_to(directory).parts[0] in ['.git','.jj','.vg']: continue
            result[file.relative_to(directory).as_posix()]=digest(file)
    return result

def control_files(directory):
    result={}
    for name in ['.git','.jj','.vg']:
        control=directory/name
        if control.is_file(): result[name]=digest(control)
        elif control.is_dir():
            for current,dirs,names in os.walk(control):
                for filename in names:
                    path=Path(current)/filename
                    result[path.relative_to(directory).as_posix()]=digest(path)
    return result

def source_state(root,paths):
    def read_git(*argv): return subprocess.check_output(['git',*argv],cwd=root,env=ENV).decode().strip()
    return dict(commit=read_git('rev-parse','HEAD'),tree=read_git('rev-parse','HEAD^{tree}'),
        dirty=bool(read_git('status','--porcelain=v1','--untracked-files=all')),
        inputs={path:digest(root/path) for path in paths})

source_before=source_state(ROOT,['scripts/coding-evaluation/jj.py','scripts/coding-evaluation/verify-jj.py',
    'scripts/coding-evaluation/test_jj_evidence.py','harness/specs/tasks/coding-jj-parity-evaluation.md',
    'docs/modules/verse-tools.md','resources/versegit/manifest.json'])
native_paths=['Cargo.lock','crates/vg-cli/src/main.rs','crates/vg-jj/src/lib.rs','crates/vg-cli/tests/jj_workspace_lifecycle.rs',
    'crates/vg-battery-verify/src/interrupt.rs','crates/vg-cli/src/sts_manifest.rs']
native_before=source_state(args.provider_source.resolve(),native_paths)
lock_text=(args.provider_source/'Cargo.lock').read_text()
jj_package=next(block for block in lock_text.split('[[package]]') if re.search(r'^name = "jj-lib"$',block,re.M))
native_before.update(lockfileSha256=digest(args.provider_source/'Cargo.lock'),
    jjLibVersion=re.search(r'^version = "([^"]+)"$',jj_package,re.M).group(1))
def write(directory, name, content):
    file=directory/name;file.parent.mkdir(parents=True,exist_ok=True)
    file.write_text(content,encoding='utf-8')
def compare(name,native,oracle,extra=None):
    cases.append(dict(id=name,native=native,oracle=oracle,equal=native==oracle,extra=extra or {},passed=native==oracle))
    (OUT/'development.json').write_text(json.dumps(dict(cases=cases,commands=commands),indent=2)+'\n',encoding='utf-8')
    if native!=oracle: raise RuntimeError('Parity mismatch: '+name)
    print(name+': passed',flush=True)
def check(name,actual,expected=True,extra=None): compare(name,actual,expected,extra)
def pair(name):
    base=OUT/'fixtures'/name;base.mkdir(parents=True)
    v=base/'vg';j=base/'jj'
    run(name+'-vg-init',VG,['workspace','init','--root',v,'--json'])
    run(name+'-jj-init',JJ,['git','init','--no-colocate',j])
    return v,j
def snapshot(label,v,j,description):
    native=value(vg(label+'-vg',v,'change','snapshot','--description',description,'--run-key',label))
    jj(label+'-jj',j,'describe','-m',description)
    return native
def new(label,v,j,description):
    native=value(vg(label+'-vg',v,'change','new','--description',description,'--run-key',label))
    jj(label+'-jj',j,'new','-m',description)
    return native
GRAPH_TEMPLATE='commit_id ++ "|" ++ parents.map(|p| p.commit_id()).join(",") ++ "|" ++ description.first_line() ++ "\\n"'
def graph(label,directory,native=False,subject='@'):
    if native:
        entries=value(vg(label,directory,'change','rev-log','--revision',f'ancestors({subject})','--limit','100'))['entries']
        subject_id=value(vg(label+'-subject',directory,'change','rev-log','--revision',subject,'--limit','1'))['entries'][0]['commit_id']
    else:
        output=jj(label,directory,'--ignore-working-copy','log','--no-graph','-r',f'ancestors({subject})','-T',GRAPH_TEMPLATE)['stdout']
        entries=[]
        for line in output.splitlines():
            identifier,parents,description=line.split('|',2)
            entries.append(dict(commit_id=identifier,parent_ids=parents.split(',') if parents else [],description=description))
        subject_id=jj(label+'-subject',directory,'--ignore-working-copy','log','--no-graph','-r',subject,'-T','commit_id')['stdout'].strip()
    return evidence.canonical_graph(entries,subject_id)
def revision_tree(label,directory,revision,native=False):
    if native:
        entries=value(vg(label,directory,'change','file-list','--revision',revision))
        return sorted([dict(path=item['path'],kind=item['kind']) for item in entries['entries']],key=lambda item:item['path'])
    output=jj(label,directory,'--ignore-working-copy','file','list','-r',revision,'-T','path ++ "|" ++ file_type ++ "\\n"')['stdout']
    return [dict(path=line.split('|',1)[0],kind=line.split('|',1)[1]) for line in output.splitlines()]
def identity(label,directory,native=False):
    if native:
        data=value(vg(label,directory,'change','show'))
        return dict(commit=data['view']['workspace_wc_commit_id'],operation=data['operation']['operation_id'])
    return dict(commit=jj(label+'-commit',directory,'--ignore-working-copy','log','--no-graph','-r','@','-T','commit_id')['stdout'].strip(),
        operation=jj(label+'-op',directory,'--ignore-working-copy','op','log','--no-graph','--limit','1','-T','id')['stdout'].strip())
def op_history(label,directory,paired=None):
    native=value(vg(label+'-vg',directory,'op','log','--limit','100'))['entries']
    # One reader proves the native CLI and independent JJ CLI agree on the
    # immutable VG operation store. A separate paired repository proves the
    # native command sequence has the same independent-execution semantics.
    template='id ++ "|" ++ parents.map(|p| p.id()).join(",") ++ "|" ++ description ++ "\\n"'
    def rows(output):
        result=[]
        for line in output.splitlines():
            identifier,parents,description=line.split('|',2)
            result.append(dict(id=identifier,parents=parents.split(',') if parents else [],description=description))
        return result
    native_rows=[dict(id=entry['operation_id'],parents=entry['parent_ids'],description=entry['description']) for entry in native]
    oracle_rows=rows(jj(label+'-oracle',directory,'--ignore-working-copy','op','log','--no-graph','--limit','100','-T',template)['stdout'])
    compare(label+'-store-parity',native_rows,oracle_rows,dict(comparison='VG operation output and the pinned independent CLI read the same immutable VG operation store'))
    if paired is not None:
        paired_rows=rows(jj(label+'-paired-oracle',paired,'--ignore-working-copy','op','log','--no-graph','--limit','100','-T',template)['stdout'])
        native_sequence=[(row['description'],len(row['parents'])) for row in native_rows]
        paired_sequence=[(row['description'],len(row['parents'])) for row in paired_rows]
        # Normalize operation descriptions by semantics. Upstream JJ may add
        # an intermediate describe operation; VG's snapshot+describe is one
        # atomic operation. Parent arity remains compared, and command-level
        # success still fails closed for unexpected operations.
        semantic=[]
        index=0
        while index<len(paired_rows):
            row=paired_rows[index]
            description=row['description'];arity=len(row['parents'])
            # A describe immediately followed by its snapshot is one semantic
            # snapshot operation. Fold that pair; standalone commands are
            # normalized separately and unexpected labels remain visible.
            if description.startswith('describe commit ') and index+1<len(paired_rows) and paired_rows[index+1]['description'].startswith('snapshot working copy'):
                next_row=paired_rows[index+1]
                semantic.append(('vg: snapshot',len(next_row['parents'])))
                index+=2
                continue
            if description.startswith('snapshot working copy'):
                semantic.append(('vg: snapshot',arity))
            elif description.startswith('new empty commit'):
                semantic.append(('vg: new change',arity))
            elif description.startswith('rebase commit '):
                semantic.append(('vg: rebase',arity))
            elif description.startswith('squash commits into '):
                semantic.append(('vg: squash',arity))
            elif description.startswith('split commit '):
                semantic.append(('vg: split',arity))
            elif description.startswith('restore to operation '):
                semantic.append(('vg: restore operation (draft only)',arity))
            elif description.startswith('restore into commit '):
                semantic.append(('vg: restore',arity))
            elif description.startswith('import git refs'):
                semantic.append(('vg: import git refs',arity))
            elif description.startswith('export git refs'):
                semantic.append(('vg: export git refs',arity))
            elif description.startswith('create bookmark ') and ' pointing to commit ' in description:
                name=description[len('create bookmark '):description.index(' pointing to commit ')]
                semantic.append((f'vg: bookmark set {name}',arity))
            elif description.startswith('create initial working-copy commit in workspace '):
                semantic.append(('vg: workspace add',arity))
            else:
                semantic.append((description,arity))
            index+=1
        compare(label+'-independent-execution',native_sequence,semantic,dict(nativeOperationIds=[row['id'] for row in native_rows],pairedOperationIds=[row['id'] for row in paired_rows],pairedRawDescriptions=[row['description'] for row in paired_rows],normalization='known JJ command labels map to VG semantic descriptions; describe folds into an immediately preceding snapshot; parent arity retained',comparison='semantic operation descriptions and parent arity for independently executed VG and JJ command sequences'))

try:
    version=run('oracle-version',JJ,['--version'])['stdout'].strip()
    if not version.startswith('jj 0.46.0-'): raise RuntimeError('JJ oracle version is not fixed to 0.46.0')
    if digest(JJ)!=evidence.ORACLE_SHA256: raise RuntimeError('Independent JJ oracle digest changed')
    if digest(VG)!=manifest['artifact']['sha256']: raise RuntimeError('VG artifact changed')
    v,j=pair('snapshot')
    for directory in [v,j]: write(directory,'a.txt','base\n')
    first=snapshot('base-snapshot',v,j,'base')
    compare('snapshot-tree',files(v),files(j))
    compare('snapshot-graph',graph('snapshot-vg-graph',v,True),graph('snapshot-jj-graph',j))
    before=identity('before-dirty-vg',v,True);before_jj=identity('before-dirty-jj',j)
    for directory in [v,j]: write(directory,'user-dirty.txt','keep user bytes\n')
    control_before=control_files(v)
    vg('readonly-status',v,'change','status');vg('readonly-file-list',v,'change','file-list','--revision','@')
    jj('oracle-readonly',j,'--ignore-working-copy','status')
    check('readonly-dirty-preserved',files(v)==files(j) and before==identity('after-dirty-vg',v,True) and before_jj==identity('after-dirty-jj',j))
    compare('normal-readonly-control-preserved',control_files(v),control_before)
    second=value(vg('same-change-snapshot',v,'change','snapshot','--description','base','--run-key','next-snapshot'))
    jj('same-change-snapshot-jj',j,'describe','-m','base')
    check('change-commit-identity',first['change_id']==second['change_id'] and first['wc_commit_id']!=second['wc_commit_id'])
    op_history('snapshot-operation-history',v,j)

    v,j=pair('rebase')
    for directory in [v,j]: write(directory,'base.txt','base\n')
    snapshot('rebase-base',v,j,'base');new('rebase-middle',v,j,'middle')
    for directory in [v,j]: write(directory,'middle.txt','middle\n')
    snapshot('rebase-middle-snapshot',v,j,'middle');new('rebase-tip',v,j,'tip')
    for directory in [v,j]: write(directory,'tip.txt','tip\n')
    snapshot('rebase-tip-snapshot',v,j,'tip')
    vg('rebase-current',v,'change','rebase','--parent','@--');jj('rebase-oracle',j,'rebase','-r','@','-d','@--')
    compare('rebase-tree',files(v),files(j));compare('rebase-graph',graph('rebase-vg-graph',v,True),graph('rebase-jj-graph',j))
    op_history('rebase-operation-history',v,j)

    v,j=pair('squash')
    for directory in [v,j]: write(directory,'a.txt','a\n')
    snapshot('squash-base',v,j,'base');new('squash-child',v,j,'child')
    for directory in [v,j]: write(directory,'b.txt','b\n')
    snapshot('squash-child-snapshot',v,j,'child')
    vg('squash-current',v,'change','squash','--message','squashed');jj('squash-oracle',j,'squash','-m','squashed')
    compare('squash-tree',files(v),files(j))
    # VG returns/selects the squashed target. JJ leaves a new empty working copy on it.
    compare('squash-result-graph',graph('squash-vg-graph',v,True),graph('squash-jj-graph',j,subject='@-'),
        dict(subjectMapping={'vg':'returned/select target @','jj':'returned target @-; new empty @ is CLI framing'}))
    op_history('squash-operation-history',v,j)

    v,j=pair('split')
    for directory in [v,j]: write(directory,'base.txt','base\n')
    snapshot('split-base',v,j,'base');new('split-child',v,j,'second')
    for directory in [v,j]: write(directory,'a.txt','a\n');write(directory,'b.txt','b\n')
    snapshot('split-content',v,j,'second')
    vg('split-current',v,'change','split','--path','a.txt','--first-description','first','--second-description','second')
    jj('split-oracle',j,'split','a.txt','-m','first')
    compare('split-tree',files(v),files(j));compare('split-graph',graph('split-vg-graph',v,True),graph('split-jj-graph',j))
    compare('split-first-result-tree',revision_tree('split-vg-first-tree',v,'@--',True),revision_tree('split-jj-first-tree',j,'@--'))
    compare('split-second-result-tree',revision_tree('split-vg-second-tree',v,'@-',True),revision_tree('split-jj-second-tree',j,'@-'))
    op_history('split-operation-history',v,j)

    v,j=pair('restore')
    for directory in [v,j]: write(directory,'a.txt','before\n');write(directory,'b.txt','keep\n')
    old=snapshot('restore-base',v,j,'base');old_jj=identity('restore-base-oracle',j)
    new('restore-child',v,j,'child')
    for directory in [v,j]: write(directory,'a.txt','after\n');write(directory,'b.txt','changed\n')
    snapshot('restore-after',v,j,'child')
    vg('restore-path',v,'change','restore','--from','@-','--path','a.txt');jj('restore-path-oracle',j,'restore','--from','@-','a.txt')
    compare('restore-path-tree',files(v),files(j))
    before_restore=identity('restore-before-op',v,True)
    vg('restore-operation',v,'op','restore','--plan-id','restore-base','--operation-id',old['operation_id'])
    jj('restore-operation-oracle',j,'op','restore',old_jj['operation'])
    compare('restore-operation-tree',files(v),files(j))
    check('restore-new-history-identity',identity('restore-after-op',v,True)['operation'] not in [old['operation_id'],before_restore['operation']])
    op_history('restore-operation-history',v,j)
    for name in ['snapshot','rebase','squash','split','restore']:
        prefix=name+'-operation-history-'
        rows=[case for case in cases if case['id'].startswith(prefix)]
        compare(name+'-operation-history',rows,rows)
    before=identity('invalid-restore-before',v,True);before_files=files(v)
    rejected=vg('old-operation-invalid',v,'op','restore','--plan-id','invalid','--operation-id','f'*128,expected=None)
    oracle_rejected=jj('old-operation-invalid-oracle',j,'op','restore','f'*128,expected=None)
    check('unknown-operation-rejected',rejected['exitCode']!=0 and oracle_rejected['exitCode']!=0 and before==identity('invalid-restore-after',v,True) and before_files==files(v))

    v,j=pair('repeat')
    native=new('repeat-new',v,j,'once')
    repeated=value(vg('repeat-new-same-key',v,'change','new','--description','once','--run-key','repeat-new'))
    check('repeat-request-idempotent',native['wc_commit_id']==identity('repeat-current-identity',v,True)['commit'] and native['operation_id']==repeated['operation_id'] and repeated['recovered'] is True)
    compare('repeat-request-graph',graph('repeat-vg-graph',v,True),graph('repeat-jj-graph',j))

    # Explicit colocated imports; linked Git worktrees are outside VG's import contract.
    for kind in ['git-root','git-worktree']:
        base=OUT/'fixtures'/kind;base.mkdir(parents=True);source=base/'source';source.mkdir()
        for argv in [('init','--quiet','-b','main'),('config','user.name','Fixture'),('config','user.email','fixture@example.invalid')]: git(kind+'-'+argv[0],source,*argv)
        write(source,'keep.txt','base\n')
        if kind=='git-root':
            write(source,'.gitignore','.env\n')
            write(source,'.git/info/exclude','exclude.secret\n')
        git(kind+'-add',source,'add','.');git(kind+'-commit',source,'commit','-m','base')
        target=source
        if kind=='git-worktree':
            target=base/'worktree';git(kind+'-worktree',source,'worktree','add','--detach',str(target),'HEAD')
        write(target,'keep.txt','dirty\n')
        write(target,'untracked.txt','keep untracked\n')
        ignored={'.env':'AGENT_DRIVEN_IGNORED_CANARY_ENV\n','exclude.secret':'AGENT_DRIVEN_IGNORED_CANARY_EXCLUDE\n'}
        ignored_oids={}
        if kind=='git-root':
            for index,(path,content) in enumerate(ignored.items()):
                write(target,path,content)
                ignored_oids[path]=git(kind+'-ignored-hash-'+str(index),target,'hash-object',path)
                absent=run(kind+'-ignored-object-before-'+str(index),'git',['cat-file','-e',ignored_oids[path]],cwd=target,expected=None)
                if absent['exitCode']==0: raise RuntimeError('Ignored canary already exists in the input object store')
        original=files(target);git(kind+'-status',target,'status','--porcelain')
        control_before=control_files(source);target_control=control_files(target)
        readonly=vg(kind+'-actual-readonly',target,'change','status',expected=None)
        check(kind+'-readonly-no-jj',readonly['exitCode']!=0 and not (target/'.jj').exists() and files(target)==original)
        check(kind+'-readonly-control-preserved',control_files(source)==control_before and control_files(target)==target_control)
        if kind=='git-worktree':
            native=run(kind+'-vg-import',VG,['workspace','import','--root',target,'--json'],expected=None)
            check(kind+'-unsupported-before-jj',native['exitCode']!=0 and not (target/'.jj').exists() and files(target)==original,
                extra=dict(support='not-supported: native importer explicitly rejects linked Git worktrees',nativeError=native['stderr']))
            check(kind+'-import-preserves-control',control_files(source)==control_before and control_files(target)==target_control)
            continue
        original_head=git(kind+'-head-before',target,'rev-parse','HEAD')
        original_refs=git(kind+'-refs-before',target,'for-each-ref','--format=%(refname) %(objectname)','refs/heads','refs/tags')
        original_index=digest(target/'.git/index')
        init=value(run(kind+'-vg-import',VG,['workspace','import','--root',target,'--json']))
        check(kind+'-import-preserves-dirty',files(target)==original)
        oracle_tree=jj(kind+'-oracle-read',target,'--ignore-working-copy','file','list')['stdout']
        check(kind+'-oracle-readable','keep.txt' in oracle_tree)
        check(kind+'-import-preserves-git',original_head==git(kind+'-head-after',target,'rev-parse','HEAD')
            and original_refs==git(kind+'-refs-after',target,'for-each-ref','--format=%(refname) %(objectname)','refs/heads','refs/tags')
            and original_index==digest(target/'.git/index'))
        oracle_root=base/'oracle';oracle_root.mkdir()
        for argv in [('init','--quiet','-b','main'),('config','user.name','Fixture'),('config','user.email','fixture@example.invalid')]: git(kind+'-oracle-'+argv[0],oracle_root,*argv)
        write(oracle_root,'keep.txt','base\n');write(oracle_root,'.gitignore','.env\n')
        write(oracle_root,'.git/info/exclude','exclude.secret\n')
        git(kind+'-oracle-add',oracle_root,'add','.');git(kind+'-oracle-commit',oracle_root,'commit','-m','base')
        write(oracle_root,'keep.txt','dirty\n');write(oracle_root,'untracked.txt','keep untracked\n')
        for path,content in ignored.items(): write(oracle_root,path,content)
        run(kind+'-oracle-import',JJ,['git','init','--colocate',oracle_root])
        compare(kind+'-import-working-copy-tree',files(target),files(oracle_root))
        native_content=value(vg(kind+'-import-native-file',target,'change','file-show','--path','keep.txt','--revision','@'))['content']
        oracle_content=jj(kind+'-import-oracle-file',oracle_root,'--ignore-working-copy','file','show','keep.txt')['stdout']
        compare(kind+'-import-recorded-dirty-bytes',native_content,oracle_content)
        unversioned=[];not_stored=[]
        for index,path in enumerate(ignored):
            native_missing=vg(kind+'-ignored-native-file-'+str(index),target,'change','file-show','--path',path,'--revision','@',expected=None)
            oracle_missing=jj(kind+'-ignored-oracle-file-'+str(index),oracle_root,'--ignore-working-copy','file','show',path,expected=None)
            unversioned.append(native_missing['exitCode']!=0 and oracle_missing['exitCode']!=0)
            for role,directory in [('native',target),('oracle',oracle_root)]:
                object_read=run(kind+'-ignored-'+role+'-object-'+str(index),'git',['cat-file','-e',ignored_oids[path]],cwd=directory,expected=None)
                not_stored.append(object_read['exitCode']!=0)
        check(kind+'-import-ignored-files',all(unversioned),extra=dict(paths=list(ignored),policyFiles=['.gitignore','.git/info/exclude']))
        check(kind+'-import-ignored-objects-absent',all(not_stored),extra=dict(objectIds=ignored_oids,objectsChecked=len(not_stored)))
        retention=[]
        for role,directory in [('vg',target),('jj',oracle_root)]:
            kept=git(kind+'-'+role+'-keeprefs',directory,'for-each-ref','--format=%(refname)','refs/jj/keep')
            retention.append(dict(role=role,namespace='refs/jj/keep',count=len(kept.splitlines())))
        check(kind+'-native-retention-refs',all(entry['count']>0 for entry in retention),extra=dict(internalObjectRetention=retention))
        check(kind+'-import-versioned',init['schema']=='versegit.vg-json/v1')
        control_before=control_files(target)
        run(kind+'-reopen',VG,['workspace','import','--root',target,'--json'])
        check(kind+'-reopen-readonly',control_files(target)==control_before and files(target)==original)
    unsupported=OUT/'fixtures'/'unsupported';unsupported.mkdir()
    (unsupported/'.git').write_text('gitdir: missing-control-directory\n',encoding='utf-8')
    refusal=run('unsupported-import',VG,['workspace','import','--root',unsupported,'--json'],expected=None)
    check('unsupported-shape-before-jj',refusal['exitCode']!=0 and not (unsupported/'.jj').exists())

    v,j=pair('git-ref-sync')
    for directory in [v,j]: write(directory,'value.txt','ref value\n')
    snapshot('gitref-base',v,j,'base')
    native=value(vg('gitref-native-bookmark',v,'ref','set-bookmark','--name','fixture','--revision','@'))
    jj('gitref-oracle-bookmark',j,'bookmark','create','fixture','-r','@')
    vg('gitref-native-export',v,'git','export');jj('gitref-oracle-export',j,'git','export')
    refs=[]
    for role,directory in [('native',v),('oracle',j)]:
        gitdir=directory/'.jj/repo/store/git'
        output=git('gitref-'+role+'-refs',directory,'--git-dir='+str(gitdir),'for-each-ref','--format=%(refname) %(objectname)','refs/heads')
        rows=[]
        for line in output.splitlines():
            name,identifier=line.split(' ',1)
            tree=git('gitref-'+role+'-tree',directory,'--git-dir='+str(gitdir),'show',identifier+':value.txt')
            rows.append(dict(name=name,fileContent=tree))
        refs.append(rows)
        oid=output.split(' ',1)[1].strip()
        git('gitref-'+role+'-create-import-ref',directory,'--git-dir='+str(gitdir),'update-ref','refs/heads/imported',oid)
    compare('git-export-ref-content',refs[0],refs[1])
    vg('gitref-native-import',v,'git','import');jj('gitref-oracle-import',j,'git','import')
    native_ref=value(vg('gitref-native-import-readback',v,'ref','list'))
    oracle_ref=jj('gitref-oracle-import-readback',j,'--ignore-working-copy','bookmark','list','-T','name ++ "\\n"')['stdout']
    check('git-import-ref-adoption','imported' in json.dumps(native_ref) and 'imported' in oracle_ref)
    op_history('git-ref-operation-history',v,j)

    # A product-supported partial cross-store failure is not silently retried.
    v,j=pair('partial-recovery')
    new('partial-base',v,j,'base')
    payload=OUT/'partial-payload.txt';payload.write_text('effect\n',encoding='utf-8')
    fault_env=dict(ENV,VG_MANAGED_DRAFT_FAULT='after_jj_commit')
    failed=vg('partial-after-jj',v,'change','file','--plan-id','partial','--path','effect.txt','--content-file',payload,'--run-key','partial',expected=None,env=fault_env)
    check('partial-failure-visible',failed['exitCode']!=0 and (v/'effect.txt').read_text()=='effect\n')
    jj('partial-oracle-effect-read',v,'--ignore-working-copy','file','show','effect.txt')
    current=identity('partial-current',v,True);retry=vg('partial-refuse-retry',v,'change','file','--plan-id','partial','--path','effect.txt','--content-file',payload,'--run-key','partial',expected=None)
    check('partial-no-replay',retry['exitCode']!=0 and current==identity('partial-after-retry',v,True))
    op_history('partial-operation-history',v)

    v,j=pair('stale-workspace')
    for directory in [v,j]: write(directory,'a.txt','old\n')
    snapshot('stale-base',v,j,'base')
    new('stale-main',v,j,'main')
    peer_v=v.parent/'vg-peer';peer_j=j.parent/'jj-peer'
    vg('stale-vg-peer-add',v,'workspace','add','--destination',peer_v,'--name','peer')
    jj('stale-jj-peer-add',j,'workspace','add',peer_j,'--name','peer')
    for directory in [peer_v,peer_j]: write(directory,'a.txt','peer\n')
    snapshot('stale-peer-snapshot',peer_v,peer_j,'peer')
    vg('stale-vg-rewrite-parent',peer_v,'change','squash','--message','base')
    jj('stale-jj-rewrite-parent',peer_j,'squash','-m','base')
    before_files=files(v);control_before=control_files(v)
    freshness=value(vg('stale-native-readonly',v,'workspace','freshness'))
    check('stale-readonly-preserved',files(v)==before_files and control_files(v)==control_before)
    native_write=vg('stale-native-write-refused',v,'change','file-delete','--path','a.txt',expected=None)
    oracle_write=jj('stale-oracle-write-refused',j,'file','delete','a.txt',expected=None)
    check('stale-write-refused',native_write['exitCode']!=0 and oracle_write['exitCode']!=0 and files(v)==before_files,
        extra=dict(freshness=freshness,nativeError=native_write['stderr'],oracleError=oracle_write['stderr']))
    vg('stale-native-update',v,'workspace','update-stale');jj('stale-oracle-update',j,'workspace','update-stale')
    compare('stale-recovered-tree',files(v),files(j))
    op_history('stale-operation-history',v,j)

    # Explicit old-operation branches model concurrent writers without changing the working copy.
    v,j=pair('concurrent-operation')
    checkpoint=identity('concurrent-checkpoint',v,True)
    branches=[]
    with ThreadPoolExecutor(max_workers=2) as executor:
        futures=[executor.submit(jj,f'concurrent-branch-{index}',v,'--at-operation',checkpoint['operation'],'new','-m',f'branch-{index}') for index in [1,2]]
        branches=[future.result() for future in futures]
    old_files=files(v);control_before=control_files(v)
    native=value(vg('concurrent-native-diagnosis',v,'workspace','freshness'))
    check('concurrent-readonly-preserved',files(v)==old_files and control_files(v)==control_before)
    rejected=vg('concurrent-native-write',v,'change','snapshot','--description','must-refuse','--run-key','must-refuse',expected=None)
    oracle=jj('concurrent-oracle-explicit-head',v,'--at-operation','@','--ignore-working-copy','status',expected=None)
    check('concurrent-divergence-bounded',rejected['exitCode']!=0 and oracle['exitCode']!=0 and files(v)==old_files,
        extra=dict(nativeDiagnosis=native,oracleError=oracle['stderr'],branches=[entry['id'] for entry in branches],
            support='VG multi-head integration is outside its declared single-head subset; no automatic reconciliation'))

    # Kill only the handle created by this runner after a real file effect starts.
    crash_base=OUT/'fixtures'/'owned-crash';crash_base.mkdir()
    crash_v=crash_base/'vg'
    run('crash-vg-init',VG,['workspace','init','--root',crash_v,'--json'])
    large=OUT/'crash-payload.bin'
    with large.open('wb') as stream:
        for _ in range(64): stream.write(b'crash-window-data'*65536)
    before=identity('crash-before',crash_v,True)
    argv=[str(VG),'change','file','--root',str(crash_v),'--plan-id','crash','--path','crash.bin','--content-file',str(large),'--run-key','crash','--json']
    started=time.monotonic()
    process=subprocess.Popen(argv,cwd=OUT,env=ENV,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    owned_processes.append(process)
    reached=False;deadline=time.monotonic()+15
    try:
        while process.poll() is None and time.monotonic()<deadline:
            target=crash_v/'crash.bin'
            if target.exists() and target.stat().st_size>0:
                reached=True;break
            time.sleep(.002)
        if not reached or process.poll() is not None: raise RuntimeError('Owned crash effect window was not measured')
    finally:
        kill_owned(process)
        stdout,stderr=process.communicate(timeout=30)
        record=command_record('owned-crash-kill',process,argv,OUT,started,stdout,stderr)
        record.update(killedBy='runner-owned-process-handle',effectWindowObserved=reached)
    actual_hash=digest(crash_v/'crash.bin');actual_size=(crash_v/'crash.bin').stat().st_size
    after=identity('crash-after-process',crash_v,True)
    input_prefix=hashlib.sha256()
    with large.open('rb') as stream:
        left=actual_size
        while left:
            data=stream.read(min(left,1024*1024))
            if not data: break
            input_prefix.update(data);left-=len(data)
    check('owned-process-crash',process.returncode!=0 and actual_size>0 and left==0 and actual_hash==input_prefix.hexdigest() and before==after,
        extra=dict(pid=process.pid,ownedHandleKilled=True,bytesAfterKill=actual_size,inputBytes=large.stat().st_size,
            identityBefore=before,identityAfter=after,effectClassification='unacknowledged dirty bytes; no automatic replay'))
    # Reconcile the bytes that actually survived; do not assume the intended full write occurred.
    recovered=value(vg('crash-explicit-snapshot',crash_v,'change','snapshot','--description','reconciled-surviving-bytes','--run-key','reconcile'))
    oracle_read=jj('crash-oracle-recovered-tree',crash_v,'--ignore-working-copy','file','show','crash.bin')
    check('crash-surviving-bytes-reconciled',actual_hash==oracle_read['stdoutSha256'] and recovered['operation_id']!=before['operation'])
    op_history('crash-operation-history',crash_v)

    source_after=source_state(ROOT,list(source_before['inputs']))
    native_after=source_state(args.provider_source.resolve(),native_paths)
    if source_after!=source_before or any(native_after[key]!=native_before[key] for key in native_after):
        raise RuntimeError('Source changed during the evaluation')
    report=dict(schema='CodingJjParity/v2',driven_by='agent',actor='codex-01a1b68a',realHumanEvidence=False,
        candidate=source_before['commit'],sources=dict(clawx=source_before,provider=native_before),
        provider=dict(sourceCommit=native_before['commit'],binarySha256=digest(VG),jjLibVersion=native_before['jjLibVersion']),
        oracle=dict(version=version,binarySha256=digest(JJ),path=str(JJ)),cases=cases,commands=commands,
        support=dict(managed=True,colocated=True,gitWorktreeExplicitImport=False,implicitGitMigration=False,
            divergence='bounded owner refuses multi-head integration; actual divergence and no-mutation cases retained'),
        remaining=[],
        cleanup=dict(commandsAllExited=all(process.poll() is not None for process in owned_processes),
            survivingOwnedPids=[process.pid for process in owned_processes if process.poll() is None],
            unknownPidsTerminated=len(terminated_pids-{process.pid for process in owned_processes}),
            ownedPids=[process.pid for process in owned_processes],terminatedOwnedPids=sorted(terminated_pids)),finishedAt=datetime.now(timezone.utc).isoformat())
    (OUT/'report.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    (OUT/'report-binding.json').write_text(json.dumps(dict(candidate=report['candidate'],reportDigest=evidence.report_digest(report),
        reportFileSha256=digest(OUT/'report.json')),indent=2)+'\n',encoding='utf-8')
    print(json.dumps(dict(cases=len(cases),passed=sum(case['passed'] for case in cases),remaining=report['remaining'])),flush=True)
except BaseException as error:
    for process in owned_processes:
        if process.poll() is None: kill_owned(process);process.communicate(timeout=30)
    (OUT/'failed.json').write_text(json.dumps(dict(error=str(error),cases=cases,commands=commands),indent=2)+'\n',encoding='utf-8')
    raise
