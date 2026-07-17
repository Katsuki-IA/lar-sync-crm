create table if not exists public.crm_prospeccao_leads (
  id bigserial primary key,
  id_empresa bigint not null references public.empresa_dados(id) on delete cascade,
  id_empreendimento bigint not null references public.empreendimento(id) on delete restrict,
  nome text not null,
  telefone text not null,
  email text,
  origem_arquivo text,
  origem_aba text,
  status text not null default 'pending' check (status in ('pending', 'processing', 'processed', 'duplicate', 'error')),
  crm_lead_id bigint references public.crm_leads(id) on delete set null,
  error text,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  processed_at timestamptz,
  check (btrim(nome) <> ''),
  check (btrim(telefone) <> '')
);

create index if not exists idx_crm_prospeccao_leads_status
on public.crm_prospeccao_leads (status, id);

create index if not exists idx_crm_prospeccao_leads_empresa_status
on public.crm_prospeccao_leads (id_empresa, status, id);

create index if not exists idx_crm_prospeccao_leads_telefone
on public.crm_prospeccao_leads (id_empresa, telefone);

alter table public.crm_prospeccao_leads enable row level security;
revoke all on public.crm_prospeccao_leads from public, anon, authenticated;
grant all on public.crm_prospeccao_leads to service_role;
grant all on sequence public.crm_prospeccao_leads_id_seq to service_role;

create or replace function public.crm_process_next_prospeccao_leads(
  p_id_empresa bigint default null,
  p_limit integer default 1
)
returns table (
  staging_id bigint,
  crm_lead_id bigint,
  action text,
  error text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  item record;
  v_ai_user_id uuid;
  v_existing_lead_id bigint;
  v_responsavel_id uuid;
  v_stage_id bigint;
  v_created_lead_id bigint;
begin
  if coalesce(p_limit, 1) < 1 then
    raise exception 'p_limit deve ser maior que zero';
  end if;

  for item in
    select prospect.*
    from public.crm_prospeccao_leads prospect
    where prospect.status = 'pending'
      and (p_id_empresa is null or prospect.id_empresa = p_id_empresa)
    order by prospect.id
    for update skip locked
    limit p_limit
  loop
    staging_id := item.id;
    crm_lead_id := null;
    action := null;
    error := null;

    update public.crm_prospeccao_leads
    set status = 'processing',
        attempts = attempts + 1,
        started_at = now(),
        error = null
    where id = item.id;

    begin
      if nullif(btrim(item.telefone), '') is null then
        raise exception 'Lead sem telefone valido';
      end if;

      perform public.crm_sync_company_global_config(item.id_empresa);
      v_ai_user_id := public.crm_get_or_create_ai_user(item.id_empresa);

      select lead.id
      into v_existing_lead_id
      from public.crm_leads lead
      where lead.id_empresa = item.id_empresa
        and (
          lead.telefone = item.telefone
          or (
            item.email is not null
            and lead.email is not null
            and lower(btrim(lead.email)) = lower(btrim(item.email))
          )
        )
      order by lead.created_at asc nulls last, lead.id asc
      limit 1;

      if v_existing_lead_id is not null then
        insert into public.crm_lead_activities (
          lead_id, crm_user_id, tipo, descricao, metadata
        ) values (
          v_existing_lead_id,
          v_ai_user_id,
          'site_form_resubmission',
          'Lead importado novamente em campanha de prospecção. Cadastro não duplicado.',
          jsonb_build_object(
            'source', 'prospeccao_csv',
            'staging_id', item.id,
            'origem_arquivo', item.origem_arquivo,
            'origem_aba', item.origem_aba,
            'id_empreendimento', item.id_empreendimento
          )
        );

        update public.crm_prospeccao_leads
        set status = 'duplicate',
            crm_lead_id = v_existing_lead_id,
            processed_at = now()
        where id = item.id;

        crm_lead_id := v_existing_lead_id;
        action := 'duplicate';
        return next;
        continue;
      end if;

      select user_row.id
      into v_responsavel_id
      from public.crm_users user_row
      where user_row.id_empresa = item.id_empresa
        and user_row.role in ('manager', 'gestor')
        and coalesce(user_row.active, true) = true
      order by user_row.created_at asc nulls last, user_row.id asc
      limit 1;

      select stage.id
      into v_stage_id
      from public.crm_stages stage
      where stage.id_empresa = item.id_empresa
        and coalesce(stage.ativo, true) = true
      order by stage.ordem asc nulls last, stage.id asc
      limit 1;

      insert into public.crm_leads (
        id_empresa,
        nome,
        telefone,
        email,
        id_empreendimento,
        crm_assigned_to,
        crm_stage_id,
        origem,
        status
      ) values (
        item.id_empresa,
        coalesce(nullif(btrim(item.nome), ''), 'Lead sem nome'),
        item.telefone,
        nullif(btrim(coalesce(item.email, '')), ''),
        item.id_empreendimento,
        v_responsavel_id,
        v_stage_id,
        'PR',
        'ativo'
      )
      returning id into v_created_lead_id;

      insert into public.crm_lead_activities (
        lead_id, crm_user_id, tipo, descricao, metadata
      ) values (
        v_created_lead_id,
        v_ai_user_id,
        'site_form',
        'Lead importado para campanha de prospecção.',
        jsonb_build_object(
          'source', 'prospeccao_csv',
          'staging_id', item.id,
          'origem_arquivo', item.origem_arquivo,
          'origem_aba', item.origem_aba,
          'id_empreendimento', item.id_empreendimento
        )
      );

      update public.crm_prospeccao_leads
      set status = 'processed',
          crm_lead_id = v_created_lead_id,
          processed_at = now()
      where id = item.id;

      crm_lead_id := v_created_lead_id;
      action := 'created';
      return next;
    exception when others then
      update public.crm_prospeccao_leads
      set status = 'error',
          error = sqlerrm,
          processed_at = now()
      where id = item.id;

      crm_lead_id := null;
      action := 'error';
      error := sqlerrm;
      return next;
    end;
  end loop;
end;
$$;

revoke all on function public.crm_process_next_prospeccao_leads(bigint, integer) from public, anon, authenticated;
grant execute on function public.crm_process_next_prospeccao_leads(bigint, integer) to service_role;
