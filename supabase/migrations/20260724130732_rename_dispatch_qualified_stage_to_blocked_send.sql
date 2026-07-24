-- Renomeia o ID externo antes chamado de Qualificado para Bloqueio Envio.
-- Preserva os valores configurados por empresa e por empreendimento.

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'crm_lead_dispatch_settings'
      and column_name = 'external_stage_qualified_id'
  ) then
    if not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'crm_lead_dispatch_settings'
        and column_name = 'external_stage_blocked_send_id'
    ) then
      alter table public.crm_lead_dispatch_settings
        rename column external_stage_qualified_id to external_stage_blocked_send_id;
    else
      update public.crm_lead_dispatch_settings
      set external_stage_blocked_send_id = coalesce(
        external_stage_blocked_send_id,
        external_stage_qualified_id
      )
      where external_stage_blocked_send_id is null
        and external_stage_qualified_id is not null;

      alter table public.crm_lead_dispatch_settings
        drop column external_stage_qualified_id;
    end if;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'crm_lead_dispatch_stage_overrides'
      and column_name = 'external_stage_qualified_id'
  ) then
    if not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'crm_lead_dispatch_stage_overrides'
        and column_name = 'external_stage_blocked_send_id'
    ) then
      alter table public.crm_lead_dispatch_stage_overrides
        rename column external_stage_qualified_id to external_stage_blocked_send_id;
    else
      update public.crm_lead_dispatch_stage_overrides
      set external_stage_blocked_send_id = coalesce(
        external_stage_blocked_send_id,
        external_stage_qualified_id
      )
      where external_stage_blocked_send_id is null
        and external_stage_qualified_id is not null;

      alter table public.crm_lead_dispatch_stage_overrides
        drop column external_stage_qualified_id;
    end if;
  end if;
end;
$$;
