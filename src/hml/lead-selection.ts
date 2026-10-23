import type {SupabaseClient} from '@supabase/supabase-js';

// Preserve native table policies and cascades; never use a privileged client.
export async function deleteSelectedLeads(client:SupabaseClient,companyId:number,rows:{id:number}[]) {
  const ids=[...new Set(rows.map(r=>r.id))];
  if(!Number.isSafeInteger(companyId)||companyId<=0||!ids.length||ids.length>100||ids.some(id=>!Number.isSafeInteger(id)||id<=0))throw new Error('Selecione de 1 a 100 leads válidos.');
  const {data:auth,error:authError}=await client.auth.getUser();
  if(authError||!auth.user)throw new Error('Sessão indisponível. Entre novamente.');
  const {data:actor,error:actorError}=await client.from('crm_users').select('role,active').eq('auth_user_id',auth.user.id).single();
  if(actorError||!actor?.active||actor.role!=='super_admin')throw new Error('Somente superadministradores podem excluir leads.');
  const {data,error}=await client.from('crm_leads').delete().eq('id_empresa',companyId).in('id',ids).select('id');
  if(error)throw error;
  if(data.length!==ids.length)throw new Error('Alguns leads não estavam mais disponíveis. Atualize a lista antes de continuar.');
}

