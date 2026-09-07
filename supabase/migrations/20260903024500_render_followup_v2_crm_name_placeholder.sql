-- Render the lead's first name in the message copied to the customer's CRM.
-- {{nome}} is the canonical placeholder; {{1}} is accepted for compatibility
-- with Meta templates whose first BODY variable is the lead name.

create or replace function public.render_followup_crm_message_v2(
  p_template text,
  p_lead_nome text
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_first_name text;
begin
  if p_template is null then
    return null;
  end if;

  v_first_name := split_part(
    regexp_replace(btrim(coalesce(p_lead_nome, '')), '[[:space:]]+', ' ', 'g'),
    ' ',
    1
  );

  if nullif(v_first_name, '') is null then
    v_first_name := 'Cliente';
  else
    v_first_name := upper(left(v_first_name, 1)) || lower(substr(v_first_name, 2));
  end if;

  return replace(
    replace(
      replace(p_template, '{{nome}}', v_first_name),
      '{{ nome }}',
      v_first_name
    ),
    '{{1}}',
    v_first_name
  );
end;
$$;

revoke execute on function public.render_followup_crm_message_v2(text, text)
  from public, anon, authenticated;
grant execute on function public.render_followup_crm_message_v2(text, text)
  to service_role;

create or replace function public.render_followup_dispatch_crm_message_v2()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_lead_nome text;
begin
  if new.rendered_crm_message is null then
    return new;
  end if;

  v_lead_nome := nullif(btrim(new.context_snapshot ->> 'lead_nome'), '');

  if v_lead_nome is null then
    select l.nome
      into v_lead_nome
    from public.lead l
    where l.id = new.lead_id;
  end if;

  new.rendered_crm_message := public.render_followup_crm_message_v2(
    new.rendered_crm_message,
    v_lead_nome
  );

  return new;
end;
$$;

revoke execute on function public.render_followup_dispatch_crm_message_v2()
  from public, anon, authenticated;

drop trigger if exists render_followup_dispatch_crm_message_v2
  on public.followup_dispatches_v2;

create trigger render_followup_dispatch_crm_message_v2
before insert or update of rendered_crm_message, context_snapshot, lead_id
on public.followup_dispatches_v2
for each row
execute function public.render_followup_dispatch_crm_message_v2();

-- Render any dispatches that are still waiting in the queue. Historical rows
-- remain unchanged so they keep the exact text that was previously recorded.
update public.followup_dispatches_v2 d
set rendered_crm_message = d.rendered_crm_message
where d.status = 'queued'
  and (
    d.rendered_crm_message like '%{{nome}}%'
    or d.rendered_crm_message like '%{{ nome }}%'
    or d.rendered_crm_message like '%{{1}}%'
  );
