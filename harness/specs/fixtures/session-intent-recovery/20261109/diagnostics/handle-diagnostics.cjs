const fs=require('node:fs');
const path=require('node:path');
const target=process.env.CLAWX_HANDLE_DIAGNOSTICS;
if(target && /playwright[\\/].*process/.test(process.argv[1]||'')){
 const record=()=>{try{fs.appendFileSync(path.join(target,'handles-'+process.pid+'.jsonl'),JSON.stringify({at:new Date().toISOString(),pid:process.pid,resources:process.getActiveResourcesInfo(),handles:process._getActiveHandles().map(h=>({kind:h.constructor?.name,pid:h.pid,exitCode:h.exitCode,signalCode:h.signalCode,fd:h.fd,destroyed:h.destroyed,localPort:h.localPort,remotePort:h.remotePort,readable:h.readable,writable:h.writable,hasRef:typeof h.hasRef==='function'?h.hasRef():undefined}))})+'\n')}catch{}};
 const timer=setInterval(record,5000).unref();process.on('exit',()=>{clearInterval(timer);record()});record();
}