create index if not exists idx_crm_leads_empresa_telefone
on public.crm_leads (id_empresa, telefone);

create or replace function public.crm_ingest_meta_lead(
  p_id_empresa bigint,
  p_form_id text,
  p_lead_id_meta text,
  p_nome text,
  p_email text,
  p_telefone text,
  p_raw_data jsonb,
  p_origem text,
  p_observacoes text,
  p_id_empreendimento bigint,
  p_crm_stage_id bigint,
  p_crm_assigned_to uuid
)
returns table(created_lead_id bigint, was_inserted boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_meta_row_id uuid;
  v_lead_id bigint;
begin
  insert into public.crm_meta_leads (
    id_empresa,
    form_id,
    lead_id_meta,
    nome,
    email,
    telefone,
    raw_data
  ) values (
    p_id_empresa,
    p_form_id,
    p_lead_id_meta,
    p_nome,
    p_email,
    p_telefone,
    p_raw_data
  )
  on conflict (lead_id_meta) do nothing
  returning id into v_meta_row_id;

  if v_meta_row_id is null then
    select meta_lead.crm_lead_id
      into v_lead_id
    from public.crm_meta_leads as meta_lead
    where meta_lead.lead_id_meta = p_lead_id_meta;

    return query select v_lead_id, false;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext(p_id_empresa::text || ':' || p_telefone));

  select lead.id
    into v_lead_id
  from public.crm_leads as lead
  where lead.id_empresa = p_id_empresa
    and lead.telefone = p_telefone
  order by lead.created_at asc nulls last, lead.id asc
  limit 1
  for update;

  if v_lead_id is not null then
    update public.crm_meta_leads
    set crm_lead_id = v_lead_id
    where id = v_meta_row_id;

    update public.crm_leads
    set
      email = case
        when coalesce(trim(email), '') = '' and coalesce(trim(p_email), '') <> '' then p_email
        else email
      end,
      updated_at = now()
    where id = v_lead_id;

    insert into public.crm_lead_activities (
      lead_id,
      crm_user_id,
      tipo,
      descricao,
      metadata
    ) values (
      v_lead_id,
      null,
      'meta_resubmission',
      'Novo cadastro recebido via Meta',
      jsonb_build_object(
        'source', 'meta_webhook',
        'meta_lead_id', p_lead_id_meta,
        'form_id', p_form_id,
        'duplicate_phone', true,
        'received_empreendimento_id', p_id_empreendimento
      )
    );

    return query select v_lead_id, false;
    return;
  end if;

  insert into public.crm_leads (
    id_empresa,
    nome,
    telefone,
    email,
    id_empreendimento,
    crm_stage_id,
    crm_assigned_to,
    origem,
    observacoes
  ) values (
    p_id_empresa,
    p_nome,
    p_telefone,
    p_email,
    p_id_empreendimento,
    p_crm_stage_id,
    p_crm_assigned_to,
    p_origem,
    p_observacoes
  )
  returning id into v_lead_id;

  update public.crm_meta_leads
  set crm_lead_id = v_lead_id
  where id = v_meta_row_id;

  insert into public.crm_lead_activities (
    lead_id,
    crm_user_id,
    tipo,
    descricao,
    metadata
  ) values (
    v_lead_id,
    null,
    'system',
    'Lead recebido via integração Meta',
    jsonb_build_object(
      'source', 'meta_webhook',
      'meta_lead_id', p_lead_id_meta,
      'form_id', p_form_id,
      'duplicate_phone', false
    )
  );

  return query select v_lead_id, true;
end;
$$;

revoke all on function public.crm_ingest_meta_lead(
  bigint, text, text, text, text, text, jsonb, text, text, bigint, bigint, uuid
) from public, anon, authenticated;

grant execute on function public.crm_ingest_meta_lead(
  bigint, text, text, text, text, text, jsonb, text, text, bigint, bigint, uuid
) to service_role;
