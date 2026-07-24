-- Renomeia a etapa global Qualificado para Bloqueio Envio.
-- A etapa global alimenta o seed/sync de novas empresas; as etapas locais
-- existentes sao atualizadas para manter os IDs locais ja usados em automacoes.

do $$
declare
  v_stage_id bigint;
begin
  select id
  into v_stage_id
  from public.crm_global_stages
  where lower(btrim(nome)) in ('qualificado', 'bloqueio envio')
  order by case when lower(btrim(nome)) = 'qualificado' then 0 else 1 end, id
  limit 1;

  if v_stage_id is not null then
    update public.crm_global_stages
    set nome = 'Bloqueio Envio',
        updated_at = now()
    where id = v_stage_id
      and nome is distinct from 'Bloqueio Envio';

    update public.crm_stages
    set nome = 'Bloqueio Envio'
    where global_stage_id = v_stage_id
      and nome is distinct from 'Bloqueio Envio';
  end if;

  update public.crm_stages
  set nome = 'Bloqueio Envio'
  where lower(btrim(nome)) = 'qualificado'
    and (
      v_stage_id is null
      or global_stage_id is null
      or global_stage_id = v_stage_id
    );
end;
$$;
