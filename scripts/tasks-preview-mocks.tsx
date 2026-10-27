import React from 'react';
import {useMutation,useQueryClient} from '@tanstack/react-query';
const members=[{id:'manager',nome:'Marina Costa',role:'manager',active:true},{id:'agent',nome:'Juliana Reis',role:'agent',active:true}];
const contacts=[{id:1,nome:'Marcos Vieira',crm_assigned_to:'agent'}];
const opportunities=[{id:'op',lead_id:1,title:'Reserva Harmonia Viamão',assigned_to:'agent'}];
const tasks=[['Enviar simulação de financiamento','whatsapp',-86400000,'normal'],['Ligar para confirmar interesse','ligacao',7200000,'alta'],['Visita ao decorado','visita',172800000,'alta']].map(([titulo,tipo,delta,prioridade],i)=>({id:String(i),id_empresa:1,lead_id:1,opportunity_id:'op',titulo,tipo,prazo:new Date(Date.now()+Number(delta)).toISOString(),prioridade,status:'pendente',assigned_to:'agent',created_by:'manager',revision:1,completed_at:null,reminder_minutes:15,descricao:'Confirmar os próximos passos com o cliente.'}));
export const useCrmUser=()=>({data:{id:'manager',id_empresa:1,active:true,role:'manager'}});
export const useActiveEmpresa=()=>({activeEmpresaId:1});
export const useCompanyModules=()=>({data:{crm:true}});
export const inputClass='w-full rounded-md border border-input bg-background px-3 py-2 text-sm';
export const Link=({children,...props}:any)=><a href='#'>{children}</a>;
export const Notice=({title,children}:any)=><div className='rounded-xl border p-5'><h3>{title}</h3>{children}</div>;
export async function adminRpc(name:string,args:any){
 if(name==='hub_task_reminder_options')return members.map(m=>({member_id:m.id,ready:true}));
 if(name==='hub_save_task_v2'){
  const old=tasks.find(t=>t.id===args.p_task_id);
  const next={id:old?.id??String(tasks.length),id_empresa:1,lead_id:args.p_lead_id,opportunity_id:args.p_opportunity_id,titulo:args.p_title,tipo:args.p_type,prazo:args.p_due_at,prioridade:args.p_priority,status:args.p_status,assigned_to:args.p_assigned_to,created_by:'manager',revision:(old?.revision??0)+1,completed_at:null,reminder_minutes:args.p_reminder_minutes,descricao:args.p_description};
  if(old)Object.assign(old,next);else tasks.push(next);return next;
 }
}
export function useAdminMutation(fn:any,_message:string,onClose?:()=>void){const qc=useQueryClient();return useMutation({mutationFn:fn,onSuccess:async()=>{await qc.invalidateQueries();onClose?.();}});}
export const db={from(name:string){let filters:((t:any)=>boolean)[]=[];let orders:string[]=[];let range:[number,number]|null=null;
 const result=()=>{let data:any[]=name==='crm_users'?members:name==='crm_leads'?contacts:name==='crm_opportunities'?opportunities:name==='crm_lead_tasks'?tasks:[];
 data=data.filter(t=>filters.every(f=>f(t))).slice();for(const key of [...orders].reverse())data.sort((a,b)=>key==='priority_rank'?({alta:0,normal:1,baixa:2}[a.prioridade]-{alta:0,normal:1,baixa:2}[b.prioridade]):String(a[key]).localeCompare(String(b[key])));
 const count=data.length;if(range)data=data.slice(range[0],range[1]+1);return {data,error:null,count};};
 const chain={select:()=>chain,eq:(k:string,v:any)=>{if(k!=='id_empresa')filters.push(t=>t[k]===v);return chain;},in:(k:string,v:any[])=>{filters.push(t=>v.includes(t[k]));return chain;},order:(k:string)=>{orders.push(k);return chain;},lt:(k:string,v:string)=>{filters.push(t=>t[k]<v);return chain;},gte:(k:string,v:string)=>{filters.push(t=>t[k]>=v);return chain;},ilike:(k:string,v:string)=>{filters.push(t=>String(t[k]).toLowerCase().includes(v.replaceAll('%','').toLowerCase()));return chain;},range:(a:number,b:number)=>{range=[a,b];return chain;},limit:()=>chain,then:(fn:any)=>Promise.resolve(result()).then(fn)};return chain;}};
