create or replace function public.gloria_leads_por_empreendimento(p_mes date)
returns json
language sql
stable
security definer
set search_path = public
as $$
with bounds as (
  select date_trunc('month', p_mes)::timestamptz as ini,
         (date_trunc('month', p_mes) + interval '1 month')::timestamptz as fim,
         (date_trunc('month', p_mes) - interval '1 month')::timestamptz as ini_prev
), emp as (
  select e.id, e.nome, e.id_empresa, ed.nome as empresa_nome
  from public.empreendimento e
  left join public.empresa_dados ed on ed.id = e.id_empresa
  where coalesce(lower(e.status), '') <> 'inativo'
), agg as (
  select l.id_empreendimento as emp_id,
         count(*) filter (where l.created_at >= b.ini and l.created_at < b.fim) as leads_mes,
         count(*) filter (where l.created_at >= b.ini_prev and l.created_at < b.ini) as leads_prev,
         max(l.created_at) as ultima_entrada
  from public.crm_leads l cross join bounds b
  where l.id_empreendimento is not null
  group by l.id_empreendimento
), origem as (
  select l.id_empreendimento as emp_id,
         coalesce(nullif(l.origem, ''), 'ND') as origem,
         count(*) as total
  from public.crm_leads l cross join bounds b
  where l.id_empreendimento is not null
    and l.created_at >= b.ini and l.created_at < b.fim
  group by 1, 2
)
select coalesce(json_agg(row_to_json(t) order by t.empresa_nome nulls last, t.empreendimento_nome), '[]'::json)
from (
  select emp.id_empresa as empresa_id,
         emp.empresa_nome,
         emp.id as empreendimento_id,
         emp.nome as empreendimento_nome,
         coalesce(agg.leads_mes, 0) as leads_mes,
         coalesce(agg.leads_prev, 0) as leads_mes_anterior,
         null::bigint as leads_respondidos_mes,
         agg.ultima_entrada,
         coalesce((
           select json_agg(json_build_object('origem', o.origem, 'total', o.total) order by o.total desc)
           from origem o where o.emp_id = emp.id
         ), '[]'::json) as por_origem
  from emp
  left join agg on agg.emp_id = emp.id
) t;
$$;

revoke all on function public.gloria_leads_por_empreendimento(date) from public;
grant execute on function public.gloria_leads_por_empreendimento(date) to service_role;