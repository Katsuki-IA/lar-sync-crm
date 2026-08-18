alter table public.crm_meta_connections
  add column if not exists selected_page_ids text[] not null default '{}';

update public.crm_meta_connections connection
set selected_page_ids = configured.page_ids
from (
  select
    id_empresa,
    array_agg(distinct page_id order by page_id) as page_ids
  from public.crm_meta_forms
  where id_empreendimento is not null
    and id_funnel is not null
  group by id_empresa
) configured
where configured.id_empresa = connection.id_empresa
  and cardinality(connection.selected_page_ids) = 0;

comment on column public.crm_meta_connections.selected_page_ids is
  'Páginas Meta explicitamente autorizadas para sincronização nesta empresa. Impede mistura entre tenants que usam o mesmo usuário Facebook.';
