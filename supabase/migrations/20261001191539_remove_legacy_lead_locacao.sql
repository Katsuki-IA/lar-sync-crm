-- Keep tipo_negociacao as the sole lead intent field.
-- Replace consumers before dropping the unused boolean. Preserve existing grants.
SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION public.crm_mirror_negotiation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  update public.lead set tipo_negociacao=new.tipo_negociacao
  where id_empresa=new.id_empresa and (id=new.lead_id or (
    id_crm=new.id::text and (
      wa_identity_id=new.wa_identity_id or
      public.crm_phone_match_key(numero)=public.crm_phone_match_key(new.telefone)
    )
  ));
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.crm_resolve_c2s_routing(p_id_empresa bigint, p_crm_lead_id bigint DEFAULT NULL::bigint, p_legacy_lead_id bigint DEFAULT NULL::bigint, p_id_empreendimento bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public.crm_initialize_operational_negotiation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_mode text;
begin
  select c.tipo_negociacao into v_mode from public.crm_leads c
  where c.id_empresa=new.id_empresa and (c.lead_id=new.id or (
    c.id::text=new.id_crm and (c.wa_identity_id=new.wa_identity_id or
      public.crm_phone_match_key(c.telefone)=public.crm_phone_match_key(new.numero))
  )) limit 1;
  if v_mode in ('venda','locacao') then
    new.tipo_negociacao := v_mode;
  end if;
  return new;
end $function$;

-- Preserve an explicit rental mark if one was written during the rollout.
UPDATE public.lead SET tipo_negociacao='locacao'
WHERE locacao IS TRUE AND tipo_negociacao='indefinido';

ALTER TABLE public.lead DROP COLUMN locacao;
