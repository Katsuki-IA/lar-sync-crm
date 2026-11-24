import { readFile, writeFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { patchService, patchBroker, patchReminder } from './visit-reminder-routing.mjs';

const directory=process.env.VISIT_FIX_FIXTURES;
if(!directory)throw Error('VISIT_FIX_FIXTURES is required (ignored backup directory)');
const targets=[['EYvXhZTBgM9qi2pp',patchService],['K6Ra0NieeLWEFi1w',patchBroker],['Mv0eUkTI8WspBnOR',patchReminder]];
const apply=process.argv.includes('--apply');
const base=process.env.N8N_API_URL?.replace(/\/+$/,'');
async function request(id,body){
 const response=await fetch(`${base}/api/v1/workflows/${id}`,{method:body?'PUT':'GET',
  headers:{'X-N8N-API-KEY':process.env.N8N_API_KEY,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 if(!response.ok)throw Error(`n8n ${body?'update':'read'} ${id}: HTTP ${response.status}`);
 return response.json();
}
for(const [id,patch] of targets){
 const original=JSON.parse((await readFile(`${directory}/visit-fix-${id}.json`,'utf8')).replace(/^\uFEFF/,''));
 const w=patch(original);
 const names=new Set(w.nodes.map(n=>n.name));
 if(names.size!==w.nodes.length)throw Error('Duplicate node name');
 for(const [source,types] of Object.entries(w.connections)){
  if(!names.has(source))throw Error('Missing source '+source);
  for(const outputs of Object.values(types))for(const output of outputs)for(const edge of output)
   if(!names.has(edge.node))throw Error('Missing target '+edge.node);
 }
 // Preserve runtime/error settings; omit internal flags rejected by the public API.
 const settings=Object.fromEntries(['executionOrder','errorWorkflow','timezone','saveDataErrorExecution',
  'saveDataSuccessExecution','saveManualExecutions','saveExecutionProgress','executionTimeout']
  .filter(k=>w.settings[k]!==undefined).map(k=>[k,w.settings[k]]));
 const body={name:w.name,nodes:w.nodes,connections:w.connections,settings};
 await writeFile(`${directory}/visit-fix-${id}.candidate.json`,JSON.stringify(body,null,2));
 if(!apply){console.log(`${id}: candidate validated (${w.nodes.length} nodes)`);continue;}
 const current=await request(id);
 if(current.versionId!==original.versionId)throw Error(`Concurrent change to ${id}; stop and review`);
 await writeFile(`${directory}/visit-fix-${id}.before-publish.json`,JSON.stringify(current,null,2));
 await request(id,body);
 const published=await request(id);
 if(!isDeepStrictEqual(published.nodes,w.nodes)||!isDeepStrictEqual(published.connections,w.connections)
  ||published.active!==original.active||published.settings.errorWorkflow!==original.settings.errorWorkflow
  ||published.settings.executionOrder!==original.settings.executionOrder)throw Error(`Readback mismatch ${id}`);
 await writeFile(`${directory}/visit-fix-${id}.published.json`,JSON.stringify(published,null,2));
 console.log(`${id}: published and verified; active=${published.active}; version=${published.versionId}`);
}
