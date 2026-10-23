// Release adapter. Not activated in the HML route: it requires the native SQL package.
// IDs received from Leads are crm_leads IDs; the server resolves the operational lead.
type Client = {rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:{message:string;code?:string}|null}>};
export type NativeConversationContext = {
  contact_id:number; lead_id:number; company_id:number; human:boolean;
  assigned_to:string|null; assigned_at:string|null; server_now:string;
  conversation:Record<string,unknown>;
  window:{lead_id:number;last_inbound_at:string|null;window_expires_at:string|null;window_open:boolean}|null;
};
export type NativeMessage = {
  id:number; type:string|null; message:unknown; time:string|null; created_at:string|null;
  direction:string|null; source:string|null; delivery_status:string|null;
  transport_message_id:string|null; error_code:string|null; error_message:string|null;
};
export function nativeConversationApi(client:Client) {
  async function call<T>(name:string,args:Record<string,unknown>):Promise<T> {
    const {data,error}=await client.rpc(name,args);
    if(error)throw Object.assign(new Error(error.message),{code:error.code});
    return data as T;
  }
  return {
    context:(company:number,contact:number)=>call<NativeConversationContext>('hub_native_conversation_context',{p_company:company,p_contact:contact}),
    messages:(company:number,contact:number,before:number|null=null,limit=50)=>call<{items:NativeMessage[];next:number|null}>('hub_native_conversation_messages',{p_company:company,p_contact:contact,p_before:before,p_limit:limit}),
    attendance:(company:number,contact:number,enabled:boolean,force=false)=>call<{lead_id:number;id_empresa:number;atendimento_humano:boolean;assigned_to:string|null}>('hub_native_conversation_attendance',{p_company:company,p_contact:contact,p_enabled:enabled,p_force:force}),
  };
}
type SendClient = {functions:{invoke(name:string,options:{body:Record<string,unknown>}):PromiseLike<{data:unknown;error:{message:string;context?:unknown}|null}>}};
export type NativeTextRequest = {leadId:number;text:string;clientMessageId:string};
export async function sendNativeConversationText(client:SendClient,request:NativeTextRequest) {
  if(!Number.isSafeInteger(request.leadId)||request.leadId<=0||!request.text.trim()||request.text.length>4096)
    throw new Error('Lead ou mensagem inválidos.');
  const {data,error}=await client.functions.invoke('whatsapp-conversation-send',{body:request});
  if(error){
    if(error.context instanceof Response){
      const payload=await error.context.clone().json().catch(()=>null);
      if(typeof payload?.error==='string')throw Object.assign(new Error(payload.error),{
        deliveryUncertain:payload.deliveryUncertain===true||error.context.status>=500||/^Mensagem enviada|Meta não retornou|fetch|network|connection|timeout|conexão|aborted/i.test(payload.error)||payload.error.includes('A Meta não retornou'),
      });
    }
    throw Object.assign(new Error(error.message),{deliveryUncertain:true});
  }
  const result=data as {ok?:boolean;messageId?:string;status?:string|null}|null;
  if(result?.ok!==true||!result.messageId)throw Object.assign(new Error('O envio não foi confirmado. Confira o histórico antes de repetir.'),{deliveryUncertain:true});
  return result;
}

