-- Codigo fixo por empresa para acesso publico controlado ao historico individual do lead.

create or replace function public.crm_generate_hub_access_code()
returns text
language sql
volatile
as $$
  select lpad((floor(random() * 10000)::int)::text, 4, '0')
$$;

alter table public.empresa_dados
add column if not exists codigo_hub text;

update public.empresa_dados
set codigo_hub = public.crm_generate_hub_access_code()
where codigo_hub is null
   or codigo_hub !~ '^[0-9]{4}$';

alter table public.empresa_dados
alter column codigo_hub set default public.crm_generate_hub_access_code();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'empresa_dados_codigo_hub_check'
      and conrelid = 'public.empresa_dados'::regclass
  ) then
    alter table public.empresa_dados
    add constraint empresa_dados_codigo_hub_check
    check (codigo_hub ~ '^[0-9]{4}$');
  end if;
end $$;

create or replace function public.crm_public_lead_history(
  p_lead_id bigint,
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
  if p_lead_id is null or btrim(coalesce(p_codigo, '')) !~ '^[0-9]{4}$' then
    return null;
  end if;

  select
    l.id,
    l.id_empresa,
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
  where l.id = p_lead_id
    and ed.codigo_hub = btrim(p_codigo)
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
        'created_at', msg.created_at
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
      c.created_at,
      coalesce(c.time, c.created_at::text, '') as sort_value
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

revoke all on function public.crm_public_lead_history(bigint, text) from public;
grant execute on function public.crm_public_lead_history(bigint, text) to anon;
grant execute on function public.crm_public_lead_history(bigint, text) to authenticated;
grant execute on function public.crm_generate_hub_access_code() to service_role;
