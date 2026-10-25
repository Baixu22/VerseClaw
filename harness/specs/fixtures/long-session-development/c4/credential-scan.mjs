import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
const root='D:/ClawX-work/worktrees/long-session-program-r2';
const git='C:/Program Files/Git/cmd/git.exe';
const base='943b78a3f';
const tracked=execFileSync(git,['diff','--name-only',base,'HEAD'],{cwd:root,encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean);
const untracked=execFileSync(git,['ls-files','--others','--exclude-standard'],{cwd:root,encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean);
const files=[...new Set([...tracked,...untracked])].filter(f=>fs.existsSync(root+'/'+f)&&!/\.(png|jpg|jpeg|webp|zip|pdf|woff2?|ico|exe)$/i.test(f));
const patterns=[['private-key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],['openai-key',/\bsk-[A-Za-z0-9_-]{20,}\b/g],['github-token',/\bgh[pousr]_[A-Za-z0-9]{30,}\b/g],['aws-access-key',/\bAKIA[0-9A-Z]{16}\b/g]];
const findings=[];
for(const file of files){const text=fs.readFileSync(root+'/'+file,'utf8');for(const [kind,re] of patterns){re.lastIndex=0;if(re.test(text))findings.push({file,kind});}}
const out={schema:'clawx.long-session.credential-scan/v1',driven_by:'agent',actor:'codex-long-session-r2',scannedFiles:files.length,hits:findings.length,findings,files,patterns:patterns.map(([kind])=>kind),scope:'clean C4 candidate source files; no secret values emitted'};
fs.writeFileSync('C:/Users/27933/AppData/Local/Temp/long-session-c4-final/run/c4-credential-scan.json',JSON.stringify(out,null,2)+'\n');
console.log(JSON.stringify({scannedFiles:files.length,hits:findings.length}));
process.exit(findings.length?1:0);