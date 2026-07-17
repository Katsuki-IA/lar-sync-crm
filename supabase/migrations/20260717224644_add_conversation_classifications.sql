create table if not exists public.crm_conversation_classifications (
  id uuid primary key default gen_random_uuid(),
  id_empresa bigint not null references public.empresa_dados(id) on delete cascade,
  lead_id bigint not null references public.lead(id) on delete cascade,
  id_empreendimento bigint null references public.empreendimento(id) on delete set null,
  cliente_respondeu boolean not null default false,
  nao_respondeu_mais boolean not null default false,
  lead_desqualificado boolean not null default false,
  qualificado boolean not null default false,
  visita_agendada boolean not null default false,
  temperatura text not null default 'frio' check (temperatura in ('frio', 'morno', 'quente')),
  resumo text null,
  motivos text[] not null default '{}',
  message_count integer not null default 0,
  human_count integer not null default 0,
  ai_count integer not null default 0,
  model text null,
  raw_response jsonb null,
  classified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id_empresa, lead_id)
);

create index if not exists idx_crm_conversation_classifications_empresa
  on public.crm_conversation_classifications(id_empresa);

create index if not exists idx_crm_conversation_classifications_empresa_lead
  on public.crm_conversation_classifications(id_empresa, lead_id);

create index if not exists idx_crm_conversation_classifications_empresa_empreendimento
  on public.crm_conversation_classifications(id_empresa, id_empreendimento);

create index if not exists idx_crm_conversation_classifications_classified_at
  on public.crm_conversation_classifications(id_empresa, classified_at desc);

alter table public.crm_conversation_classifications enable row level security;

drop policy if exists "CRM classifications select by tenant" on public.crm_conversation_classifications;
create policy "CRM classifications select by tenant"
on public.crm_conversation_classifications
for select
to authenticated
using (
  public.crm_current_role() = 'super_admin'
  or (
    id_empresa = public.crm_current_empresa_id()
    and public.crm_current_role() in ('manager', 'gestor')
  )
);

drop policy if exists "CRM classifications manage by admin" on public.crm_conversation_classifications;
create policy "CRM classifications manage by admin"
on public.crm_conversation_classifications
for all
to authenticated
using (
  public.crm_current_role() = 'super_admin'
  or (
    id_empresa = public.crm_current_empresa_id()
    and public.crm_current_role() in ('manager', 'gestor')
  )
)
with check (
  public.crm_current_role() = 'super_admin'
  or (
    id_empresa = public.crm_current_empresa_id()
    and public.crm_current_role() in ('manager', 'gestor')
  )
);

grant select, insert, update, delete on public.crm_conversation_classifications to authenticated;
