@echo off
cd /d C:\Users\27933\Desktop\clawx\ClawX-maturity-p7
call pnpm maturity:quarterly:evidence > artifacts\system-maturity\P7-004\collect3.stdout.log 2> artifacts\system-maturity\P7-004\collect3.stderr.log
echo EXIT=%ERRORLEVEL% > artifacts\system-maturity\P7-004\collect3.exit.txt

/* reseal-marker:cd87e3735 */
