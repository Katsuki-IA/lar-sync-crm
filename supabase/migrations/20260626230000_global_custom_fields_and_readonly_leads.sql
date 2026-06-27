-- Campos personalizados globais e operacao de leads somente leitura para gestor/corretor.

create table if not exists public.crm_global_custom_fields (
  id bigserial primary key,
  nome varchar(120) not null,
  tipo text not null check (tipo in ('text', 'select', 'checkbox')),
  obrigatorio boolean not null default false,
  opcoes text[] not null default '{}',
  ordem integer not null default 0 check (ordem >= 0),
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (btrim(nome) <> ''),
  check (tipo = 'text' or cardinality(opcoes) > 0)
);

create unique index if not exists crm_global_custom_fields_nome_active_key
on public.crm_global_custom_fields (lower(btrim(nome))) where ativo = true;

alter table public.crm_lead_custom_fields
  add column if not exists global_field_id bigint references public.crm_global_custom_fields(id);

create unique index if not exists crm_custom_fields_empresa_global_key
on public.crm_lead_custom_fields (id_empresa, global_field_id)
where global_field_id is not null;

insert into public.crm_global_custom_fields (nome, tipo, obrigatorio, opcoes, ordem, ativo)
select source.nome, source.tipo, source.obrigatorio, source.opcoes,
       row_number() over (order by source.ordem, source.id)::integer,
       true
from (
  select distinct on (lower(btrim(field.nome)))
    field.id, field.nome, field.tipo, field.obrigatorio, field.opcoes, field.ordem
  from public.crm_lead_custom_fields field
  where field.ativo = true and nullif(btrim(field.nome), '') is not null
  order by lower(btrim(field.nome)), field.id
) source
where not exists (
  select 1 from public.crm_global_custom_fields global_field
  where lower(btrim(global_field.nome)) = lower(btrim(source.nome)) and global_field.ativo = true
);

create or replace function public.crm_sync_company_global_custom_fields(p_id_empresa bigint)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  global_field record;
  local_field_id bigint;
begin
  if p_id_empresa is null then return; end if;

  for global_field in
    select * from public.crm_global_custom_fields where ativo = true order by ordem, id
  loop
    select id into local_field_id
    from public.crm_lead_custom_fields
    where id_empresa = p_id_empresa and global_field_id = global_field.id
    limit 1;

    if local_field_id is null then
      select id into local_field_id
      from public.crm_lead_custom_fields
      where id_empresa = p_id_empresa
        and global_field_id is null
        and lower(btrim(nome)) = lower(btrim(global_field.nome))
      order by id
      limit 1;
    end if;

    if local_field_id is null then
      insert into public.crm_lead_custom_fields (
        id_empresa, nome, tipo, obrigatorio, opcoes, ordem, ativo, global_field_id
      ) values (
        p_id_empresa, global_field.nome, global_field.tipo, global_field.obrigatorio,
        global_field.opcoes, global_field.ordem, true, global_field.id
      );
    else
      update public.crm_lead_custom_fields
      set nome = global_field.nome,
          tipo = global_field.tipo,
          obrigatorio = global_field.obrigatorio,
          opcoes = global_field.opcoes,
          ordem = global_field.ordem,
          ativo = true,
          global_field_id = global_field.id
      where id = local_field_id;
    end if;
  end loop;

  update public.crm_lead_custom_fields
  set ativo = false
  where id_empresa = p_id_empresa and global_field_id is null;
end;
$$;

do $$
declare company record;
begin
  for company in
    select distinct id_empresa from (
      select id_empresa from public.crm_users where id_empresa is not null
      union
      select id_empresa from public.credentials where id_empresa is not null and default_crm = 'hub'
    ) companies
  loop
    perform public.crm_sync_company_global_custom_fields(company.id_empresa);
  end loop;
end $$;

