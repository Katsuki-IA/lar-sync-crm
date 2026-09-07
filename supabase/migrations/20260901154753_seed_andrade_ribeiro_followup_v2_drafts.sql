-- Pilot only. All imported records remain draft and cannot send messages.

select public.import_followup_v1_config_v2(19);

insert into public.followup_sequences_v2 (
  id_empresa,
  id_empreendimento,
  nome,
  audience_scope,
  status,
  metadata
)
select
  19,
  null,
  'Sem empreendimento',
  'no_project',
  'draft',
  jsonb_build_object('source', 'v2_setup', 'requires_configuration', true)
where not exists (
  select 1
  from public.followup_sequences_v2
  where id_empresa = 19
    and audience_scope = 'no_project'
    and status <> 'archived'
);
