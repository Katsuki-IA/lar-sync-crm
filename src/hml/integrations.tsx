import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { toast } from 'sonner';
import { useCrmUser } from '@/hooks/use-crm-user';
import { Button } from '@/components/ui/button';
import { db, inputClass } from './modules';
import {CvDelivery} from './cv-delivery';

import {crmNames,integrationPresentation} from './integration-presentation';
export {crmNames} from './integration-presentation';
const fields: Record<string,string[]> = {katsuki:[],cv:['cv_crm_url','cv_crm_token','cv_crm_email'],c2s:['c2s_crm_url','c2s_crm_token'],kommo:['cv_crm_url','cv_crm_token','pipeline_id'],rd:['rd_hub_access_token','rd_user_id','rd_hub_client_id','rd_hub_client_secret','rd_hub_refresh_token'],loft:['loft_crm_url','loft_crm_token','loft_corretor_id'],facilita:['facilita_crm_url','facilita_crm_token','facilita_crm_api','facilita_crm_instance']};
const fieldNames:Record<string,string>={cv_crm_url:'URL',cv_crm_token:'Token',cv_crm_email:'E-mail da API',c2s_crm_url:'URL',c2s_crm_token:'Token',pipeline_id:'Pipeline',rd_hub_access_token:'Token de acesso',rd_user_id:'Usuário RD',rd_hub_client_id:'Client ID',rd_hub_client_secret:'Client secret',rd_hub_refresh_token:'Refresh token',loft_crm_url:'URL',loft_crm_token:'Token',loft_corretor_id:'ID do corretor',facilita_crm_url:'URL',facilita_crm_token:'Token',facilita_crm_api:'API',facilita_crm_instance:'Instância'};
export type IntegrationOverview={provider:string|null;companyCrm:string|null;hubMembership:string|null;credentialCount:number;revision:string;crmModule:boolean;iaModule:boolean;fields:Record<string,boolean>;missing:string[];configured:boolean;externalDeliveryEnabled:boolean;secretary:{provider:string;instance:string;enabled:boolean;autoSend:boolean}|null;officialWhatsapp:{phoneConfigured:boolean;accessTokenConfigured:boolean};history:{id:string;lead_id:number;provider:string;status:string;attempts:number;reason:string;updated_at:string}[]};
export function useIntegrations(company:number){return useQuery({queryKey:['integrations',company],queryFn:async()=>{const {data,error}=await db.rpc('hub_integration_overview',{p_company:company});if(error)throw error;return data as IntegrationOverview;}});}
export function Integrations({companyId}:{companyId:number}){
 const {data:me}=useCrmUser();
 if(me?.role!=='super_admin')return null;
 return <AdminIntegrations companyId={companyId}/>;
}
function AdminIntegrations({companyId}:{companyId:number}){
 const {data:me}=useCrmUser();const q=useIntegrations(companyId);const qc=useQueryClient();const [editing,setEditing]=useState(false);const [provider,setProvider]=useState('katsuki');const [values,setValues]=useState<Record<string,string>>({});const [busy,setBusy]=useState(false);const canEdit=me?.role==='super_admin';
 const refresh=()=>qc.invalidateQueries({queryKey:['integrations',companyId]});
 if(q.isPending)return <p>Carregando integrações…</p>;
 if(q.isError)return <div role="alert">Não foi possível carregar as integrações. <Button onClick={()=>q.refetch()}>Tentar novamente</Button></div>;
 const data=q.data;
 const presentation=integrationPresentation(data);
 return <section className="space-y-5">
  <div className="rounded-xl border bg-card p-5 space-y-3"><div className="flex items-center justify-between gap-3"><h2 className="font-semibold">CRM de destino</h2>{canEdit&&!editing&&<Button variant="outline" onClick={()=>{setProvider(data.provider&&crmNames[data.provider]?data.provider:'katsuki');setValues({});setEditing(true);}}>Configurar</Button>}</div>
   <p className="text-lg font-medium">{presentation.label}</p>
   <p className="text-sm text-muted-foreground">{presentation.description}</p>
   {data.missing.length>0&&<p className="text-sm">Faltam: {data.missing.map(f=>fieldNames[f]??f).join(', ')}.</p>}
   {data.credentialCount>1&&<p role="alert">Há credenciais duplicadas. Reconcilie os cadastros antes de configurar.</p>}
   <dl className="grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-muted-foreground">Participação no Hub (credentials)</dt><dd>{data.hubMembership??'Sem credencial legada'}</dd></div><div><dt className="text-muted-foreground">Destino cadastrado na empresa</dt><dd>{data.companyCrm??'Sem destino explícito'}</dd></div></dl>
   <p className="text-xs text-muted-foreground">As regras de encaminhamento e o destino interno são definidos em Envio ao CRM. Este painel resume o cadastro das integrações.</p>
   {editing&&<form className="space-y-4 border-t pt-4" onSubmit={async e=>{e.preventDefault();setBusy(true);try{const {error}=await db.rpc('hub_save_crm_connection',{p_company:companyId,p_provider:provider,p_values:values,p_revision:data.revision});if(error)throw error;setValues({});setEditing(false);await refresh();toast.success('Integração salva');}catch(err:any){toast.error(err.message);}finally{setBusy(false);}}}>
    <label className="block text-sm">Destino<select className={inputClass} value={provider} disabled={busy} onChange={e=>{setProvider(e.target.value);setValues({});}}>{Object.entries(crmNames).map(([key,name])=><option key={key} value={key} disabled={key==='facilita'||(key==='katsuki'&&!data.crmModule)}>{name}</option>)}</select></label>
    {fields[provider]?.map(key=><label key={key} className="block text-sm">{fieldNames[key]}<input className={inputClass} type={/token|secret/.test(key)?'password':'text'} autoComplete="off" maxLength={4000} disabled={busy} value={values[key]??''} placeholder={provider===data.provider&&data.fields[key]?'Configurado — deixe vazio para manter':'Informe o valor'} onChange={e=>setValues({...values,[key]:e.target.value})}/></label>)}
    <p className="text-xs text-muted-foreground">As chaves são gravadas nas credenciais utilizadas pelos conectores atuais e não são exibidas neste formulário. Campos vazios preservam os valores existentes.</p>
    <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={()=>{setEditing(false);setValues({});}}>Cancelar</Button><Button disabled={busy}>{busy?'Salvando…':'Salvar'}</Button></div>
   </form>}
  </div>
  {data.provider==='cv'&&<CvDelivery company={companyId} revision={data.revision} canEdit={canEdit}/>}
  <div className="grid gap-4 sm:grid-cols-2"><div className="rounded-xl border bg-card p-5 space-y-2"><h2 className="font-semibold">WhatsApp do atendimento IA</h2><p className="text-sm">Número da Meta cadastrado: {data.officialWhatsapp.phoneConfigured?'presente':'não configurado'}<br/>Credencial de acesso: {data.officialWhatsapp.accessTokenConfigured?'presente':'não configurado'}</p><p className="text-xs text-muted-foreground">Número utilizado pela IA para conversar com os leads. Este resumo verifica o cadastro, sem realizar um teste de envio.</p></div><div className="rounded-xl border bg-card p-5 space-y-2"><h2 className="font-semibold">WhatsApp da secretária</h2><p className="text-sm">{data.secretary?`${data.secretary.provider} · ${data.secretary.instance} · ${data.secretary.enabled?'habilitado':'pausado'}`:'Não configurado'}</p>{data.crmModule&&<Button variant="outline" asChild><Link to="/configuracoes/secretaria">Configurar secretária</Link></Button>}</div></div>

 </section>;
}

