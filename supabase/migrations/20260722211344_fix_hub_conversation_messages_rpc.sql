create or replace function public.crm_hub_conversation_messages(p_lead_id bigint)
returns table (
  id bigint,
  numero text,
  "type" text,
  message jsonb,
  "time" text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_lead record;
  v_company_id text;
  v_user_role text;
  v_user_company bigint;
  v_phone_candidates text[] := array[]::text[];
  v_session_candidates text[] := array[]::text[];
  v_raw_phone text;
  v_digits text;
begin
  select
    l.id,
    l.id_empresa,
    l.numero,
    l.id_crm,
    c.telefone as crm_telefone
  into v_lead
  from public.lead as l
  left join public.crm_leads as c
    on c.id::text = l.id_crm
   and c.id_empresa = l.id_empresa
  where l.id = p_lead_id
  limit 1;

  if not found then
    return;
  end if;

  v_user_role := public.crm_current_role();
  v_user_company := public.crm_current_empresa_id();

  if coalesce(v_user_role, '') <> 'super_admin'
     and coalesce(v_user_company, -1) <> v_lead.id_empresa then
    raise exception 'Sem permissao para acessar esta conversa';
  end if;

  v_company_id := v_lead.id_empresa::text;

  foreach v_raw_phone in array array[v_lead.numero, v_lead.crm_telefone]
  loop
    v_digits := regexp_replace(coalesce(v_raw_phone, ''), '\D', '', 'g');

    if v_digits <> '' then
      v_phone_candidates := array_append(v_phone_candidates, v_digits);

      if length(v_digits) > 11 then
        v_phone_candidates := array_append(v_phone_candidates, right(v_digits, 11));
      end if;

      if left(v_digits, 2) = '55' and length(v_digits) > 2 then
        v_phone_candidates := array_append(v_phone_candidates, substring(v_digits from 3));

        if length(substring(v_digits from 3)) > 11 then
          v_phone_candidates := array_append(v_phone_candidates, right(substring(v_digits from 3), 11));
        end if;
      end if;

      if right(v_digits, length(v_company_id)) = v_company_id then
        v_digits := left(v_digits, length(v_digits) - length(v_company_id));
        if v_digits <> '' then
          v_phone_candidates := array_append(v_phone_candidates, v_digits);

          if length(v_digits) > 11 then
            v_phone_candidates := array_append(v_phone_candidates, right(v_digits, 11));
          end if;

          if left(v_digits, 2) = '55' and length(v_digits) > 2 then
            v_phone_candidates := array_append(v_phone_candidates, substring(v_digits from 3));

            if length(substring(v_digits from 3)) > 11 then
              v_phone_candidates := array_append(v_phone_candidates, right(substring(v_digits from 3), 11));
            end if;
          end if;
        end if;
      end if;
    end if;
  end loop;

  select array_agg(distinct candidate)
  into v_phone_candidates
  from unnest(v_phone_candidates) as candidate
  where candidate <> '';

  if coalesce(array_length(v_phone_candidates, 1), 0) = 0 then
    return;
  end if;

  select array_agg(distinct candidate)
  into v_session_candidates
  from (
    select phone as candidate
    from unnest(v_phone_candidates) as phone
    union all
    select phone || v_company_id as candidate
    from unnest(v_phone_candidates) as phone
  ) as candidates
  where candidate <> '';

  return query
  select
    chat.id::bigint,
    chat.numero,
    chat.type,
    chat.message,
    chat.time::text,
    chat.created_at
  from public.n8n_chat_conversas as chat
  where regexp_replace(coalesce(chat.numero, ''), '\D', '', 'g') = any(v_session_candidates)
  order by
    coalesce(chat.time::text, chat.created_at::text),
    chat.id;
end;
$$;

revoke all on function public.crm_hub_conversation_messages(bigint) from public;
grant execute on function public.crm_hub_conversation_messages(bigint) to authenticated;

notify pgrst, 'reload schema';
