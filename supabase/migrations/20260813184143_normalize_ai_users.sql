-- Normalize legacy technical AI users and make lazy provisioning idempotent.

update public.empresa_dados empresa
set nome_atendente_ia = technical_user.nome
from public.crm_users technical_user
where technical_user.id_empresa = empresa.id
  and technical_user.auth_user_id is null
  and lower(technical_user.email) = 'ia+' || empresa.id::text || '@hub.katsuki.local'
  and nullif(btrim(technical_user.nome), '') is not null
  and nullif(btrim(empresa.nome_atendente_ia), '') is null;

update public.crm_users technical_user
set
  role = 'ai_agent',
  active = false,
  updated_at = now()
where technical_user.auth_user_id is null
  and technical_user.id_empresa is not null
  and lower(technical_user.email) =
    'ia+' || technical_user.id_empresa::text || '@hub.katsuki.local'
  and (
    technical_user.role is distinct from 'ai_agent'
    or technical_user.active is distinct from false
  );

create unique index if not exists crm_users_one_ai_agent_per_company_key
  on public.crm_users (id_empresa)
  where role = 'ai_agent';

create or replace function public.crm_get_or_create_ai_user(p_id_empresa bigint)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_nome text;
  v_existing_nome text;
  v_auth_user_id uuid;
  v_expected_email text;
begin
  if p_id_empresa is null then
    raise exception 'Empresa obrigatoria';
  end if;

  select nullif(btrim(empresa.nome_atendente_ia), '')
    into v_nome
  from public.empresa_dados empresa
  where empresa.id = p_id_empresa;

  if not found then
    raise exception 'Empresa % nao encontrada', p_id_empresa;
  end if;

  v_expected_email := 'ia+' || p_id_empresa::text || '@hub.katsuki.local';

  select technical_user.id, technical_user.nome, technical_user.auth_user_id
    into v_user_id, v_existing_nome, v_auth_user_id
  from public.crm_users technical_user
  where technical_user.id_empresa = p_id_empresa
    and (
      technical_user.role = 'ai_agent'
      or lower(technical_user.email) = v_expected_email
    )
  order by
    (lower(technical_user.email) = v_expected_email) desc,
    technical_user.created_at asc nulls last,
    technical_user.id asc
  limit 1
  for update;

  if v_auth_user_id is not null then
    raise exception 'O email tecnico da IA esta vinculado a um usuario de login';
  end if;

  v_nome := coalesce(v_nome, nullif(btrim(v_existing_nome), ''), 'Atendente IA');

  if v_user_id is not null then
    update public.crm_users
    set
      nome = v_nome,
      email = v_expected_email,
      role = 'ai_agent',
      active = false,
      updated_at = now()
    where id = v_user_id;
  else
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
      v_expected_email,
      'ai_agent',
      false
    )
    on conflict (email) do update
    set
      nome = excluded.nome,
      role = 'ai_agent',
      active = false,
      updated_at = now()
    where public.crm_users.id_empresa = excluded.id_empresa
      and public.crm_users.auth_user_id is null
    returning id into v_user_id;

    if v_user_id is null then
      raise exception 'O email tecnico da IA ja esta em uso por outro usuario';
    end if;
  end if;

  return v_user_id;
end;
$$;

grant execute on function public.crm_get_or_create_ai_user(bigint) to authenticated;
grant execute on function public.crm_get_or_create_ai_user(bigint) to service_role;
