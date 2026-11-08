import { admitManagedProcess, configureManagedProcessCapacity } from '../../../openclaw_runtime/src/agents/verseshell/managed-process-capacity.js';
import { managedProcessReservations } from '../../../openclaw_runtime/src/agents/verseshell/managed-process-reservation.js';
const input=JSON.parse(Buffer.from(process.argv[2],'base64').toString('utf8')) as {limit:number;port?:number;owner:string};
configureManagedProcessCapacity({maxLiveProcesses:input.limit});
try {
  const admission=admitManagedProcess({owner:input.owner,ports:input.port?[input.port]:[]});
  if (!admission.ok) {process.stdout.write(JSON.stringify(admission)+'\n');process.exit(0);}
  admission.lease.markDispatched();
  await admission.lease.observeProcess(process.pid);
  process.stdout.write(JSON.stringify({ok:true,reservationId:admission.lease.reservationId,live:admission.live,rows:managedProcessReservations()})+'\n');
  process.stdin.once('data', chunk=>{
    if(String(chunk).trim()==='crash')process.exit(23);
    admission.lease.release();process.exit(0);
  });
  process.stdin.resume();
} catch(error){process.stdout.write(JSON.stringify({ok:false,error:String(error)})+'\n');process.exit(0);}
