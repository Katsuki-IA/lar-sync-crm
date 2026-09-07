-- Conversation assignments use the globally unique crm_users primary key.
-- A super_admin can legitimately have id_empresa null while working in an
-- active company, so filtering the assignee join by company hid their name.

do $migration$
declare
  v_before text;
  v_after text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.crm_whatsapp_list_conversations(bigint,text,boolean,integer,integer)'::regprocedure
  )
  into v_before;

  v_after := pg_catalog.regexp_replace(
    v_before,
    'left join public[.]crm_users u[[:space:]]+on u[.]id = c[.]wa_conversation_assigned_to[[:space:]]+and u[.]id_empresa = c[.]id_empresa',
    'left join public.crm_users u on u.id = c.wa_conversation_assigned_to'
  );

  if v_after = v_before then
    raise exception 'crm_whatsapp_list_conversations assignee join pattern not found';
  end if;

  execute v_after;
end;
$migration$;

notify pgrst, 'reload schema';
