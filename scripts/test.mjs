import { build } from 'esbuild';
import { mkdir, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
await mkdir('.tmp',{recursive:true});
const tests=(await readdir('tests')).filter(name=>name.endsWith('.test.ts')).sort();
let status=0;
for(const name of tests){
  const output=`.tmp/${name.replace('.ts','.mjs')}`;
  await build({entryPoints:[`tests/${name}`],outfile:output,bundle:true,platform:'node',format:'esm'});
  const test=spawnSync(process.execPath,[output],{stdio:'inherit'});
  if(test.status!==0)status=1;
}
process.exit(status);
