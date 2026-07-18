@echo off
cd /d C:\Users\27933\Desktop\clawx\ClawX-maturity-p7
set LOG=artifacts\system-maturity\P7-004\final-seal.stdout.log
set ERR=artifacts\system-maturity\P7-004\final-seal.stderr.log
> %LOG% echo final-seal-start
node scripts/sync-system-maturity-index.mjs >> %LOG% 2>> %ERR%
echo SYNC=%ERRORLEVEL% >> %LOG%
node scripts/update-system-maturity-delivery-hashes.mjs >> %LOG% 2>> %ERR%
echo HASH1=%ERRORLEVEL% >> %LOG%
call pnpm maturity:validate >> %LOG% 2>> %ERR%
echo VALIDATE=%ERRORLEVEL% >> %LOG%
node scripts/update-system-maturity-delivery-hashes.mjs >> %LOG% 2>> %ERR%
echo HASH2=%ERRORLEVEL% >> %LOG%
call pnpm maturity:evidence >> %LOG% 2>> %ERR%
echo EVIDENCE=%ERRORLEVEL% >> %LOG%
call pnpm harness validate --spec harness/specs/tasks/system-maturity-quarterly-audit.md >> %LOG% 2>> %ERR%
echo HARNESS=%ERRORLEVEL% >> %LOG%
call pnpm maturity:quarterly -- --dry-run >> %LOG% 2>> %ERR%
echo QDRY=%ERRORLEVEL% >> %LOG%
call git diff --check >> %LOG% 2>> %ERR%
echo DIFFCHECK=%ERRORLEVEL% >> %LOG%
echo EXIT=%ERRORLEVEL% > artifacts\system-maturity\P7-004\final-seal.exit.txt
