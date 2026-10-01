alter table public.empresa_dados
  add column if not exists c2s_fila_venda_id bigint check (c2s_fila_venda_id > 0),
  add column if not exists c2s_fila_locacao_id bigint check (c2s_fila_locacao_id > 0);
alter table public.empreendimento
  add column if not exists c2s_fila_venda_id bigint check (c2s_fila_venda_id > 0),
  add column if not exists c2s_fila_locacao_id bigint check (c2s_fila_locacao_id > 0);
alter table public.crm_leads
  add column if not exists tipo_negociacao text not null default 'indefinido'
    check (tipo_negociacao in ('venda','locacao','indefinido')),
  add column if not exists tipo_negociacao_origem text;
alter table public.lead
  add column if not exists tipo_negociacao text not null default 'indefinido'
    check (tipo_negociacao in ('venda','locacao','indefinido'));

-- Called inside ingestion: snapshot the configured form, without reclassifying old leads.
-- Invoker security preserves the existing ingestion authorization and transaction.
create or replace function public.crm_meta_negotiation_snapshot()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_mode text;
begin
  if new.crm_lead_id is null then return new; end if;
  select modalidade_negociacao into v_mode from public.crm_meta_forms
  where id_empresa=new.id_empresa and form_id=new.form_id;
  if v_mode in ('venda','locacao') then
    update public.crm_leads set tipo_negociacao=v_mode,
      tipo_negociacao_origem='meta_form:'||new.form_id
    where id=new.crm_lead_id and id_empresa=new.id_empresa and tipo_negociacao='indefinido';
  end if;
  return new;
end $$;
revoke all on function public.crm_meta_negotiation_snapshot() from public;
create trigger crm_meta_negotiation_snapshot
after insert or update of crm_lead_id on public.crm_meta_leads
for each row execute function public.crm_meta_negotiation_snapshot();

create or replace function public.crm_mirror_negotiation()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  update public.lead set tipo_negociacao=new.tipo_negociacao,
    locacao=case when new.tipo_negociacao='locacao' then true
      when new.tipo_negociacao='venda' then false else locacao end
  where id_empresa=new.id_empresa and (id=new.lead_id or id_crm=new.id::text);
  return new;
end $$;
revoke all on function public.crm_mirror_negotiation() from public;
create trigger crm_mirror_negotiation after insert or update of tipo_negociacao
on public.crm_leads for each row execute function public.crm_mirror_negotiation();

-- Shared by n8n and the Hub dispatch Edge Function. Service-only access; no credentials.
create or replace function public.crm_resolve_c2s_routing(
  p_id_empresa bigint, p_crm_lead_id bigint default null,
  p_legacy_lead_id bigint default null, p_id_empreendimento bigint default null
) returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare co public.empresa_dados; pr public.empreendimento;
  cl public.crm_leads; ll public.lead; v_project bigint; v_mode text; v_queue bigint;
begin
  select * into co from public.empresa_dados where id=p_id_empresa;
  if co.id is null then raise exception 'Empresa não encontrada'; end if;
  if p_crm_lead_id is not null then
    select * into cl from public.crm_leads where id=p_crm_lead_id and id_empresa=p_id_empresa;
    if cl.id is null then raise exception 'Lead Hub não pertence à empresa'; end if;
  end if;
  if p_legacy_lead_id is not null then
    select * into ll from public.lead where id=p_legacy_lead_id and id_empresa=p_id_empresa;
    if ll.id is null then raise exception 'Lead operacional não pertence à empresa'; end if;
  end if;
  v_project := coalesce(p_id_empreendimento,ll.empreendimento_em_foco_id,ll.id_empreendimento,cl.id_empreendimento);
  if v_project is not null then
    select * into pr from public.empreendimento where id=v_project and id_empresa=p_id_empresa;
    if pr.id is null then raise exception 'Empreendimento não pertence à empresa'; end if;
  end if;
  v_mode := case when cl.tipo_negociacao in ('venda','locacao') then cl.tipo_negociacao
    when ll.tipo_negociacao in ('venda','locacao') then ll.tipo_negociacao
    when cl.id is null and ll.locacao is true then 'locacao'
    when pr.modalidade_negociacao in ('venda','locacao') then pr.modalidade_negociacao
    when pr.id is null and co.modalidade_negociacao in ('venda','locacao') then co.modalidade_negociacao
    else 'indefinido' end;
  if v_mode in ('venda','locacao') and (
    (co.modalidade_negociacao <> 'ambos' and co.modalidade_negociacao <> v_mode) or
    (pr.id is not null and pr.modalidade_negociacao <> 'ambos' and pr.modalidade_negociacao <> v_mode)
  ) then raise exception 'Intenção do lead incompatível com a empresa ou empreendimento'; end if;
  v_queue := case v_mode when 'locacao' then coalesce(pr.c2s_fila_locacao_id,co.c2s_fila_locacao_id)
    when 'venda' then coalesce(pr.c2s_fila_venda_id,co.c2s_fila_venda_id) else null end;
  return jsonb_build_object('tipo_negociacao',v_mode,'fila_id',v_queue,
    'requires_queue',co.modalidade_negociacao='ambos' or co.c2s_fila_venda_id is not null or co.c2s_fila_locacao_id is not null or pr.c2s_fila_venda_id is not null or pr.c2s_fila_locacao_id is not null,
    'id_empreendimento',v_project,'empreendimento_nome',pr.nome,
    'type_negotiation',case v_mode when 'locacao' then 'Alugar' when 'venda' then 'Comprar' else null end);
end $$;
revoke all on function public.crm_resolve_c2s_routing(bigint,bigint,bigint,bigint) from public,anon,authenticated;
grant execute on function public.crm_resolve_c2s_routing(bigint,bigint,bigint,bigint) to service_role;
