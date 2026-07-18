@echo off
cd /d C:\Users\27933\Desktop\clawx\ClawX-maturity-p7
call pnpm maturity:quarterly > artifacts\system-maturity\P7-004\qfinal.stdout.log 2> artifacts\system-maturity\P7-004\qfinal.stderr.log
echo Q=%ERRORLEVEL% > artifacts\system-maturity\P7-004\qfinal.exit.txt
node scripts/update-system-maturity-delivery-hashes.mjs >> artifacts\system-maturity\P7-004\qfinal.stdout.log 2>> artifacts\system-maturity\P7-004\qfinal.stderr.log
echo H=%ERRORLEVEL% >> artifacts\system-maturity\P7-004\qfinal.exit.txt
call pnpm maturity:evidence >> artifacts\system-maturity\P7-004\qfinal.stdout.log 2>> artifacts\system-maturity\P7-004\qfinal.stderr.log
echo E=%ERRORLEVEL% >> artifacts\system-maturity\P7-004\qfinal.exit.txt
