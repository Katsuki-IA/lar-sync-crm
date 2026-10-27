-- Commercial tags are independent of crm_tags/crm_lead_tags (IA).
begin;
create table public.crm_commercial_tags (
 id bigint generated always as identity primary key,
 id_empresa bigint not null references public.empresa_dados(id),
 nome text not null check(length(trim(nome)) between 2 and 80),
 cor text not null check(cor ~ '^#[0-9a-fA-F]{6}$'),
 descricao text not null default '' check(length(descricao)<=300),
 ativo boolean not null default true,
 revision integer not null default 0,
 unique(id,id_empresa)
);
create unique index commercial_tag_name on public.crm_commercial_tags(id_empresa,lower(trim(nome)));
create table public.crm_opportunity_tags (
 opportunity_id uuid not null,
 tag_id bigint not null,
 id_empresa bigint not null,
 created_at timestamptz not null default now(),
 primary key(opportunity_id,tag_id),
 foreign key(opportunity_id,id_empresa) references public.crm_opportunities(id,id_empresa) on delete cascade,
 foreign key(tag_id,id_empresa) references public.crm_commercial_tags(id,id_empresa)
);
create index opportunity_tags_by_tag on public.crm_opportunity_tags(tag_id,id_empresa);
create index opportunity_tags_company on public.crm_opportunity_tags(id_empresa);
alter table public.crm_commercial_tags enable row level security;
alter table public.crm_opportunity_tags enable row level security;
revoke all on public.crm_commercial_tags,public.crm_opportunity_tags from public,anon,authenticated;
grant select on public.crm_commercial_tags,public.crm_opportunity_tags to authenticated;
grant all on public.crm_commercial_tags,public.crm_opportunity_tags to service_role;
revoke all on sequence public.crm_commercial_tags_id_seq from public,anon,authenticated;
grant usage,select on sequence public.crm_commercial_tags_id_seq to service_role;
create policy commercial_tags_read on public.crm_commercial_tags for select to authenticated using (
 private.hub_sales_module_enabled(id_empresa) and private.crm_can_access_empresa(id_empresa)
 and exists(select 1 from public.crm_users u where u.auth_user_id=(select auth.uid()) and u.active
 and (u.role='super_admin' or (u.id_empresa=crm_commercial_tags.id_empresa and u.role in ('manager','gestor','agent','corretor'))))
);
create policy opportunity_tags_read on public.crm_opportunity_tags for select to authenticated using (
 exists(select 1 from public.crm_opportunities o where o.id=opportunity_id and o.id_empresa=crm_opportunity_tags.id_empresa
 and private.hub_opportunity_visible(o.id_empresa,o.assigned_to))
);

create function private.hub_save_commercial_tag(p_company_id bigint,p_id bigint,p_revision integer,p_name text,p_color text,p_description text,p_active boolean)
returns bigint language plpgsql security definer set search_path='' as $$
declare t public.crm_commercial_tags; result_id bigint;
begin
 if auth.uid() is null or not private.hub_sales_manager_native(p_company_id) or not private.hub_sales_module_enabled(p_company_id) then raise exception 'Acesso restrito ao gestor' using errcode='42501';end if;
 if p_name is null or length(trim(p_name)) not between 2 and 80 or p_color is null or p_color !~ '^#[0-9a-fA-F]{6}$' or p_description is null or length(p_description)>300 or p_active is null then raise exception 'Confira nome, cor e descrição';end if;
 if p_id is null then
  insert into public.crm_commercial_tags(id_empresa,nome,cor,descricao,ativo) values(p_company_id,trim(p_name),p_color,trim(p_description),p_active) returning id into result_id;
 else
  select * into t from public.crm_commercial_tags where id=p_id and id_empresa=p_company_id for update;
  if not found then raise exception 'Tag indisponível' using errcode='42501';end if;
  if t.revision is distinct from p_revision then raise exception 'Atualize a página: tag alterada por outra sessão' using errcode='PT409';end if;
  update public.crm_commercial_tags set nome=trim(p_name),cor=p_color,descricao=trim(p_description),ativo=p_active,revision=revision+1 where id=t.id;
  result_id:=t.id;
 end if;
 return result_id;
end $$;

create function private.hub_set_opportunity_tag(p_opportunity uuid,p_tag bigint,p_applied boolean)
returns void language plpgsql security definer set search_path='' as $$
declare o public.crm_opportunities; t public.crm_commercial_tags;
begin
 if auth.uid() is null or p_applied is null then raise exception 'Acesso restrito' using errcode='42501';end if;
 -- Lock the opportunity so reassignment cannot race with a former owner's write.
 select * into o from public.crm_opportunities where id=p_opportunity for update;
 if not found or not private.hub_opportunity_visible(o.id_empresa,o.assigned_to) then raise exception 'Oportunidade indisponível' using errcode='42501';end if;
 select * into t from public.crm_commercial_tags where id=p_tag and id_empresa=o.id_empresa for share;
 if not found or (p_applied and not t.ativo) then raise exception 'Tag indisponível' using errcode='42501';end if;
 if p_applied then
  insert into public.crm_opportunity_tags(opportunity_id,tag_id,id_empresa) values(o.id,t.id,o.id_empresa) on conflict do nothing;
 else
  delete from public.crm_opportunity_tags where opportunity_id=o.id and tag_id=t.id;
 end if;
end $$;

create function public.hub_save_commercial_tag(p_company_id bigint,p_id bigint,p_revision integer,p_name text,p_color text,p_description text,p_active boolean)
returns bigint language sql security invoker set search_path='' as $$ select private.hub_save_commercial_tag(p_company_id,p_id,p_revision,p_name,p_color,p_description,p_active) $$;
create function public.hub_set_opportunity_tag(p_opportunity uuid,p_tag bigint,p_applied boolean)
returns void language sql security invoker set search_path='' as $$ select private.hub_set_opportunity_tag(p_opportunity,p_tag,p_applied) $$;
create function public.hub_commercial_tags(p_company_id bigint)
returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('uses',(select count(*) from public.crm_opportunity_tags a where a.tag_id=t.id)) order by t.nome),'[]'::jsonb)
 from public.crm_commercial_tags t where t.id_empresa=p_company_id
$$;
revoke all on function private.hub_save_commercial_tag(bigint,bigint,integer,text,text,text,boolean),private.hub_set_opportunity_tag(uuid,bigint,boolean),public.hub_save_commercial_tag(bigint,bigint,integer,text,text,text,boolean),public.hub_set_opportunity_tag(uuid,bigint,boolean),public.hub_commercial_tags(bigint) from public,anon;
grant execute on function private.hub_save_commercial_tag(bigint,bigint,integer,text,text,text,boolean),private.hub_set_opportunity_tag(uuid,bigint,boolean),public.hub_save_commercial_tag(bigint,bigint,integer,text,text,text,boolean),public.hub_set_opportunity_tag(uuid,bigint,boolean),public.hub_commercial_tags(bigint) to authenticated;

-- Client-side IA labels become read-only. Service-role automations retain their grants.
revoke insert,update,delete on public.crm_lead_tags from authenticated;
commit;
