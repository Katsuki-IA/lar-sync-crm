alter table public.crm_meta_forms
  add column if not exists id_funnel bigint
    references public.crm_funnels(id) on delete set null;

alter table public.crm_rd_connections
  add column if not exists default_id_funnel bigint
    references public.crm_funnels(id) on delete set null;

alter table public.crm_rd_source_mappings
  add column if not exists id_funnel bigint
    references public.crm_funnels(id) on delete set null;

alter table public.crm_rd_events
  add column if not exists id_funnel bigint
    references public.crm_funnels(id) on delete set null;

create index if not exists idx_crm_meta_forms_funnel
on public.crm_meta_forms (id_funnel);

create index if not exists idx_crm_rd_source_mappings_funnel
on public.crm_rd_source_mappings (id_funnel);

update public.crm_meta_forms form
set id_funnel = funnel.id
from public.crm_funnels funnel
where form.id_funnel is null
  and funnel.id_empresa = form.id_empresa
  and funnel.is_default = true;

update public.crm_rd_connections connection
set default_id_funnel = funnel.id
from public.crm_funnels funnel
where connection.default_id_funnel is null
  and funnel.id_empresa = connection.id_empresa
  and funnel.is_default = true;

update public.crm_rd_source_mappings mapping
set id_funnel = coalesce(connection.default_id_funnel, funnel.id)
from public.crm_rd_connections connection
left join public.crm_funnels funnel
  on funnel.id_empresa = connection.id_empresa
 and funnel.is_default = true
where mapping.id_funnel is null
  and connection.id = mapping.connection_id;

update public.crm_rd_events event
set id_funnel = coalesce(
  (
    select mapping.id_funnel
    from public.crm_rd_source_mappings mapping
    where mapping.id = event.source_mapping_id
  ),
  connection.default_id_funnel,
  (
    select funnel.id
    from public.crm_funnels funnel
    where funnel.id_empresa = event.id_empresa
      and funnel.is_default = true
    limit 1
  )
)
from public.crm_rd_connections connection
where event.id_funnel is null
  and connection.id = event.connection_id;

comment on column public.crm_meta_forms.id_funnel is
'Funil do CRM usado para escolher o estágio inicial dos leads recebidos por este formulário Meta.';

comment on column public.crm_rd_connections.default_id_funnel is
'Funil padrão usado para conversões RD sem identificador próprio.';

comment on column public.crm_rd_source_mappings.id_funnel is
'Funil usado para conversões RD deste identificador.';

comment on column public.crm_rd_events.id_funnel is
'Funil aplicado no momento do processamento do evento RD.';
