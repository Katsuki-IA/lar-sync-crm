-- Registra o inicio do atendimento humano para permitir a liberacao automatica da IA.

alter table public.lead
  add column if not exists atendimento_humano_desde timestamptz;

comment on column public.lead.atendimento_humano_desde is
  'Data de inicio do atendimento humano mais recente. Usada para liberar a IA apos o prazo configurado.';

update public.lead
set atendimento_humano_desde = coalesce(updated_at, created_at, now())
where coalesce(atendimento_humano, false) = true
  and atendimento_humano_desde is null;

create index if not exists lead_atendimento_humano_expiracao_idx
  on public.lead (atendimento_humano_desde)
  where atendimento_humano = true;

create or replace function public.crm_pause_ai_attendance(p_lead_id bigint)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor public.crm_users%rowtype;
  v_lead public.crm_leads%rowtype;
  v_updated integer;
begin
  select * into v_actor
  from public.crm_users
  where auth_user_id = auth.uid()
    and coalesce(active, true) = true
  limit 1;

  if v_actor.id is null or v_actor.role not in ('super_admin', 'manager') then
    raise exception 'Sem permissao para pausar o atendimento da IA';
  end if;

  select * into v_lead
  from public.crm_leads
  where id = p_lead_id;

  if v_lead.id is null then
    raise exception 'Lead nao encontrado';
  end if;

  if v_actor.role <> 'super_admin' and v_actor.id_empresa is distinct from v_lead.id_empresa then
    raise exception 'Lead nao pertence a empresa do gestor';
  end if;

  update public.lead
  set status = 'Atendimento Humano',
      atendimento_humano = true,
      atendimento_humano_desde = now(),
      updated_at = now()
  where id_crm::text = p_lead_id::text
    and id_empresa = v_lead.id_empresa;

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'Nenhum atendimento da IA foi encontrado para este lead';
  end if;

  insert into public.crm_lead_activities (
    lead_id, crm_user_id, tipo, descricao, metadata
  ) values (
    p_lead_id,
    v_actor.id,
    'whatsapp_automation',
    '[AUTOMAÇÃO WHATSAPP]' || chr(10) || chr(10) ||
      'Atendimento da IA pausado.' || chr(10) ||
      'Envio de follow-ups para este lead interrompido.',
    jsonb_build_object('source', 'hub', 'event', 'ai_attendance_paused')
  );
end;
$$;

revoke all on function public.crm_pause_ai_attendance(bigint) from public;
revoke all on function public.crm_pause_ai_attendance(bigint) from anon;
grant execute on function public.crm_pause_ai_attendance(bigint) to authenticated;
grant execute on function public.crm_pause_ai_attendance(bigint) to service_role;
