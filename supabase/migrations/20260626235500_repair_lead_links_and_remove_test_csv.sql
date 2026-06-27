-- Restaura estagios/tags dos leads Ana e Bruno Katsuki a partir do historico
-- e remove exclusivamente os 50 registros do CSV de teste de 25/06/2026.

with target_leads as (
  select l.id, l.id_empresa
  from public.crm_leads l
  where lower(btrim(l.nome)) in ('ana katsuki', 'bruno katsuki')
),
latest_stage as (
  select distinct on (a.lead_id)
    a.lead_id,
    regexp_replace(a.descricao, '^.* para ', '', 'i') as stage_name
  from public.crm_lead_activities a
  join target_leads l on l.id = a.lead_id
  where a.tipo = 'stage_change'
    and a.descricao ilike '% para %'
  order by a.lead_id, a.created_at desc, a.id desc
),
resolved_stage as (
  select l.id as lead_id, s.id as stage_id
  from target_leads l
  join latest_stage event on event.lead_id = l.id
  join public.crm_stages s
    on s.id_empresa = l.id_empresa
   and coalesce(s.ativo, true) = true
   and lower(btrim(s.nome)) = lower(btrim(event.stage_name))
)
update public.crm_leads lead
set crm_stage_id = resolved_stage.stage_id,
    updated_at = now()
from resolved_stage
where lead.id = resolved_stage.lead_id
  and not exists (
    select 1
    from public.crm_stages current_stage
    where current_stage.id = lead.crm_stage_id
      and current_stage.id_empresa = lead.id_empresa
      and coalesce(current_stage.ativo, true) = true
  );

with target_leads as (
  select l.id, l.id_empresa
  from public.crm_leads l
  where lower(btrim(l.nome)) in ('ana katsuki', 'bruno katsuki')
),
historical_tags as (
  select distinct
    l.id as lead_id,
    l.id_empresa,
    regexp_replace(a.descricao, '^Tag adicionada:\s*', '', 'i') as tag_name
  from target_leads l
  join public.crm_lead_activities a on a.lead_id = l.id
  where a.tipo = 'tag_add'
    and a.descricao ilike 'Tag adicionada:%'
)
insert into public.crm_lead_tags (lead_id, tag_id)
select historical_tags.lead_id, tag.id
from historical_tags
join public.crm_tags tag
  on tag.id_empresa = historical_tags.id_empresa
 and lower(btrim(tag.nome)) = lower(btrim(historical_tags.tag_name))
on conflict (lead_id, tag_id) do nothing;

create temporary table crm_test_csv_leads_to_delete on commit drop as
select l.id, l.id_empresa
from public.crm_leads l
where l.telefone ~ '^55419981023[0-4][0-9]$|^5541998102350$'
  and l.telefone::numeric between 5541998102301 and 5541998102350
  and (l.created_at at time zone 'America/Sao_Paulo')::date = date '2026-06-25';

do $$
declare
  v_count integer;
begin
  select count(*) into v_count from crm_test_csv_leads_to_delete;
  if v_count <> 50 then
    raise exception 'Remocao cancelada: esperados 50 leads do CSV de teste, encontrados %', v_count;
  end if;
end;
$$;

delete from public.fila_leads queue
using crm_test_csv_leads_to_delete test_lead
where queue.id_empresa = test_lead.id_empresa
  and queue.id_lead::text = test_lead.id::text;

delete from public.lead external_lead
using crm_test_csv_leads_to_delete test_lead
where external_lead.id_empresa = test_lead.id_empresa
  and external_lead.id_crm::text = test_lead.id::text;

delete from public.crm_leads lead
using crm_test_csv_leads_to_delete test_lead
where lead.id = test_lead.id;
