@echo off
cd /d C:\Users\27933\Desktop\clawx\ClawX-maturity-p7
node scripts/update-system-maturity-delivery-hashes.mjs > artifacts\system-maturity\P7-004\seal5.stdout.log 2> artifacts\system-maturity\P7-004\seal5.stderr.log
echo HASH=%ERRORLEVEL% >> artifacts\system-maturity\P7-004\seal5.stdout.log
call pnpm maturity:evidence >> artifacts\system-maturity\P7-004\seal5.stdout.log 2>> artifacts\system-maturity\P7-004\seal5.stderr.log
echo EVIDENCE=%ERRORLEVEL% >> artifacts\system-maturity\P7-004\seal5.stdout.log
call pnpm harness validate --spec harness/specs/tasks/system-maturity-quarterly-audit.md >> artifacts\system-maturity\P7-004\seal5.stdout.log 2>> artifacts\system-maturity\P7-004\seal5.stderr.log
echo HARNESS=%ERRORLEVEL% >> artifacts\system-maturity\P7-004\seal5.stdout.log
call pnpm maturity:quarterly -- --dry-run >> artifacts\system-maturity\P7-004\seal5.stdout.log 2>> artifacts\system-maturity\P7-004\seal5.stderr.log
echo QDRY=%ERRORLEVEL% >> artifacts\system-maturity\P7-004\seal5.stdout.log
echo EXIT=%ERRORLEVEL% > artifacts\system-maturity\P7-004\seal5.exit.txt
