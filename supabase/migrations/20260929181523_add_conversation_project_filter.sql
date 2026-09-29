-- Additive RPC: preserve the original endpoint for previously published clients.
-- Copy the deployed identity/access rules, filtering the canonical conversation
-- by its current project (focus first, original project as fallback), before count/limit.
do $migration$
declare
  original text := pg_get_functiondef('public.crm_whatsapp_list_conversations(bigint,text,boolean,integer,integer)'::regprocedure);
  candidate text;
begin
  if position('p_offset integer DEFAULT 0)' in original) = 0
     or position('where r.conversation_rank = 1' in original) = 0 then
    raise exception 'Unexpected conversation RPC definition; review before migrating';
  end if;
  candidate := replace(original,
    'FUNCTION public.crm_whatsapp_list_conversations(',
    'FUNCTION public.crm_whatsapp_list_conversations_v2(');
  candidate := replace(candidate, 'p_offset integer DEFAULT 0)',
    'p_offset integer DEFAULT 0, p_id_empreendimento bigint DEFAULT NULL)');
  candidate := replace(candidate, 'where r.conversation_rank = 1',
    'where r.conversation_rank = 1
      and (p_id_empreendimento is null or (
        coalesce(r.empreendimento_em_foco_id, r.id_empreendimento) = p_id_empreendimento
        and exists (select 1 from public.empreendimento e
          where e.id = p_id_empreendimento and e.id_empresa = p_id_empresa)
      ))');
  execute candidate;
end;
$migration$;

revoke all on function public.crm_whatsapp_list_conversations_v2(bigint,text,boolean,integer,integer,bigint) from public, anon;
grant execute on function public.crm_whatsapp_list_conversations_v2(bigint,text,boolean,integer,integer,bigint) to authenticated;
