create table if not exists public.crm_empreendimento_atendimento (
  id bigserial primary key,
  id_empresa bigint not null references public.empresa_dados(id) on delete cascade,
  id_empreendimento bigint not null references public.empreendimento(id) on delete cascade,
  atendimento_ativo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id_empresa, id_empreendimento)
);

create index if not exists idx_crm_empreendimento_atendimento_empresa
on public.crm_empreendimento_atendimento (id_empresa, atendimento_ativo);

drop trigger if exists set_crm_empreendimento_atendimento_updated_at
on public.crm_empreendimento_atendimento;

create trigger set_crm_empreendimento_atendimento_updated_at
before update on public.crm_empreendimento_atendimento
for each row execute function public.handle_updated_at();

alter table public.crm_empreendimento_atendimento enable row level security;

grant select, insert, update on public.crm_empreendimento_atendimento to authenticated;
grant usage, select on sequence public.crm_empreendimento_atendimento_id_seq to authenticated;
grant all on public.crm_empreendimento_atendimento to service_role;
grant all on sequence public.crm_empreendimento_atendimento_id_seq to service_role;

drop policy if exists crm_empreendimento_atendimento_select
on public.crm_empreendimento_atendimento;
create policy crm_empreendimento_atendimento_select
on public.crm_empreendimento_atendimento
for select to authenticated
using (
  id_empresa = public.crm_current_empresa_id()
  or public.crm_current_role() = 'super_admin'
);

drop policy if exists crm_empreendimento_atendimento_insert
on public.crm_empreendimento_atendimento;
create policy crm_empreendimento_atendimento_insert
on public.crm_empreendimento_atendimento
for insert to authenticated
with check (
  public.crm_can_manage_empresa(id_empresa)
  and public.crm_empreendimento_belongs_to_empresa(id_empresa, id_empreendimento)
);

drop policy if exists crm_empreendimento_atendimento_update
on public.crm_empreendimento_atendimento;
create policy crm_empreendimento_atendimento_update
on public.crm_empreendimento_atendimento
for update to authenticated
using (public.crm_can_manage_empresa(id_empresa))
with check (
  public.crm_can_manage_empresa(id_empresa)
  and public.crm_empreendimento_belongs_to_empresa(id_empresa, id_empreendimento)
);

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
  if p_crm_lead_id is null
    or p_id_empresa is null
    or p_id_empreendimento is null
  then
    return;
  end if;

  if exists (
    select 1
    from public.crm_empreendimento_atendimento as config
    where config.id_empresa = p_id_empresa
      and config.id_empreendimento = p_id_empreendimento
      and config.atendimento_ativo = true
  ) then
    insert into public.fila_leads (
      id_lead,
      crm_provider,
      id_empresa,
      id_empreendimento,
      verificado,
      status
    ) values (
      p_crm_lead_id::text,
      'Hub',
      p_id_empresa,
      p_id_empreendimento,
      0,
      'pending'
    );
  end if;
end;
$$;

revoke all on function public.crm_enqueue_fila_lead_if_enabled(
  bigint, bigint, bigint
) from public, anon, authenticated;

grant execute on function public.crm_enqueue_fila_lead_if_enabled(
  bigint, bigint, bigint
) to service_role;

create or replace function public.crm_enqueue_new_lead_if_enabled()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.crm_enqueue_fila_lead_if_enabled(
    new.id,
    new.id_empresa,
    new.id_empreendimento
  );
  return new;
end;
$$;

drop trigger if exists crm_enqueue_new_lead_if_enabled
on public.crm_leads;

create trigger crm_enqueue_new_lead_if_enabled
after insert on public.crm_leads
for each row execute function public.crm_enqueue_new_lead_if_enabled();
