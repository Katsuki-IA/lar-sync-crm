-- Read-only regression checks using an existing Stiefelmann user's claims.
-- Roll back all session settings; no lead/conversation is modified.
begin;
select set_config('request.jwt.claim.sub', (
  select auth_user_id::text from public.crm_users
  where id_empresa = 29 and active is not false
    and auth_user_id is not null and role <> 'super_admin'
  limit 1
), true);
set local role authenticated;
do $test$
begin
  if public.crm_current_role() is null then raise exception 'Missing test user'; end if;
  if exists (
    (select * from public.crm_whatsapp_list_conversations(29)
     except select * from public.crm_whatsapp_list_conversations_v2(29))
    union all
    (select * from public.crm_whatsapp_list_conversations_v2(29)
     except select * from public.crm_whatsapp_list_conversations(29))
  ) then raise exception 'Unfiltered results changed'; end if;
  if exists (select 1 from public.crm_whatsapp_list_conversations_v2(29, p_id_empreendimento => -1))
    then raise exception 'Invalid project returned conversations'; end if;
  if exists (select 1 from public.crm_whatsapp_list_conversations_v2(29, p_id_empreendimento => (
    select id from public.empreendimento where id_empresa <> 29 limit 1
  ))) and exists (select 1 from public.empreendimento where id_empresa <> 29)
    then raise exception 'Foreign project returned conversations'; end if;
  if exists (select 1 from public.crm_whatsapp_list_conversations_v2(29, p_only_human => true, p_id_empreendimento => 58)
    where not atendimento_humano) then raise exception 'Human filter regression'; end if;
  begin
    perform * from public.crm_whatsapp_list_conversations_v2(-1);
    raise exception 'Cross-company access was allowed';
  exception when insufficient_privilege then null;
  end;
end;
$test$;
select not has_function_privilege('anon', 'public.crm_whatsapp_list_conversations_v2(bigint,text,boolean,integer,integer,bigint)', 'execute') as anonymous_denied;
rollback;