create or replace function public.crm_global_custom_field_create(
  p_nome text,
  p_tipo text,
  p_obrigatorio boolean,
  p_opcoes text[]
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare new_id bigint; company record; normalized_options text[];
begin
  perform public.crm_assert_super_admin();
  if nullif(btrim(p_nome), '') is null then raise exception 'Informe o nome do campo'; end if;
  if p_tipo not in ('text', 'select', 'checkbox') then raise exception 'Tipo de campo inválido'; end if;
  normalized_options := case when p_tipo = 'text' then '{}'::text[] else coalesce(p_opcoes, '{}'::text[]) end;
  if p_tipo <> 'text' and cardinality(normalized_options) = 0 then raise exception 'Adicione pelo menos uma opção'; end if;

  insert into public.crm_global_custom_fields (nome, tipo, obrigatorio, opcoes, ordem)
  values (
    btrim(p_nome), p_tipo, coalesce(p_obrigatorio, false), normalized_options,
    coalesce((select max(ordem) + 1 from public.crm_global_custom_fields where ativo = true), 1)
  ) returning id into new_id;

  for company in select distinct id_empresa from public.crm_funnels where id_empresa is not null loop
    perform public.crm_sync_company_global_custom_fields(company.id_empresa);
  end loop;
  return new_id;
end;
$$;

create or replace function public.crm_global_custom_field_update(
  p_id bigint,
  p_nome text,
  p_obrigatorio boolean,
  p_opcoes text[]
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare field_type text; normalized_options text[];
begin
  perform public.crm_assert_super_admin();
  select tipo into field_type from public.crm_global_custom_fields where id = p_id and ativo = true;
  if field_type is null then raise exception 'Campo global não encontrado'; end if;
  if nullif(btrim(p_nome), '') is null then raise exception 'Informe o nome do campo'; end if;
  normalized_options := case when field_type = 'text' then '{}'::text[] else coalesce(p_opcoes, '{}'::text[]) end;
  if field_type <> 'text' and cardinality(normalized_options) = 0 then raise exception 'Adicione pelo menos uma opção'; end if;

  update public.crm_global_custom_fields
  set nome = btrim(p_nome), obrigatorio = coalesce(p_obrigatorio, false),
      opcoes = normalized_options, updated_at = now()
  where id = p_id;

  update public.crm_lead_custom_fields
  set nome = btrim(p_nome), obrigatorio = coalesce(p_obrigatorio, false), opcoes = normalized_options
  where global_field_id = p_id;
end;
$$;

create or replace function public.crm_global_custom_fields_reorder(p_ids bigint[])
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare field_id bigint; next_order integer := 0;
begin
  perform public.crm_assert_super_admin();
  if coalesce(array_length(p_ids, 1), 0) <> (
    select count(*) from public.crm_global_custom_fields where ativo = true
  ) then raise exception 'A lista de campos está incompleta'; end if;

  foreach field_id in array p_ids loop
    next_order := next_order + 1;
    update public.crm_global_custom_fields set ordem = next_order, updated_at = now()
    where id = field_id and ativo = true;
    if not found then raise exception 'Campo global inválido'; end if;
  end loop;

  update public.crm_lead_custom_fields local_field
  set ordem = global_field.ordem
  from public.crm_global_custom_fields global_field
  where local_field.global_field_id = global_field.id;
end;
$$;

create or replace function public.crm_global_custom_field_archive(p_id bigint)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.crm_assert_super_admin();
  update public.crm_global_custom_fields set ativo = false, updated_at = now() where id = p_id and ativo = true;
  if not found then raise exception 'Campo global não encontrado'; end if;
  update public.crm_lead_custom_fields set ativo = false where global_field_id = p_id;
end;
$$;

create or replace function public.crm_seed_global_custom_fields_on_credentials()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.default_crm = 'hub' and new.id_empresa is not null then
    perform public.crm_sync_company_global_custom_fields(new.id_empresa);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_crm_seed_global_custom_fields on public.credentials;
create trigger trg_crm_seed_global_custom_fields
after insert or update of default_crm, id_empresa on public.credentials
for each row execute function public.crm_seed_global_custom_fields_on_credentials();

alter table public.crm_global_custom_fields enable row level security;
create policy crm_global_custom_fields_superadmin_select on public.crm_global_custom_fields
for select to authenticated using (public.crm_get_my_role() = 'super_admin');
grant select on public.crm_global_custom_fields to authenticated;
grant all on public.crm_global_custom_fields to service_role;
grant all on sequence public.crm_global_custom_fields_id_seq to service_role;
revoke insert, update, delete on public.crm_lead_custom_fields from authenticated;

grant execute on function public.crm_global_custom_field_create(text, text, boolean, text[]) to authenticated;
grant execute on function public.crm_global_custom_field_update(bigint, text, boolean, text[]) to authenticated;
grant execute on function public.crm_global_custom_fields_reorder(bigint[]) to authenticated;
grant execute on function public.crm_global_custom_field_archive(bigint) to authenticated;
grant execute on function public.crm_sync_company_global_custom_fields(bigint) to service_role;

-- Todo lead com empreendimento entra na fila. Leads sem interesse continuam fora da fila.
create or replace function public.crm_enqueue_fila_lead_if_enabled(
  p_crm_lead_id bigint,
  p_id_empresa bigint,
  p_id_empreendimento bigint
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_crm_lead_id is null or p_id_empresa is null or p_id_empreendimento is null then return; end if;
  if exists (
    select 1 from public.fila_leads
    where id_lead = p_crm_lead_id::text and id_empresa = p_id_empresa and crm_provider = 'Hub'
  ) then return; end if;

  insert into public.fila_leads (
    id_lead, crm_provider, id_empresa, id_empreendimento, verificado, status
  ) values (
    p_crm_lead_id::text, 'Hub', p_id_empresa, p_id_empreendimento, 0, 'pending'
  );
end;
$$;

-- Somente o superadmin altera ou remove leads pelo cliente autenticado.
drop policy if exists crm_leads_insert on public.crm_leads;
create policy crm_leads_insert on public.crm_leads
for insert to authenticated
with check (
  public.crm_current_role() = 'super_admin'
  and public.crm_assignee_belongs_to_empresa(id_empresa, crm_assigned_to)
  and public.crm_stage_belongs_to_empresa(id_empresa, crm_stage_id)
  and public.crm_empreendimento_belongs_to_empresa(id_empresa, id_empreendimento)
);

drop policy if exists crm_leads_update on public.crm_leads;
create policy crm_leads_update on public.crm_leads
for update to authenticated
using (public.crm_current_role() = 'super_admin')
with check (
  public.crm_current_role() = 'super_admin'
  and public.crm_assignee_belongs_to_empresa(id_empresa, crm_assigned_to)
  and public.crm_stage_belongs_to_empresa(id_empresa, crm_stage_id)
  and public.crm_empreendimento_belongs_to_empresa(id_empresa, id_empreendimento)
);

drop policy if exists crm_leads_delete on public.crm_leads;
create policy crm_leads_delete on public.crm_leads
for delete to authenticated using (public.crm_current_role() = 'super_admin');

drop policy if exists crm_lead_tags_insert on public.crm_lead_tags;
drop policy if exists crm_lead_tags_update on public.crm_lead_tags;
drop policy if exists crm_lead_tags_delete on public.crm_lead_tags;
create policy crm_lead_tags_insert on public.crm_lead_tags for insert to authenticated
with check (public.crm_current_role() = 'super_admin' and public.crm_can_access_lead(lead_id));
create policy crm_lead_tags_update on public.crm_lead_tags for update to authenticated
using (public.crm_current_role() = 'super_admin')
with check (public.crm_current_role() = 'super_admin' and public.crm_can_access_lead(lead_id));
create policy crm_lead_tags_delete on public.crm_lead_tags for delete to authenticated
using (public.crm_current_role() = 'super_admin');

drop policy if exists crm_lead_activities_insert on public.crm_lead_activities;
drop policy if exists crm_lead_activities_update on public.crm_lead_activities;
drop policy if exists crm_lead_activities_delete on public.crm_lead_activities;
create policy crm_lead_activities_insert on public.crm_lead_activities for insert to authenticated
with check (public.crm_current_role() = 'super_admin' and public.crm_can_access_lead(lead_id));
create policy crm_lead_activities_update on public.crm_lead_activities for update to authenticated
using (public.crm_current_role() = 'super_admin')
with check (public.crm_current_role() = 'super_admin' and public.crm_can_access_lead(lead_id));
create policy crm_lead_activities_delete on public.crm_lead_activities for delete to authenticated
using (public.crm_current_role() = 'super_admin');

drop policy if exists crm_lead_custom_values_insert on public.crm_lead_custom_values;
drop policy if exists crm_lead_custom_values_update on public.crm_lead_custom_values;
drop policy if exists crm_lead_custom_values_delete on public.crm_lead_custom_values;
create policy crm_lead_custom_values_insert on public.crm_lead_custom_values for insert to authenticated
with check (public.crm_current_role() = 'super_admin' and public.crm_can_access_lead(lead_id));
create policy crm_lead_custom_values_update on public.crm_lead_custom_values for update to authenticated
using (public.crm_current_role() = 'super_admin')
with check (public.crm_current_role() = 'super_admin' and public.crm_can_access_lead(lead_id));
create policy crm_lead_custom_values_delete on public.crm_lead_custom_values for delete to authenticated
using (public.crm_current_role() = 'super_admin');

drop policy if exists "crm_lead_tasks_insert" on public.crm_lead_tasks;
drop policy if exists "crm_lead_tasks_update" on public.crm_lead_tasks;
drop policy if exists "crm_lead_tasks_delete" on public.crm_lead_tasks;
drop policy if exists crm_lead_tasks_insert on public.crm_lead_tasks;
drop policy if exists crm_lead_tasks_update on public.crm_lead_tasks;
drop policy if exists crm_lead_tasks_delete on public.crm_lead_tasks;
