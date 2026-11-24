import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolveCvVisitProject,patchCvVisitProject} from './cv-visit-project.mjs';
const start={Empresa:{id:19},Empreendimentos:[{id:62,id_empresa:19,cv_id_empreendimento:'10'},{id:49,id_empresa:19,cv_id_empreendimento:'9'}]};
test('visit and cancellation use the selected project, independent of catalog order',()=>{
 for(const type of ['agendar','cancelar']){
  assert.equal(resolveCvVisitProject(start,{type,empreendimento_id:'49'}),9);
  assert.equal(resolveCvVisitProject({...start,Empreendimentos:[...start.Empreendimentos].reverse()},{type,empreendimento_id:49}),9);
 }
 assert.equal(resolveCvVisitProject(start,{empreendimento_id:62}),10);
});
test('missing, ambiguous, unmapped and cross-company projects block instead of using the first',()=>{
 for(const s of [{...start,Empreendimentos:[]},{...start,Empreendimentos:[start.Empreendimentos[1],start.Empreendimentos[1]]},
  {...start,Empreendimentos:[{id:49,id_empresa:9,cv_id_empreendimento:'9'}]},
  {...start,Empreendimentos:[{id:49,cv_id_empreendimento:null}]}])assert.throws(()=>resolveCvVisitProject(s,{empreendimento_id:49}));
 assert.throws(()=>resolveCvVisitProject(start,{}));
});
test('David execution replay produces Bliss Cuore in both CV payloads',{skip:!process.env.CV_VISIT_FIX_DIR},async()=>{
 const dir=process.env.CV_VISIT_FIX_DIR;
 const read=async f=>JSON.parse((await readFile(`${dir}/${f}`,'utf8')).replace(/^\uFEFF/,''));
 const execution=await read('david-schedule-execution.json');
 const original=await read('cv-visit-project-before.json');
 const w=patchCvVisitProject(original),runs=execution.data.resultData.runData;
 const get=name=>({first:()=>({json:runs[name][0].data.main[0][0].json}),item:{json:runs[name][0].data.main[0][0].json}});
 for(const name of ['Atualiza estagio e salva resumo','Atualiza estagio']){
  const n=w.nodes.find(n=>n.name===name);
  const body=new Function('$','return ('+n.parameters.jsonBody.slice(3,-2)+')')(get);
  assert.equal(body.idempreendimento,9);
  assert.equal(body.telefone,'5541998972789');
 }
 assert.deepEqual(w.connections,original.connections);
 assert.deepEqual(w.settings,original.settings);
 for(const n of w.nodes.filter(n=>!['Atualiza estagio e salva resumo','Atualiza estagio'].includes(n.name)))assert.deepEqual(n,original.nodes.find(o=>o.id===n.id));
});
