do $migration$
declare
  target regprocedure := 'private.kp_claim(text,timestamptz)'::regprocedure;
  definition text := pg_get_functiondef(target);
  original text := $old$private.kp_templates t where t.id_empresa = cfg.id_empresa
                    and t.step = x.step and t.approved$old$;
begin
  if strpos(definition, original) = 0 then raise exception 'Unexpected template eligibility predicate'; end if;
  execute replace(definition, original,
    'private.kp_templates candidate_template where candidate_template.id_empresa = cfg.id_empresa
                    and candidate_template.step = x.step and candidate_template.approved');
end;
$migration$;
