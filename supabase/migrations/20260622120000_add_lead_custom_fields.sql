create table if not exists public.crm_lead_custom_fields (
  id bigserial primary key,
  id_empresa bigint not null references public.empresa_dados(id) on delete cascade,
  nome varchar(120) not null,
  tipo text not null check (tipo in ('text', 'select', 'checkbox')),
  obrigatorio boolean not null default false,
  opcoes text[] not null default '{}',
  ordem integer not null default 0 check (ordem >= 0),
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_lead_custom_fields_nome_check check (trim(nome) <> ''),
  constraint crm_lead_custom_fields_opcoes_check check (
    tipo = 'text' or cardinality(opcoes) > 0
  )
);

create unique index if not exists uq_crm_lead_custom_fields_empresa_nome_active
on public.crm_lead_custom_fields (id_empresa, lower(nome))
where ativo = true;

create index if not exists idx_crm_lead_custom_fields_empresa_order
on public.crm_lead_custom_fields (id_empresa, ativo, ordem, id);

create table if not exists public.crm_lead_custom_values (
  id bigserial primary key,
  lead_id bigint not null references public.crm_leads(id) on delete cascade,
  field_id bigint not null references public.crm_lead_custom_fields(id) on delete restrict,
  valor_texto text,
  valor_opcoes text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lead_id, field_id)
);

create index if not exists idx_crm_lead_custom_values_lead
on public.crm_lead_custom_values (lead_id);

create or replace function public.crm_validate_lead_custom_value_scope()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1
    from public.crm_leads as lead
    join public.crm_lead_custom_fields as field
      on field.id = new.field_id
     and field.id_empresa = lead.id_empresa
    where lead.id = new.lead_id
  ) then
    raise exception 'Campo personalizado e lead pertencem a empresas diferentes';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_crm_lead_custom_value_scope
on public.crm_lead_custom_values;

create trigger validate_crm_lead_custom_value_scope
before insert or update on public.crm_lead_custom_values
for each row execute function public.crm_validate_lead_custom_value_scope();

drop trigger if exists set_crm_lead_custom_fields_updated_at
on public.crm_lead_custom_fields;

create trigger set_crm_lead_custom_fields_updated_at
before update on public.crm_lead_custom_fields
for each row execute function public.handle_updated_at();

drop trigger if exists set_crm_lead_custom_values_updated_at
on public.crm_lead_custom_values;

create trigger set_crm_lead_custom_values_updated_at
before update on public.crm_lead_custom_values
for each row execute function public.handle_updated_at();

alter table public.crm_lead_custom_fields enable row level security;
alter table public.crm_lead_custom_values enable row level security;

drop policy if exists crm_lead_custom_fields_select on public.crm_lead_custom_fields;
create policy crm_lead_custom_fields_select
on public.crm_lead_custom_fields
for select to authenticated
using (
  id_empresa = public.crm_get_my_empresa()
  or public.crm_get_my_role() = 'super_admin'
);

drop policy if exists crm_lead_custom_fields_insert on public.crm_lead_custom_fields;
create policy crm_lead_custom_fields_insert
on public.crm_lead_custom_fields
for insert to authenticated
with check (
  (id_empresa = public.crm_get_my_empresa() and public.crm_get_my_role() = 'manager')
  or public.crm_get_my_role() = 'super_admin'
);

drop policy if exists crm_lead_custom_fields_update on public.crm_lead_custom_fields;
create policy crm_lead_custom_fields_update
on public.crm_lead_custom_fields
for update to authenticated
using (
  (id_empresa = public.crm_get_my_empresa() and public.crm_get_my_role() = 'manager')
  or public.crm_get_my_role() = 'super_admin'
)
with check (
  (id_empresa = public.crm_get_my_empresa() and public.crm_get_my_role() = 'manager')
  or public.crm_get_my_role() = 'super_admin'
);

drop policy if exists crm_lead_custom_values_select on public.crm_lead_custom_values;
create policy crm_lead_custom_values_select
on public.crm_lead_custom_values
for select to authenticated
using (
  exists (
    select 1
    from public.crm_leads as lead
    where lead.id = crm_lead_custom_values.lead_id
      and (
        lead.id_empresa = public.crm_get_my_empresa()
        or public.crm_get_my_role() = 'super_admin'
      )
  )
);

drop policy if exists crm_lead_custom_values_insert on public.crm_lead_custom_values;
create policy crm_lead_custom_values_insert
on public.crm_lead_custom_values
for insert to authenticated
with check (
  exists (
    select 1
    from public.crm_leads as lead
    join public.crm_lead_custom_fields as field
      on field.id = crm_lead_custom_values.field_id
     and field.id_empresa = lead.id_empresa
    where lead.id = crm_lead_custom_values.lead_id
      and (
        lead.id_empresa = public.crm_get_my_empresa()
        or public.crm_get_my_role() = 'super_admin'
      )
  )
);

drop policy if exists crm_lead_custom_values_update on public.crm_lead_custom_values;
create policy crm_lead_custom_values_update
on public.crm_lead_custom_values
for update to authenticated
using (
  exists (
    select 1
    from public.crm_leads as lead
    where lead.id = crm_lead_custom_values.lead_id
      and (
        lead.id_empresa = public.crm_get_my_empresa()
        or public.crm_get_my_role() = 'super_admin'
      )
  )
)
with check (
  exists (
    select 1
    from public.crm_leads as lead
    join public.crm_lead_custom_fields as field
      on field.id = crm_lead_custom_values.field_id
     and field.id_empresa = lead.id_empresa
    where lead.id = crm_lead_custom_values.lead_id
      and (
        lead.id_empresa = public.crm_get_my_empresa()
        or public.crm_get_my_role() = 'super_admin'
      )
  )
);

drop policy if exists crm_lead_custom_values_delete on public.crm_lead_custom_values;
create policy crm_lead_custom_values_delete
on public.crm_lead_custom_values
for delete to authenticated
using (
  exists (
    select 1
    from public.crm_leads as lead
    where lead.id = crm_lead_custom_values.lead_id
      and (
        lead.id_empresa = public.crm_get_my_empresa()
        or public.crm_get_my_role() = 'super_admin'
      )
  )
);

grant select, insert, update on public.crm_lead_custom_fields to authenticated;
grant usage, select on sequence public.crm_lead_custom_fields_id_seq to authenticated;
grant select, insert, update, delete on public.crm_lead_custom_values to authenticated;
grant usage, select on sequence public.crm_lead_custom_values_id_seq to authenticated;

grant all on public.crm_lead_custom_fields to service_role;
grant all on public.crm_lead_custom_values to service_role;
grant all on sequence public.crm_lead_custom_fields_id_seq to service_role;
grant all on sequence public.crm_lead_custom_values_id_seq to service_role;
