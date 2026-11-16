import base from 'D:/ClawX-work/semantic-convergence-20261104/vite.config.ts';
import { existsSync } from 'node:fs';
const store = 'D:/ClawX/node_modules/.pnpm/';
const graph = {name:'restore-existing-motion-dependency-resolution',enforce:'pre' as const,resolveId(source:string,importer?:string){
  if(source!=='motion-dom'&&source!=='motion-utils')return;
  const major13=Boolean(importer&&/(?:framer-motion|motion-dom|motion-utils)@13\.0\.0/.test(importer));
  const version=major13?'13.0.0':source==='motion-dom'?'12.38.0':'12.36.0';
  const file=store+source+'@'+version+'/node_modules/'+source+'/dist/es/index.mjs';
  if(!existsSync(file))throw new Error('Missing exact installed dependency '+file);return file;
}};
export default async (env: any) => {const config=typeof base==='function'?await base(env):base;return {...config,root:'D:/ClawX-work/semantic-convergence-20261104',plugins:[graph,...(config.plugins??[])]};};
