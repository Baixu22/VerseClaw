@echo off
cd /d C:\Users\27933\Desktop\clawx\ClawX-maturity-p7
node scripts/update-system-maturity-delivery-hashes.mjs > artifacts\system-maturity\P7-004\seal-tail.stdout.log 2> artifacts\system-maturity\P7-004\seal-tail.stderr.log
echo HASH_SYNC=%ERRORLEVEL% >> artifacts\system-maturity\P7-004\seal-tail.stdout.log
call pnpm maturity:validate >> artifacts\system-maturity\P7-004\seal-tail.stdout.log 2>> artifacts\system-maturity\P7-004\seal-tail.stderr.log
echo VALIDATE=%ERRORLEVEL% >> artifacts\system-maturity\P7-004\seal-tail.stdout.log
call pnpm maturity:evidence >> artifacts\system-maturity\P7-004\seal-tail.stdout.log 2>> artifacts\system-maturity\P7-004\seal-tail.stderr.log
echo EVIDENCE=%ERRORLEVEL% >> artifacts\system-maturity\P7-004\seal-tail.stdout.log
echo EXIT=%ERRORLEVEL% > artifacts\system-maturity\P7-004\seal-tail.exit.txt

/* reseal-marker:cd87e3735 */
