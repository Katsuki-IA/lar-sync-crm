-- Configuracao global de funil, etapas e tags.
-- Os registros operacionais continuam por empresa para preservar IDs, RLS e integracoes.

create table if not exists public.crm_global_funnel (
  id smallint primary key default 1 check (id = 1),
  nome text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.crm_global_stages (
  id bigserial primary key,
  nome text not null,
  cor text not null default '#C14F21',
  ordem integer not null,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ordem)
);

create table if not exists public.crm_global_tags (
  id bigserial primary key,
  nome text not null,
  cor text not null default '#C14F21',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists crm_global_tags_nome_key
  on public.crm_global_tags (lower(btrim(nome)));

alter table public.crm_funnels
  add column if not exists global_funnel_id smallint references public.crm_global_funnel(id);
alter table public.crm_stages
  add column if not exists global_stage_id bigint references public.crm_global_stages(id);
alter table public.crm_tags
  add column if not exists global_tag_id bigint references public.crm_global_tags(id);

create unique index if not exists crm_stages_empresa_global_key
  on public.crm_stages (id_empresa, global_stage_id)
  where global_stage_id is not null;
create unique index if not exists crm_tags_empresa_global_key
  on public.crm_tags (id_empresa, global_tag_id)
  where global_tag_id is not null;

insert into public.crm_global_funnel (id, nome)
select 1, coalesce((
  select f.nome
  from public.crm_funnels f
  where f.is_default = true
  order by (select count(*) from public.crm_stages s where s.id_funnel = f.id) desc, f.id
  limit 1
), 'Funil padrão')
on conflict (id) do nothing;

do $$
declare
  canonical_funnel_id bigint;
begin
  select f.id into canonical_funnel_id
  from public.crm_funnels f
  where f.is_default = true
  order by (select count(*) from public.crm_stages s where s.id_funnel = f.id) desc, f.id
  limit 1;

  if not exists (select 1 from public.crm_global_stages) then
    if canonical_funnel_id is not null and exists (
      select 1 from public.crm_stages where id_funnel = canonical_funnel_id
    ) then
      insert into public.crm_global_stages (nome, cor, ordem, ativo)
      select s.nome, coalesce(s.cor, '#C14F21'), row_number() over (order by s.ordem, s.id), coalesce(s.ativo, true)
      from public.crm_stages s
      where s.id_funnel = canonical_funnel_id
      order by s.ordem, s.id;
    else
      insert into public.crm_global_stages (nome, cor, ordem) values
        ('Base', '#F28B66', 1),
        ('Contato feito', '#B7860B', 2),
        ('Em atendimento', '#268BD2', 3),
        ('Visita agendada', '#8B5CF6', 4),
        ('Visita realizada', '#06B6D4', 5),
        ('Atendimento Corretor', '#F97316', 6),
        ('Perdido', '#EF4444', 7);
    end if;
  end if;
end $$;

insert into public.crm_global_tags (nome, cor)
select distinct on (lower(btrim(t.nome))) t.nome, coalesce(t.cor, '#C14F21')
from public.crm_tags t
where nullif(btrim(t.nome), '') is not null
order by lower(btrim(t.nome)), t.id
on conflict do nothing;

insert into public.crm_global_tags (nome, cor) values
  ('Atendimento IA', '#F97316'),
  ('Bloqueio IA', '#EF4444'),
  ('Cliente Respondeu', '#22C55E'),
  ('Visita Agendada IA', '#8B5CF6'),
  ('FUP1', '#0EA5E9'),
  ('FUP2', '#0284C7'),
  ('FUP3', '#2563EB'),
  ('FUP4', '#1D4ED8'),
  ('Qualificado', '#16A34A'),
  ('Desqualificado', '#DC2626'),
  ('Perdido', '#991B1B'),
  ('Sem Whatsapp', '#64748B')
on conflict do nothing;

create or replace function public.crm_assert_super_admin()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.crm_get_my_role() <> 'super_admin' then
    raise exception 'Apenas o superadmin pode alterar a configuração global do CRM';
  end if;
end;
$$;

create or replace function public.crm_sync_company_global_config(p_id_empresa bigint)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_funnel_id bigint;
  v_stage record;
  v_tag record;
  v_local_id bigint;
  v_fallback_stage_id bigint;
  v_funnel_name text;
begin
  if p_id_empresa is null then return; end if;

  select nome into v_funnel_name from public.crm_global_funnel where id = 1;

  select id into v_funnel_id
  from public.crm_funnels
  where id_empresa = p_id_empresa and is_default = true
  order by id
  limit 1;

  if v_funnel_id is null then
    insert into public.crm_funnels (id_empresa, nome, is_default, ativo, ordem, global_funnel_id)
    values (p_id_empresa, coalesce(v_funnel_name, 'Funil padrão'), true, true, 1, 1)
    returning id into v_funnel_id;
  else
    update public.crm_funnels
    set nome = coalesce(v_funnel_name, nome), ativo = true, ordem = 1, global_funnel_id = 1
    where id = v_funnel_id;
  end if;

  update public.crm_funnels
  set ativo = false, is_default = false
  where id_empresa = p_id_empresa and id <> v_funnel_id;

  for v_stage in
    select * from public.crm_global_stages order by ordem, id
  loop
    select id into v_local_id
    from public.crm_stages
    where id_empresa = p_id_empresa and global_stage_id = v_stage.id
    limit 1;

    if v_local_id is null then
      select id into v_local_id
      from public.crm_stages
      where id_empresa = p_id_empresa
        and id_funnel = v_funnel_id
        and global_stage_id is null
        and lower(btrim(nome)) = lower(btrim(v_stage.nome))
      order by id
      limit 1;
    end if;

    if v_local_id is null then
      insert into public.crm_stages (id_empresa, id_funnel, nome, cor, ordem, ativo, global_stage_id)
      values (p_id_empresa, v_funnel_id, v_stage.nome, v_stage.cor, v_stage.ordem, v_stage.ativo, v_stage.id);
    else
      update public.crm_stages
      set id_funnel = v_funnel_id,
          nome = v_stage.nome,
          cor = v_stage.cor,
          ordem = v_stage.ordem,
          ativo = v_stage.ativo,
          global_stage_id = v_stage.id
      where id = v_local_id;
    end if;
  end loop;

  update public.crm_stages
  set ativo = false
  where id_empresa = p_id_empresa and global_stage_id is null;

  select s.id into v_fallback_stage_id
  from public.crm_stages s
  join public.crm_global_stages g on g.id = s.global_stage_id
  where s.id_empresa = p_id_empresa
  order by g.ordem, g.id
  limit 1;

  update public.crm_leads l
  set crm_stage_id = v_fallback_stage_id, updated_at = now()
  where l.id_empresa = p_id_empresa
    and l.crm_stage_id in (
      select s.id from public.crm_stages s
      where s.id_empresa = p_id_empresa and s.global_stage_id is null
    );

  update public.lead l
  set crm_stage_id = v_fallback_stage_id
  where l.id_empresa = p_id_empresa
    and l.crm_stage_id in (
      select s.id from public.crm_stages s
      where s.id_empresa = p_id_empresa and s.global_stage_id is null
    );

  update public.crm_meta_forms set id_funnel = v_funnel_id where id_empresa = p_id_empresa;
  update public.crm_rd_connections set default_id_funnel = v_funnel_id where id_empresa = p_id_empresa;
  update public.crm_rd_source_mappings set id_funnel = v_funnel_id where id_empresa = p_id_empresa;
  update public.crm_rd_events set id_funnel = v_funnel_id where id_empresa = p_id_empresa;

  for v_tag in select * from public.crm_global_tags order by id loop
    select id into v_local_id
    from public.crm_tags
    where id_empresa = p_id_empresa and global_tag_id = v_tag.id
    limit 1;

    if v_local_id is null then
      select id into v_local_id
      from public.crm_tags
      where id_empresa = p_id_empresa
        and global_tag_id is null
        and lower(btrim(nome)) = lower(btrim(v_tag.nome))
      order by id
      limit 1;
    end if;

    if v_local_id is null then
      insert into public.crm_tags (id_empresa, nome, cor, global_tag_id)
      values (p_id_empresa, v_tag.nome, v_tag.cor, v_tag.id);
    else
      update public.crm_tags
      set nome = v_tag.nome, cor = v_tag.cor, global_tag_id = v_tag.id
      where id = v_local_id;
    end if;
  end loop;
end;
$$;

do $$
declare company record;
begin
  for company in
    select distinct id_empresa from (
      select id_empresa from public.crm_users where id_empresa is not null
      union
      select id_empresa from public.credentials where id_empresa is not null and default_crm = 'hub'
    ) companies
  loop
    perform public.crm_sync_company_global_config(company.id_empresa);
  end loop;
end $$;

create or replace function public.crm_global_funnel_rename(p_nome text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.crm_assert_super_admin();
  if nullif(btrim(p_nome), '') is null then raise exception 'Informe o nome do funil'; end if;
  update public.crm_global_funnel set nome = btrim(p_nome), updated_at = now() where id = 1;
  update public.crm_funnels set nome = btrim(p_nome) where global_funnel_id = 1;
end;
$$;

create or replace function public.crm_global_stage_create(p_nome text)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id bigint; company record;
begin
  perform public.crm_assert_super_admin();
  if nullif(btrim(p_nome), '') is null then raise exception 'Informe o nome da etapa'; end if;
  insert into public.crm_global_stages (nome, ordem)
  values (btrim(p_nome), coalesce((select max(ordem) + 1 from public.crm_global_stages), 1))
  returning id into v_id;
  for company in select distinct id_empresa from public.crm_funnels where id_empresa is not null loop
    perform public.crm_sync_company_global_config(company.id_empresa);
  end loop;
  return v_id;
end;
$$;

create or replace function public.crm_global_stage_update(p_id bigint, p_nome text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.crm_assert_super_admin();
  if nullif(btrim(p_nome), '') is null then raise exception 'Informe o nome da etapa'; end if;
  update public.crm_global_stages set nome = btrim(p_nome), updated_at = now() where id = p_id;
  if not found then raise exception 'Etapa global não encontrada'; end if;
  update public.crm_stages set nome = btrim(p_nome) where global_stage_id = p_id;
end;
$$;

create or replace function public.crm_global_stages_reorder(p_ids bigint[])
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id bigint; v_order integer := 0;
begin
  perform public.crm_assert_super_admin();
  if coalesce(array_length(p_ids, 1), 0) <> (select count(*) from public.crm_global_stages) then
    raise exception 'A lista de etapas está incompleta';
  end if;
  foreach v_id in array p_ids loop
    v_order := v_order + 1;
    update public.crm_global_stages set ordem = -v_order, updated_at = now() where id = v_id;
    if not found then raise exception 'Etapa global inválida'; end if;
  end loop;
  update public.crm_global_stages set ordem = -ordem where ordem < 0;
  update public.crm_stages s set ordem = g.ordem
  from public.crm_global_stages g where s.global_stage_id = g.id;
end;
$$;

create or replace function public.crm_global_stage_delete(p_id bigint)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_fallback_global_id bigint; local_stage record; v_fallback_local_id bigint;
begin
  perform public.crm_assert_super_admin();
  if (select count(*) from public.crm_global_stages) <= 1 then
    raise exception 'O funil precisa ter ao menos uma etapa';
  end if;
  select id into v_fallback_global_id from public.crm_global_stages where id <> p_id order by ordem, id limit 1;
  for local_stage in select id, id_empresa from public.crm_stages where global_stage_id = p_id loop
    select id into v_fallback_local_id from public.crm_stages
    where id_empresa = local_stage.id_empresa and global_stage_id = v_fallback_global_id limit 1;
    update public.crm_leads set crm_stage_id = v_fallback_local_id where crm_stage_id = local_stage.id;
    update public.lead set crm_stage_id = v_fallback_local_id where crm_stage_id = local_stage.id;
    delete from public.crm_stages where id = local_stage.id;
  end loop;
  delete from public.crm_global_stages where id = p_id;
  if not found then raise exception 'Etapa global não encontrada'; end if;
  with ordered as (
    select id, row_number() over (order by ordem, id)::integer as nova_ordem from public.crm_global_stages
  )
  update public.crm_global_stages g set ordem = ordered.nova_ordem from ordered where g.id = ordered.id;
  update public.crm_stages s set ordem = g.ordem from public.crm_global_stages g where s.global_stage_id = g.id;
end;
$$;

create or replace function public.crm_global_tag_create(p_nome text, p_cor text default '#C14F21')
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id bigint; company record;
begin
  perform public.crm_assert_super_admin();
  if nullif(btrim(p_nome), '') is null then raise exception 'Informe o nome da tag'; end if;
  insert into public.crm_global_tags (nome, cor) values (btrim(p_nome), coalesce(nullif(p_cor, ''), '#C14F21')) returning id into v_id;
  for company in select distinct id_empresa from public.crm_funnels where id_empresa is not null loop
    perform public.crm_sync_company_global_config(company.id_empresa);
  end loop;
  return v_id;
end;
$$;

create or replace function public.crm_global_tag_update(p_id bigint, p_nome text, p_cor text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.crm_assert_super_admin();
  if nullif(btrim(p_nome), '') is null then raise exception 'Informe o nome da tag'; end if;
  update public.crm_global_tags set nome = btrim(p_nome), cor = coalesce(nullif(p_cor, ''), '#C14F21'), updated_at = now() where id = p_id;
  if not found then raise exception 'Tag global não encontrada'; end if;
  update public.crm_tags set nome = btrim(p_nome), cor = coalesce(nullif(p_cor, ''), '#C14F21') where global_tag_id = p_id;
end;
$$;

create or replace function public.crm_global_tag_delete(p_id bigint)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.crm_assert_super_admin();
  delete from public.crm_lead_tags where tag_id in (select id from public.crm_tags where global_tag_id = p_id);
  delete from public.crm_tags where global_tag_id = p_id;
  delete from public.crm_global_tags where id = p_id;
  if not found then raise exception 'Tag global não encontrada'; end if;
end;
$$;

create or replace function public.crm_seed_default_stages(p_id_empresa bigint)
returns void language sql security definer set search_path = public, pg_temp as $$
  select public.crm_sync_company_global_config(p_id_empresa)
$$;

create or replace function public.crm_seed_default_tags(p_id_empresa bigint)
returns void language sql security definer set search_path = public, pg_temp as $$
  select public.crm_sync_company_global_config(p_id_empresa)
$$;

alter table public.crm_global_funnel enable row level security;
alter table public.crm_global_stages enable row level security;
alter table public.crm_global_tags enable row level security;

create policy crm_global_funnel_superadmin_select on public.crm_global_funnel
for select to authenticated using (public.crm_get_my_role() = 'super_admin');
create policy crm_global_stages_superadmin_select on public.crm_global_stages
for select to authenticated using (public.crm_get_my_role() = 'super_admin');
create policy crm_global_tags_superadmin_select on public.crm_global_tags
for select to authenticated using (public.crm_get_my_role() = 'super_admin');

grant select on public.crm_global_funnel, public.crm_global_stages, public.crm_global_tags to authenticated;
grant all on public.crm_global_funnel, public.crm_global_stages, public.crm_global_tags to service_role;
grant all on sequence public.crm_global_stages_id_seq, public.crm_global_tags_id_seq to service_role;
revoke insert, update, delete on public.crm_funnels, public.crm_stages, public.crm_tags from authenticated;

grant execute on function public.crm_global_funnel_rename(text) to authenticated;
grant execute on function public.crm_global_stage_create(text) to authenticated;
grant execute on function public.crm_global_stage_update(bigint, text) to authenticated;
grant execute on function public.crm_global_stages_reorder(bigint[]) to authenticated;
grant execute on function public.crm_global_stage_delete(bigint) to authenticated;
grant execute on function public.crm_global_tag_create(text, text) to authenticated;
grant execute on function public.crm_global_tag_update(bigint, text, text) to authenticated;
grant execute on function public.crm_global_tag_delete(bigint) to authenticated;
grant execute on function public.crm_sync_company_global_config(bigint) to service_role;
