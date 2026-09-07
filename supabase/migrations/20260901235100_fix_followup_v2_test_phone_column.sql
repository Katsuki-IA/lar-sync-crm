-- The legacy lead table stores the WhatsApp phone in `numero`.
do $migration$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'public.authorize_followup_test_v2(bigint,bigint,bigint,bigint,text,timestamp with time zone)'::regprocedure
  ) into v_definition;
  execute replace(v_definition, 'l.telefone', 'l.numero');

  select pg_get_functiondef(
    'public.preview_followup_test_v2(uuid)'::regprocedure
  ) into v_definition;
  execute replace(v_definition, 'l.telefone', 'l.numero');
end
$migration$;
