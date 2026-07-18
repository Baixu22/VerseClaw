@echo off
cd /d C:\Users\27933\Desktop\clawx\ClawX-maturity-p7
node scripts/update-system-maturity-delivery-hashes.mjs > artifacts\system-maturity\P7-004\validate4.stdout.log 2> artifacts\system-maturity\P7-004\validate4.stderr.log
echo HASH=%ERRORLEVEL% >> artifacts\system-maturity\P7-004\validate4.stdout.log
call pnpm maturity:validate >> artifacts\system-maturity\P7-004\validate4.stdout.log 2>> artifacts\system-maturity\P7-004\validate4.stderr.log
echo VALIDATE=%ERRORLEVEL% >> artifacts\system-maturity\P7-004\validate4.stdout.log
call pnpm maturity:evidence >> artifacts\system-maturity\P7-004\validate4.stdout.log 2>> artifacts\system-maturity\P7-004\validate4.stderr.log
echo EVIDENCE=%ERRORLEVEL% >> artifacts\system-maturity\P7-004\validate4.stdout.log
call pnpm maturity:quarterly >> artifacts\system-maturity\P7-004\validate4.stdout.log 2>> artifacts\system-maturity\P7-004\validate4.stderr.log
echo QUARTERLY=%ERRORLEVEL% >> artifacts\system-maturity\P7-004\validate4.stdout.log
echo EXIT=%ERRORLEVEL% > artifacts\system-maturity\P7-004\validate4.exit.txt
