-- Normalize legacy V1 parameter arrays when they enter the V2 variants table.
-- BODY variables use positional objects; image headers continue to use media_url.

create or replace function public.normalize_followup_v2_parameter_mapping()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if jsonb_typeof(new.parameter_mapping) = 'array'
     and not exists (
       select 1
       from jsonb_array_elements(new.parameter_mapping) entry
       where jsonb_typeof(entry) <> 'string'
     ) then
    if exists (
      select 1
      from jsonb_array_elements_text(new.parameter_mapping) token
      where lower(btrim(token)) = 'nome'
    ) then
      new.parameter_mapping := jsonb_build_array(
        jsonb_build_object('position', 1, 'source', 'nome')
      );
    else
      new.parameter_mapping := '[]'::jsonb;
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.normalize_followup_v2_parameter_mapping()
  from public, anon, authenticated;

drop trigger if exists normalize_followup_v2_parameter_mapping
  on public.followup_variants_v2;

create trigger normalize_followup_v2_parameter_mapping
before insert or update of parameter_mapping
on public.followup_variants_v2
for each row
execute function public.normalize_followup_v2_parameter_mapping();

-- Idempotent cleanup for databases that still contain rows imported by V1.
with normalized as (
  select
    v.id,
    case
      when exists (
        select 1
        from jsonb_array_elements_text(v.parameter_mapping) token
        where lower(btrim(token)) = 'nome'
      ) then jsonb_build_array(
        jsonb_build_object('position', 1, 'source', 'nome')
      )
      else '[]'::jsonb
    end as new_mapping
  from public.followup_variants_v2 v
  where jsonb_typeof(v.parameter_mapping) = 'array'
    and not exists (
      select 1
      from jsonb_array_elements(v.parameter_mapping) entry
      where jsonb_typeof(entry) <> 'string'
    )
)
update public.followup_variants_v2 v
set parameter_mapping = n.new_mapping
from normalized n
where v.id = n.id
  and v.parameter_mapping is distinct from n.new_mapping;
