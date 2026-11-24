import {readFile,writeFile} from 'node:fs/promises';
import {isDeepStrictEqual} from 'node:util';
import {patchCvVisitProject} from './cv-visit-project.mjs';
const dir=process.env.CV_VISIT_FIX_DIR;
if(!dir)throw Error('CV_VISIT_FIX_DIR required');
const original=JSON.parse((await readFile(`${dir}/cv-visit-project-before.json`,'utf8')).replace(/^\uFEFF/,''));
const w=patchCvVisitProject(original);
const settings=Object.fromEntries(['executionOrder','errorWorkflow','timezone','saveDataErrorExecution','saveDataSuccessExecution','saveManualExecutions','saveExecutionProgress','executionTimeout'].filter(k=>w.settings[k]!==undefined).map(k=>[k,w.settings[k]]));
const body={name:w.name,nodes:w.nodes,connections:w.connections,settings};
await writeFile(`${dir}/cv-visit-project-candidate.json`,JSON.stringify(body,null,2));
if(process.argv.includes('--apply')){
 const url=process.env.N8N_API_URL.replace(/\/+$/,'')+'/api/v1/workflows/SbrnKQgQ5S6yqZuf';
 const request=async payload=>{
  const r=await fetch(url,{method:payload?'PUT':'GET',headers:{'X-N8N-API-KEY':process.env.N8N_API_KEY,'Content-Type':'application/json'},...(payload?{body:JSON.stringify(payload)}:{})});
  if(!r.ok)throw Error('n8n HTTP '+r.status);return r.json();
 };
 const current=await request();
 if(current.versionId!==original.versionId)throw Error('Workflow changed; review before publishing');
 await writeFile(`${dir}/cv-visit-project-publish-backup.json`,JSON.stringify(current,null,2));
 await request(body);
 const actual=await request();
 if(!isDeepStrictEqual(actual.nodes,w.nodes)||!isDeepStrictEqual(actual.connections,w.connections)||!actual.active||actual.activeVersionId!==actual.versionId||actual.settings.errorWorkflow!==original.settings.errorWorkflow)throw Error('Published verification failed');
 console.log('Published and active: '+actual.versionId);
}else console.log('Candidate prepared; only two CV project expressions changed.');
