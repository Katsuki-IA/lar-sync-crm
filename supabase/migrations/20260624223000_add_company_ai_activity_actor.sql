alter table public.empresa_dados
  add column if not exists nome_atendente_ia text;

create or replace function public.crm_get_or_create_ai_user(p_id_empresa bigint)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_nome text;
begin
  if p_id_empresa is null then
    raise exception 'Empresa obrigatoria';
  end if;

  select nullif(btrim(nome_atendente_ia), '')
    into v_nome
  from public.empresa_dados
  where id = p_id_empresa;

  v_nome := coalesce(v_nome, 'Atendente IA');

  select id
    into v_user_id
  from public.crm_users
  where id_empresa = p_id_empresa
    and role = 'ai_agent'
  order by created_at asc nulls last, id asc
  limit 1;

  if v_user_id is null then
    insert into public.crm_users (
      id_empresa,
      nome,
      email,
      role,
      active
    )
    values (
      p_id_empresa,
      v_nome,
      'ia+' || p_id_empresa::text || '@hub.katsuki.local',
      'ai_agent',
      false
    )
    returning id into v_user_id;
  else
    update public.crm_users
    set
      nome = v_nome,
      active = false,
      updated_at = now()
    where id = v_user_id;
  end if;

  return v_user_id;
end;
$$;

grant execute on function public.crm_get_or_create_ai_user(bigint) to authenticated;
grant execute on function public.crm_get_or_create_ai_user(bigint) to service_role;
