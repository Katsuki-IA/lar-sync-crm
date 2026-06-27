-- Define a estrutura unica de etapas usada por todas as empresas do HUB.
-- Etapas antigas com leads sao migradas antes da remocao para preservar o historico.

do $$
declare
  v_names text[] := array[
    'Base',
    'Contato Feito',
    'Follow Up 1',
    'Follow Up 2',
    'Follow Up 3',
    'Follow Up 4',
    'Qualificado',
    'Visita Agendada',
    'Perdido',
    'Enviado ao CRM'
  ];
  v_colors text[] := array[
    '#F28B66',
    '#B7860B',
    '#268BD2',
    '#0EA5E9',
    '#2563EB',
    '#1D4ED8',
    '#16A34A',
    '#8B5CF6',
    '#EF4444',
    '#64748B'
  ];
  v_index integer;
  v_global_id bigint;
  v_company record;
  v_obsolete record;
  v_local_stage record;
  v_target_name text;
  v_target_local_id bigint;
begin
  -- Libera temporariamente os valores positivos da restricao unique(ordem).
  update public.crm_global_stages
  set ordem = -id::integer,
      updated_at = now();

  for v_index in 1..array_length(v_names, 1) loop
    select id
    into v_global_id
    from public.crm_global_stages
    where lower(btrim(nome)) = lower(v_names[v_index])
    order by id
    limit 1;

    if v_global_id is null then
      insert into public.crm_global_stages (nome, cor, ordem, ativo)
      values (v_names[v_index], v_colors[v_index], v_index, true)
      returning id into v_global_id;
    else
      update public.crm_global_stages
      set nome = v_names[v_index],
          cor = v_colors[v_index],
          ordem = v_index,
          ativo = true,
          updated_at = now()
      where id = v_global_id;
    end if;
  end loop;

  -- Cria as novas etapas locais antes de migrar leads das etapas removidas.
  for v_company in
    select distinct id_empresa
    from public.crm_funnels
    where id_empresa is not null
  loop
    perform public.crm_sync_company_global_config(v_company.id_empresa);
  end loop;

  for v_obsolete in
    select id, nome
    from public.crm_global_stages
    where not (lower(btrim(nome)) = any (
      select lower(stage_name)
      from unnest(v_names) as stage_name
    ))
  loop
    v_target_name := case lower(btrim(v_obsolete.nome))
      when 'em atendimento' then 'Follow Up 1'
      when 'visita realizada' then 'Qualificado'
      when 'atendimento corretor' then 'Qualificado'
      else 'Base'
    end;

    for v_local_stage in
      select id, id_empresa
      from public.crm_stages
      where global_stage_id = v_obsolete.id
    loop
      select s.id
      into v_target_local_id
      from public.crm_stages s
      join public.crm_global_stages g on g.id = s.global_stage_id
      where s.id_empresa = v_local_stage.id_empresa
        and lower(btrim(g.nome)) = lower(v_target_name)
      limit 1;

      update public.crm_leads
      set crm_stage_id = v_target_local_id,
          updated_at = now()
      where crm_stage_id = v_local_stage.id;

      update public.lead
      set crm_stage_id = v_target_local_id
      where crm_stage_id = v_local_stage.id;

      delete from public.crm_stages where id = v_local_stage.id;
    end loop;

    delete from public.crm_global_stages where id = v_obsolete.id;
  end loop;

  -- Garante nome, cor, ordem e estado final em todas as empresas existentes.
  for v_company in
    select distinct id_empresa
    from public.crm_funnels
    where id_empresa is not null
  loop
    perform public.crm_sync_company_global_config(v_company.id_empresa);
  end loop;
end;
$$;
