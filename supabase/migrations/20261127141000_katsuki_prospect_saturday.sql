-- Shared calendar for the Katsuki prospecting workers, in São Paulo local time.
create or replace function private.kp_next_business_time(p_at timestamptz)
returns timestamptz language plpgsql immutable strict set search_path='' as $$
declare
  local_at timestamp := p_at at time zone 'America/Sao_Paulo';
  weekday integer;
  opens time;
  closes time;
begin
  loop
    weekday := extract(isodow from local_at);
    opens := case when weekday = 6 then time '10:00' else time '08:00' end;
    closes := case when weekday = 6 then time '15:00' else time '18:50' end;
    if weekday < 7 and local_at::time < closes then
      return greatest(local_at, local_at::date + opens) at time zone 'America/Sao_Paulo';
    end if;
    local_at := (local_at::date + 1)::timestamp;
  end loop;
end $$;

create or replace function private.kp_business_time(t timestamptz)
returns boolean language sql stable set search_path='' as $$
  select private.kp_next_business_time(t) = t;
$$;

create or replace function private.kp_followup_due(p_anchor timestamptz, p_step integer, p_not_before timestamptz default null)
returns timestamptz language plpgsql immutable security invoker set search_path='' as $$
declare
  d date;
  h time;
  target timestamptz;
begin
  if p_anchor is null or p_step is null or p_step not between 1 and 3 then
    raise exception 'Invalid followup anchor or step';
  end if;
  d := (p_anchor at time zone 'America/Sao_Paulo')::date + case p_step when 1 then 1 when 2 then 3 else 7 end;
  h := case when p_step = 2 then time '14:00' else time '10:00' end;
  if p_not_before is not null then
    d := greatest(d,(p_not_before at time zone 'America/Sao_Paulo')::date);
  end if;
  loop
    target := (d+h) at time zone 'America/Sao_Paulo';
    if private.kp_next_business_time(target) = target and (p_not_before is null or target >= p_not_before) then
      return target;
    end if;
    d := d+1;
  end loop;
end $$;
