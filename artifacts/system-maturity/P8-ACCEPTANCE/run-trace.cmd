@echo off
cd /d C:\Users\27933\Desktop\clawx\ClawX-maturity-p7
node scripts/validate-system-maturity-traceability.mjs > artifacts\system-maturity\P8-ACCEPTANCE\trace.out.txt 2> artifacts\system-maturity\P8-ACCEPTANCE\trace.err.txt
echo %ERRORLEVEL%> artifacts\system-maturity\P8-ACCEPTANCE\trace.exit.txt
