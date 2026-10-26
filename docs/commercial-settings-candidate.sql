-- Candidato: aplicar após distribution-v3-intake.sql. Não ativa empresas.
begin;
create table private.hub_internal_crm_settings (
 id_empresa bigint primary key references public.empresa_dados(id),
 enabled boolean not null default false,
 revision integer not null default 0,
 destinations jsonb not null default '{}'::jsonb
);
alter table private.hub_internal_crm_settings enable row level security;
revoke all on private.hub_internal_crm_settings from public,anon,authenticated,service_role;

create function private.hub_commercial_config(p_company_id bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cfg jsonb;
begin
 if not private.hub_sales_manager_native(p_company_id) then raise exception 'Acesso restrito' using errcode='42501';end if;
 select to_jsonb(s) into cfg from private.hub_internal_crm_settings s where id_empresa=p_company_id;
 return jsonb_build_object('settings',coalesce(cfg,jsonb_build_object('enabled',false,'revision',0,'destinations','{}'::jsonb)),
 'funnels',coalesce((select jsonb_agg(to_jsonb(f) order by f.ordem,f.id) from public.crm_funnels f where f.id_empresa=p_company_id and f.module='crm'),'[]'::jsonb),
 'stages',coalesce((select jsonb_agg(to_jsonb(s) order by s.ordem,s.id) from public.crm_stages s where s.id_empresa=p_company_id and s.module='crm'),'[]'::jsonb));
end $$;

create function private.hub_save_commercial_definition(p_company_id bigint,p_kind text,p_id bigint,p_revision integer,p_data jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid; old jsonb; nm text; pos integer; enabled boolean; fid bigint; replacement bigint; result jsonb; new_id bigint;
begin
 if not private.hub_sales_manager_native(p_company_id) then raise exception 'Acesso restrito' using errcode='42501';end if;
 if not private.hub_sales_module_enabled(p_company_id) then raise exception 'CRM desativado';end if;
 if p_kind not in ('funnel','stage') or p_kind is null then raise exception 'Tipo inválido';end if;
 perform pg_advisory_xact_lock(hashtextextended('hub-commercial:'||p_company_id,0));
 actor:=private.hub_sales_actor_id();
 nm:=trim(p_data->>'nome');pos:=(p_data->>'ordem')::integer;enabled:=(p_data->>'ativo')::boolean;
 if nm is null or length(nm) not between 2 and 120 or pos is null or pos not between 0 and 10000 or enabled is null then raise exception 'Confira nome, posição e situação';end if;
 if p_kind='funnel' then
  select to_jsonb(f) into old from public.crm_funnels f where id=p_id and id_empresa=p_company_id and module='crm' for update;
 else
  select to_jsonb(s) into old from public.crm_stages s where id=p_id and id_empresa=p_company_id and module='crm' for update;
 end if;
 if p_id is not null and old is null then raise exception 'Configuração indisponível' using errcode='42501';end if;
 if old is not null and (old->>'hub_revision')::integer is distinct from p_revision then raise exception 'Atualize a página: configuração alterada por outra sessão' using errcode='PT409';end if;
 if p_kind='funnel' then
  if not enabled and (exists(select 1 from private.hub_internal_crm_settings s cross join lateral jsonb_each(s.destinations) d where s.id_empresa=p_company_id and (d.value->>'funnel_id')::bigint=p_id) or exists(select 1 from public.crm_opportunities where funnel_id=p_id) or exists(select 1 from public.hub_sales_queues where destination_funnel_id=p_id)) then raise exception 'Funil em uso. Realoque oportunidades, destinos e filas antes de desativar';end if;
  if p_id is null then
   insert into public.crm_funnels(id_empresa,nome,module,ordem,ativo) values(p_company_id,nm,'crm',pos,enabled) returning id into new_id;
  else
   update public.crm_funnels set nome=nm,ordem=pos,ativo=enabled,hub_revision=hub_revision+1 where id=p_id;new_id:=p_id;
  end if;
  if not enabled then update public.crm_stages set ativo=false,hub_revision=hub_revision+1 where id_funnel=new_id and id_empresa=p_company_id and module='crm' and ativo;end if;
  select to_jsonb(f) into result from public.crm_funnels f where id=new_id;
 else
  fid:=(p_data->>'id_funnel')::bigint;replacement:=nullif(p_data->>'replacement_id','')::bigint;
  if not exists(select 1 from public.crm_funnels where id=fid and id_empresa=p_company_id and module='crm' and ativo) then raise exception 'Selecione um funil comercial ativo';end if;
  if old is not null and fid is distinct from (old->>'id_funnel')::bigint then raise exception 'Não é permitido mover etapas entre funis';end if;
  if coalesce(p_data->>'cor','') !~ '^#[0-9a-fA-F]{6}$' then raise exception 'Cor inválida';end if;
  if not enabled and p_id is not null then
   if not exists(select 1 from public.crm_stages where id_funnel=fid and ativo and id<>p_id) then raise exception 'Mantenha ao menos uma etapa ativa no funil';end if;
   if replacement is not null and not exists(select 1 from public.crm_stages where id=replacement and id<>p_id and id_funnel=fid and id_empresa=p_company_id and module='crm' and ativo) then raise exception 'Substituta deve ser uma etapa ativa do mesmo funil';end if;
   if exists(select 1 from public.crm_opportunities where stage_id=p_id) or exists(select 1 from private.hub_internal_crm_settings s cross join lateral jsonb_each(s.destinations) d where s.id_empresa=p_company_id and (d.value->>'stage_id')::bigint=p_id) then
    if replacement is null then raise exception 'Etapa em uso: escolha a substituta para oportunidades e regras de entrada';end if;
    insert into public.crm_opportunity_events(opportunity_id,id_empresa,actor_id,kind,from_stage_id,to_stage_id)
     select id,id_empresa,actor,'stage_changed',stage_id,replacement from public.crm_opportunities where stage_id=p_id and id_empresa=p_company_id;
    update public.crm_opportunities set stage_id=replacement,version=version+1,updated_at=now() where stage_id=p_id and id_empresa=p_company_id;
    update private.hub_internal_crm_settings s set destinations=coalesce((select jsonb_object_agg(d.key,case when (d.value->>'stage_id')::bigint=p_id then jsonb_set(d.value,'{stage_id}',to_jsonb(replacement)) else d.value end) from jsonb_each(s.destinations) d),'{}'::jsonb),revision=revision+1 where s.id_empresa=p_company_id;
   end if;
  end if;
  if p_id is null then
   insert into public.crm_stages(id_empresa,id_funnel,nome,module,cor,ordem,ativo) values(p_company_id,fid,nm,'crm',p_data->>'cor',pos,enabled) returning id into new_id;
  else
   update public.crm_stages set nome=nm,cor=p_data->>'cor',ordem=pos,ativo=enabled,hub_revision=hub_revision+1 where id=p_id;new_id:=p_id;
  end if;
  select to_jsonb(s) into result from public.crm_stages s where id=new_id;
 end if;
 insert into private.hub_configuration_audit(id_empresa,actor_id,kind,record_id,before_data,after_data) values(p_company_id,actor,'crm_'||p_kind,new_id,old,result);
end $$;

create function private.hub_save_internal_crm(p_company_id bigint,p_revision integer,p_enabled boolean,p_destinations jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare r record; prev private.hub_internal_crm_settings;
begin
 if not exists(select 1 from public.crm_users where auth_user_id=auth.uid() and active and role='super_admin') then raise exception 'Somente super admin pode alterar o destino' using errcode='42501';end if;
 if not private.hub_sales_module_enabled(p_company_id) then raise exception 'CRM desativado';end if;
 perform pg_advisory_xact_lock(hashtextextended('hub-commercial:'||p_company_id,0));
 if p_enabled is null or jsonb_typeof(p_destinations) is distinct from 'object' then raise exception 'Configuração inválida';end if;
 select * into prev from private.hub_internal_crm_settings where id_empresa=p_company_id for update;
 if coalesce(prev.revision,0) is distinct from p_revision then raise exception 'Atualize a configuração' using errcode='PT409';end if;
 for r in select * from jsonb_each(p_destinations) loop
  if r.key not in ('unqualified','qualified','visit','lost','without_whatsapp','blocked_send') or jsonb_typeof(r.value)<>'object' then raise exception 'Situação inválida';end if;
  if not exists(select 1 from public.crm_stages s join public.crm_funnels f on f.id=s.id_funnel where s.id=(r.value->>'stage_id')::bigint and f.id=(r.value->>'funnel_id')::bigint and s.id_empresa=p_company_id and f.id_empresa=p_company_id and s.module='crm' and f.module='crm' and s.ativo and f.ativo) then raise exception 'Destino deve ser uma etapa comercial ativa da empresa';end if;
 end loop;
 if p_enabled and not p_destinations ? 'unqualified' then raise exception 'Configure a entrada padrão (Não qualificado)';end if;
 -- Não mudar silenciosamente outra integração externa.
 if p_enabled and not exists(select 1 from public.empresa_dados where id=p_company_id and default_crm in ('katsuki','katsuki_crm')) then raise exception 'Selecione Katsuki como destino antes da ativação interna';end if;
 insert into private.hub_internal_crm_settings(id_empresa,enabled,revision,destinations) values(p_company_id,p_enabled,1,p_destinations)
 on conflict(id_empresa) do update set enabled=excluded.enabled,revision=hub_internal_crm_settings.revision+1,destinations=excluded.destinations;
 insert into private.hub_configuration_audit(id_empresa,actor_id,kind,record_id,before_data,after_data) values(p_company_id,private.hub_sales_actor_id(),'crm_destination',p_company_id,to_jsonb(prev),jsonb_build_object('enabled',p_enabled,'destinations',p_destinations));
end $$;

create function public.hub_commercial_config(p_company_id bigint) returns jsonb language sql security invoker set search_path='' as $$select private.hub_commercial_config(p_company_id)$$;
create function public.hub_save_commercial_definition(p_company_id bigint,p_kind text,p_id bigint,p_revision integer,p_data jsonb) returns void language sql security invoker set search_path='' as $$select private.hub_save_commercial_definition(p_company_id,p_kind,p_id,p_revision,p_data)$$;
create function public.hub_save_internal_crm(p_company_id bigint,p_revision integer,p_enabled boolean,p_destinations jsonb) returns void language sql security invoker set search_path='' as $$select private.hub_save_internal_crm(p_company_id,p_revision,p_enabled,p_destinations)$$;
revoke all on function private.hub_commercial_config(bigint),public.hub_commercial_config(bigint),private.hub_save_commercial_definition(bigint,text,bigint,integer,jsonb),public.hub_save_commercial_definition(bigint,text,bigint,integer,jsonb),private.hub_save_internal_crm(bigint,integer,boolean,jsonb),public.hub_save_internal_crm(bigint,integer,boolean,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.hub_commercial_config(bigint),public.hub_commercial_config(bigint),private.hub_save_commercial_definition(bigint,text,bigint,integer,jsonb),public.hub_save_commercial_definition(bigint,text,bigint,integer,jsonb),private.hub_save_internal_crm(bigint,integer,boolean,jsonb),public.hub_save_internal_crm(bigint,integer,boolean,jsonb) to authenticated;
-- Mesmo ponto de entrada autenticado do envio externo; sem HTTP entre CRMs.
create function private.hub_dispatch_internal_crm(p_company_id bigint,p_lead_id bigint,p_kind text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg private.hub_internal_crm_settings;l public.crm_leads;dest jsonb;state text;stage_name text;op public.crm_opportunities;created boolean;
begin
 perform pg_advisory_xact_lock(hashtextextended('hub-commercial:'||p_company_id,0));
 select * into cfg from private.hub_internal_crm_settings where id_empresa=p_company_id;
 if not coalesce(cfg.enabled,false) then return jsonb_build_object('handled',false);end if;
 if not private.hub_sales_module_enabled(p_company_id) then raise exception 'CRM desativado';end if;
 if not exists(select 1 from public.empresa_dados where id=p_company_id and default_crm in ('katsuki','katsuki_crm')) then raise exception 'Destino externo alterado: revise a configuração interna';end if;
 select * into l from public.crm_leads where id=p_lead_id and id_empresa=p_company_id for update;
 if not found then raise exception 'Lead indisponível';end if;
 select nome into stage_name from public.crm_stages where id=l.crm_stage_id and id_empresa=p_company_id and module='ia';
 state:=case
  when lower(coalesce(stage_name,''))='bloqueio envio' or p_kind in ('blocked_send','blocked','meta_blocked','bloqueio_envio') then 'blocked_send'
  when p_kind='without_whatsapp' then 'without_whatsapp'
  when stage_name='Perdido' or p_kind in ('lost','perdido') then 'lost'
  when stage_name='Visita Agendada' then 'visit'
  when l.qualificado=1 or exists(select 1 from public.crm_lead_tags lt join public.crm_tags t on t.id=lt.tag_id where lt.lead_id=l.id and t.id_empresa=p_company_id and lower(trim(t.nome))='qualificado') then 'qualified'
  else 'unqualified' end;
 dest:=coalesce(cfg.destinations->state,cfg.destinations->'unqualified');
 if not exists(select 1 from public.crm_stages s join public.crm_funnels f on f.id=s.id_funnel where s.id=(dest->>'stage_id')::bigint and f.id=(dest->>'funnel_id')::bigint and s.id_empresa=p_company_id and f.id_empresa=p_company_id and s.module='crm' and f.module='crm' and s.ativo and f.ativo) then raise exception 'Destino interno inválido. Nenhum envio externo foi realizado';end if;
 insert into public.crm_opportunities(id_empresa,lead_id,funnel_id,stage_id,title,request_id,creation_origin,created_by)
 values(p_company_id,l.id,(dest->>'funnel_id')::bigint,(dest->>'stage_id')::bigint,left(l.nome,200),gen_random_uuid(),'queue',null)
 on conflict(id_empresa,lead_id,funnel_id) do nothing returning * into op;
 created:=found;
 if created then
  insert into public.crm_opportunity_events(opportunity_id,id_empresa,actor_id,kind,to_stage_id) values(op.id,p_company_id,null,'created',op.stage_id);
 else
  select * into op from public.crm_opportunities where id_empresa=p_company_id and lead_id=l.id and funnel_id=(dest->>'funnel_id')::bigint;
 end if;
 delete from private.hub_queue_intake where lead_id=l.id and id_empresa=p_company_id;
 return jsonb_build_object('handled',true,'ok',true,'provider','katsuki_internal','opportunity_id',op.id,'created',created,'situation',state);
end $$;
create function public.hub_dispatch_internal_crm(p_company_id bigint,p_lead_id bigint,p_kind text default null) returns jsonb language sql security invoker set search_path='' as $$select private.hub_dispatch_internal_crm(p_company_id,p_lead_id,p_kind)$$;
revoke all on function private.hub_dispatch_internal_crm(bigint,bigint,text),public.hub_dispatch_internal_crm(bigint,bigint,text) from public,anon,authenticated,service_role;
grant execute on function private.hub_dispatch_internal_crm(bigint,bigint,text),public.hub_dispatch_internal_crm(bigint,bigint,text) to service_role;
create or replace function private.hub_process_queue_intake(p_limit integer default 100) returns integer
language plpgsql security definer set search_path='' as $$
declare w record;q public.hub_sales_queues;l public.crm_leads;first_stage bigint;op public.crm_opportunities;n integer:=0;
begin
 if p_limit is null or p_limit not between 1 and 1000 then raise exception 'Lote inválido';end if;
 for w in select i.* from private.hub_queue_intake i join public.hub_company_modules cm on cm.id_empresa=i.id_empresa and cm.crm
  where not exists(select 1 from private.hub_internal_crm_settings cfg where cfg.id_empresa=i.id_empresa and cfg.enabled) and i.next_attempt_at<=clock_timestamp() order by i.next_attempt_at,i.lead_id limit p_limit loop
  begin
   if not pg_try_advisory_xact_lock(hashtextextended('hub-commercial:'||w.id_empresa,0)) then continue;end if;
   if exists(select 1 from private.hub_internal_crm_settings where id_empresa=w.id_empresa and enabled) then continue;end if;
   perform 1 from public.hub_company_modules where id_empresa=w.id_empresa and crm for share skip locked;
   if not found then continue;end if;
   select sq.* into q from public.hub_sales_queues sq join public.crm_leads cl on cl.id=w.lead_id and cl.id_empresa=sq.id_empresa
    join public.crm_funnels f on f.id=sq.destination_funnel_id and f.id_empresa=sq.id_empresa and f.module='crm' and f.ativo
    where sq.id_empresa=w.id_empresa and sq.active
    and (sq.development_id is null or sq.development_id=cl.id_empreendimento)
    and ((sq.trigger_qualified and cl.qualificado=1) or cl.crm_stage_id=any(sq.trigger_stage_ids))
    order by (sq.development_id is not null) desc,sq.priority,sq.id for update of sq skip locked limit 1;
   if not found then
    update private.hub_queue_intake set reason='no_matching_queue',next_attempt_at=clock_timestamp()+interval '1 minute' where lead_id=w.lead_id;
    continue;
   end if;
   -- Serialize concurrent lead edits and duplicate opportunity creation.
   select * into l from public.crm_leads where id=w.lead_id and id_empresa=w.id_empresa for update skip locked;
   if not found then continue;end if;
   if not ((q.development_id is null or q.development_id=l.id_empreendimento)
     and ((q.trigger_qualified and l.qualificado=1) or l.crm_stage_id=any(q.trigger_stage_ids))) then continue;end if;
   select id into first_stage from public.crm_stages where id_empresa=w.id_empresa and id_funnel=q.destination_funnel_id and module='crm' and ativo order by ordem,id limit 1;
   if first_stage is null then
    update private.hub_queue_intake set reason='no_active_stage',next_attempt_at=clock_timestamp()+interval '5 minutes' where lead_id=w.lead_id;continue;
   end if;
   insert into public.crm_opportunities(id_empresa,lead_id,funnel_id,stage_id,title,request_id,creation_origin,created_by)
    values(w.id_empresa,l.id,q.destination_funnel_id,first_stage,left(l.nome,200),gen_random_uuid(),'queue',null)
    on conflict(id_empresa,lead_id,funnel_id) do nothing returning * into op;
   if found then
    insert into public.crm_opportunity_events(opportunity_id,id_empresa,actor_id,kind,to_stage_id)
     values(op.id,w.id_empresa,null,'created',first_stage);
    n:=n+1;
   end if;
   -- Existing opportunities, including assigned ones, are never reassigned or reopened.
   delete from private.hub_queue_intake where lead_id=w.lead_id;
  exception when others then
   update private.hub_queue_intake set reason='processing_error',next_attempt_at=clock_timestamp()+interval '5 minutes' where lead_id=w.lead_id;
  end;
 end loop;
 return n;
end $$;

commit;

