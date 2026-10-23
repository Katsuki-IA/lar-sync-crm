import type { ConversationMessage } from './conversations';
type NativeMessage = {id:string;type:string|null;message:unknown;time:string|null;created_at:string|null};
export type NativeHistory = {
  lead:{nome:string|null};
  messages:NativeMessage[];
  activities:{id:number;descricao:string|null;created_at:string|null}[];
};
const markers=['Mensagem recebida do lead:','Resposta enviada pela IA:','Mensagem enviada pela IA:','Mensagem enviada ao lead:','Mensagem enviada:'];
function text(value:unknown):string {
 if(value==null)return '';
 if(Array.isArray(value))return value.map(text).filter(Boolean).join('\n');
 if(typeof value!=='object')return String(value);
 const record=value as Record<string,unknown>;
 for(const key of ['content','text','message','output','body'])if(typeof record[key]==='string'&&record[key].trim())return record[key];
 return JSON.stringify(value);
}
function block(value:string,marker:string){
 const start=value.indexOf(marker);if(start<0)return null;
 let body=value.slice(start+marker.length).replace(/^\s*\n?-{3,}\n?/,'');
 const ends=markers.filter(x=>x!==marker).map(x=>body.indexOf(x)).filter(x=>x>=0);
 body=body.slice(0,ends.length?Math.min(...ends):body.length).replace(/-{3,}\s*$/,'').trim();
 return body||null;
}
function date(value:string|null){
 if(!value)return null;
 const raw=value.trim();const d=/^\d+$/.test(raw)?new Date(Number(raw)*(raw.length<=10?1000:1)):new Date(raw);
 return Number.isNaN(d.getTime())?null:d.toISOString();
}
// Match the current HUB: activities are a fallback only when no chat rows exist.
export function nativeHistoryMessages(payload:NativeHistory):ConversationMessage[]{
 const source=payload.messages?.length?payload.messages:(payload.activities??[]).flatMap(a=>{
  const body=a.descricao??'';const human=block(body,markers[0]);
  const ai=markers.slice(1).map(m=>block(body,m)).find(Boolean);
  return [human?{id:`activity-${a.id}-human`,type:'human',message:human,time:a.created_at,created_at:a.created_at}:null,
   ai?{id:`activity-${a.id}-ai`,type:'ai',message:ai,time:a.created_at,created_at:a.created_at}:null].filter((m):m is NonNullable<typeof m>=>m!==null);
 });
 return source.flatMap(m=>{
  const type=m.type?.trim().toLowerCase();const body=text(m.message).trim();
  if(!body||!['human','ai'].includes(type??''))return [];
  if(type==='ai'){
   if(/^Calling\s+\S+\s+with input:/i.test(body))return [];
   if(/^[{[]/.test(body)){try{JSON.parse(body);return [];}catch{/* Ordinary text. */}}
  }
  return [{id:m.id,sender:type==='human'?'contact' as const:'assistant' as const,body,sent_at:date(m.time??m.created_at)??''}];
 }).sort((a,b)=>(Date.parse(a.sent_at)||0)-(Date.parse(b.sent_at)||0));
}

