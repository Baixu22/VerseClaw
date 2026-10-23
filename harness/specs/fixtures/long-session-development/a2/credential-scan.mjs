import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const root='D:/ClawX-work/worktrees/long-session-program-r2';
const base='f95530a0b';
const git='C:/Program Files/Git/cmd/git.exe';
const tracked=execFileSync(git,['diff','--name-only',base,'HEAD'],{cwd:root,encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean);
const untracked=execFileSync(git,['ls-files','--others','--exclude-standard'],{cwd:root,encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean);
const files=[...new Set([...tracked,...untracked])].filter(file=>fs.existsSync(root+'/'+file)&&!/\.(png|jpg|jpeg|gif|webp|zip|pdf|woff2?|ico|exe)$/i.test(file));
const patterns=[
 ['private-key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
 ['openai-key',/\bsk-[A-Za-z0-9_-]{20,}\b/g],
 ['github-token',/\bgh[pousr]_[A-Za-z0-9]{30,}\b/g],
 ['aws-access-key',/\bAKIA[0-9A-Z]{16}\b/g],
 ['generic-secret-assignment',/(?:api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token)\s*[:=]\s*['"][A-Za-z0-9_\-]{24,}['"]/gi],
];
const findings=[];
for(const file of files){let text;try{text=fs.readFileSync(root+'/'+file,'utf8')}catch{continue}for(const [kind,re] of patterns){re.lastIndex=0;if(re.test(text))findings.push({file,kind});}}
const receipt={schema:'clawx.long-session.credential-scan/v1',driven_by:'agent',actor:'codex-long-session-r2',scannedFiles:files.length,hits:findings.length,findings,files,patterns:patterns.map(([kind])=>kind),scope:'clean candidate diff plus any untracked intended artifacts; key/private-key patterns; no secret values emitted'};
fs.writeFileSync('D:/tmp/long-session-r2-20261023/a2-credential-scan.json',JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify({scannedFiles:files.length,hits:findings.length}));
process.exit(findings.length?1:0);
