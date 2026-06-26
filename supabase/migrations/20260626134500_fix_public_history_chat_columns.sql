-- A tabela n8n_chat_conversas nao possui created_at em todos os ambientes.
-- A RPC publica deve usar apenas as colunas confirmadas: id, numero, type, message e time.

create or replace function public.crm_public_lead_history(
  p_lead_ref text,
  p_codigo text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lead record;
  v_phone text;
  v_phone_last11 text;
  v_candidates text[];
  v_messages jsonb;
  v_activities jsonb;
begin
  if btrim(coalesce(p_lead_ref, '')) = ''
     or btrim(coalesce(p_codigo, '')) !~ '^[0-9]{4}$' then
    return null;
  end if;

  select
    l.id,
    l.id_empresa,
    l.historico_token,
    l.nome,
    l.telefone,
    l.email,
    l.origem,
    l.id_empreendimento,
    l.created_at,
    e.nome as empreendimento_nome,
    ed.nome as empresa_nome
  into v_lead
  from public.crm_leads l
  join public.empresa_dados ed on ed.id = l.id_empresa
  left join public.empreendimento e on e.id = l.id_empreendimento
  where ed.codigo_hub = btrim(p_codigo)
    and l.historico_token::text = btrim(p_lead_ref)
  limit 1;

  if not found then
    return null;
  end if;

  v_phone := regexp_replace(coalesce(v_lead.telefone, ''), '\D', '', 'g');
  v_phone_last11 := case
    when length(v_phone) > 11 then right(v_phone, 11)
    else v_phone
  end;

  v_candidates := array_remove(array[
    nullif(v_phone || v_lead.id_empresa::text, ''),
    nullif(v_phone_last11 || v_lead.id_empresa::text, ''),
    nullif(v_phone, ''),
    nullif(v_phone_last11, '')
  ], null);

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', msg.id,
        'type', msg.type,
        'message', msg.message,
        'time', msg.time,
        'created_at', null
      )
      order by msg.sort_value
    ),
    '[]'::jsonb
  )
  into v_messages
  from (
    select
      ('chat-' || c.id::text) as id,
      c.type,
      c.message,
      c.time,
      coalesce(c.time::text, '') as sort_value
    from public.n8n_chat_conversas c
    where c.numero = any(v_candidates)
  ) msg;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', a.id,
        'tipo', a.tipo,
        'descricao', a.descricao,
        'created_at', a.created_at
      )
      order by a.created_at
    ),
    '[]'::jsonb
  )
  into v_activities
  from public.crm_lead_activities a
  where a.lead_id = v_lead.id
    and a.tipo = 'whatsapp_automation';

  return jsonb_build_object(
    'lead',
    jsonb_build_object(
      'id', v_lead.id,
      'id_empresa', v_lead.id_empresa,
      'historico_token', v_lead.historico_token,
      'empresa_nome', v_lead.empresa_nome,
      'nome', v_lead.nome,
      'telefone', v_lead.telefone,
      'email', v_lead.email,
      'origem', v_lead.origem,
      'id_empreendimento', v_lead.id_empreendimento,
      'empreendimento_nome', v_lead.empreendimento_nome,
      'created_at', v_lead.created_at
    ),
    'messages', v_messages,
    'activities', v_activities
  );
end;
$$;

notify pgrst, 'reload schema';
