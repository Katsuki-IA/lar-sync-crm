import fs from 'node:fs';
import ts from 'typescript';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../supabase/functions/whatsapp-conversation-send/index.ts',import.meta.url),'utf8').replace(/^import[\s\S]*?from\s+"[^"]+";\s*/gm,'');
const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
async function run(options={}){
 let handler;const calls=[];let sends=0;
 const rows={crm_users:{id:'agent',id_empresa:9,role:'agent'},lead:{id:10,id_empresa:options.company??9,numero:'5542999815645',atendimento_humano:true,wa_conversation_assigned_to:'agent'},credentials:{whatsapp_business_id:'sender9',whatsapp_access_token:'fake',waba_id:'waba'},crm_whatsapp_connections:null,wa_messages:null};
 const admin={auth:{getUser:async()=>({data:{user:{id:'user'}}})},from(table){const q={};for(const m of ['select','eq','not','limit','order'])q[m]=()=>q;q.maybeSingle=async()=>({data:rows[table]});return q;},async rpc(name,args){calls.push({name,args});if(name==='hub_delivery_lookup')return {data:null};if(name==='wa_marketing_cooldown_until')return options.dbError?{error:{message:'database unavailable'}}:{data:options.until??null};if(name==='crm_whatsapp_conversation_windows')return {data:[{window_open:options.open??true}]};if(name==='hub_delivery_reserve')return {data:{owned:true,id:1,claim_token:'claim'}};if(name==='hub_delivery_finalize')return {data:{ok:true}};return {data:null};}};
 const fetchMock=async url=>{if(String(url).includes('message_templates'))return Response.json({data:[{name:'assumir_conversa_1',language:'pt_BR',status:'APPROVED',category:options.category??'MARKETING',components:[]}]});sends++;return options.metaError?Response.json({error:{code:131049,message:'Meta restriction'}},{status:400}):Response.json({messages:[{id:'wamid.test'}]});};
 new Function('createClient','Deno','fetch','buildTemplateComponents','isAttendanceTemplate','templatePreview','console',js)(()=>admin,{env:{get:()=> 'test'},serve:fn=>handler=fn},fetchMock,()=>[],()=>true,()=> 'Hello',{error(){}});
 const body={leadId:10,clientMessageId:'request',action:options.action??'send_template',templateName:'assumir_conversa_1',templateLanguage:'pt_BR',text:'Hello'};if(options.text)delete body.action;
 const res=await handler(new Request('https://test',{method:'POST',headers:{authorization:'Bearer fake'},body:JSON.stringify(body)}));return {status:res.status,body:await res.json(),sends,calls};
}
const until=new Date(Date.now()+86400000).toISOString();
let r=await run({until});assert.equal(r.status,429);assert.equal(r.sends,0);assert.equal(r.body.marketingBlockedUntil,until);assert(!r.calls.some(c=>c.name==='hub_delivery_reserve'));
r=await run({until,category:'UTILITY'});assert.equal(r.status,200);assert.equal(r.sends,1);
r=await run({until,text:true});assert.equal(r.status,200);assert.equal(r.sends,1);assert(!r.calls.some(c=>c.name==='wa_marketing_cooldown_until'));
r=await run({text:true,open:false});assert.equal(r.status,400);assert.equal(r.sends,0);
r=await run({action:'list_templates',until});assert.equal(r.body.marketingBlockedUntil,until);assert.equal(r.sends,0);
r=await run({company:32});assert.equal(r.status,400);assert.equal(r.sends,0);
r=await run({dbError:true});assert.equal(r.status,400);assert.equal(r.sends,0);
r=await run({metaError:true});assert.equal(r.status,429);assert(r.calls.some(c=>c.name==='wa_record_marketing_cooldown'));assert.equal(r.sends,1);
r=await run();assert.equal(r.status,200);assert.equal(r.sends,1);assert(r.calls.some(c=>c.name==='hub_delivery_receipt'));assert(r.calls.some(c=>c.name==='hub_delivery_finalize'));
console.log('PASS: real Edge handler blocks marketing, allows utility/window replies, exposes expiry, isolates company, fails closed, records synchronous Meta errors, preserves delivery idempotency.');
