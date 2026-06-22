create or replace function public.crm_normalize_lead_origin(
  p_origem text,
  p_modulo text default null
)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_value text;
  v_key text;
begin
  v_value := coalesce(nullif(trim(p_origem), ''), nullif(trim(p_modulo), ''), 'ND');

  if upper(v_value) = any (array[
    'AP', 'AT', 'BC', 'BO', 'CH', 'CB', 'DP', 'EM', 'FB', 'GO',
    'IT', 'IG', 'LI', 'LK', 'MP', 'OP', 'PA', 'PO', 'RF', 'SC',
    'TD', 'TW', 'SI', 'UK', 'ND', 'RM', 'PR', 'TT', 'WA', 'OU'
  ]) then
    return upper(v_value);
  end if;

  v_key := lower(regexp_replace(trim(v_value), '\s+', ' ', 'g'));
  v_key := translate(
    v_key,
    'áàâãäéèêëíìîïóòôõöúùûüç',
    'aaaaaeeeeiiiiooooouuuuc'
  );

  return case v_key
    when 'aplicativo' then 'AP'
    when 'modulo de atendimento' then 'AT'
    when 'busca compartilhada' then 'BC'
    when 'busca organica' then 'BO'
    when 'chat online' then 'CH'
    when 'chatbot' then 'CB'
    when 'display' then 'DP'
    when 'email' then 'EM'
    when 'facebook' then 'FB'
    when 'meta lead ads' then 'FB'
    when 'facebook lead ads' then 'FB'
    when 'google' then 'GO'
    when 'instapage' then 'IT'
    when 'instagram' then 'IG'
    when 'ligacao' then 'LI'
    when 'linkedin' then 'LK'
    when 'midia paga' then 'MP'
    when 'outras publicidades' then 'OP'
    when 'painel' then 'PA'
    when 'portais' then 'PO'
    when 'referencia' then 'RF'
    when 'social' then 'SC'
    when 'trafego direto' then 'TD'
    when 'twitter' then 'TW'
    when 'website' then 'SI'
    when 'web site' then 'SI'
    when 'site' then 'SI'
    when 'desconhecido' then 'UK'
    when 'nao definido' then 'ND'
    when 'remarketing' then 'RM'
    when 'pinterest' then 'PR'
    when 'tik tok' then 'TT'
    when 'tiktok' then 'TT'
    when 'whatsapp' then 'WA'
    when 'whats app' then 'WA'
    when 'outros' then 'OU'
    else 'ND'
  end;
end;
$$;

do $$
begin
  if exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.crm_leads'::regclass
      and tgname = 'set_updated_at'
      and not tgisinternal
  ) then
    alter table public.crm_leads disable trigger set_updated_at;
  end if;
end;
$$;

update public.crm_leads
set origem = public.crm_normalize_lead_origin(origem, null)
where origem is distinct from public.crm_normalize_lead_origin(origem, null);

do $$
begin
  if exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.crm_leads'::regclass
      and tgname = 'set_updated_at'
      and not tgisinternal
  ) then
    alter table public.crm_leads enable trigger set_updated_at;
  end if;
end;
$$;

alter table public.crm_leads
  alter column origem set default 'ND',
  alter column origem set not null;

alter table public.crm_leads
  drop constraint if exists crm_leads_origem_check;

alter table public.crm_leads
  add constraint crm_leads_origem_check check (origem = any (array[
    'AP', 'AT', 'BC', 'BO', 'CH', 'CB', 'DP', 'EM', 'FB', 'GO',
    'IT', 'IG', 'LI', 'LK', 'MP', 'OP', 'PA', 'PO', 'RF', 'SC',
    'TD', 'TW', 'SI', 'UK', 'ND', 'RM', 'PR', 'TT', 'WA', 'OU'
  ]));

create or replace function public.crm_set_normalized_lead_origin()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.origem := public.crm_normalize_lead_origin(new.origem, null);
  return new;
end;
$$;

drop trigger if exists normalize_crm_lead_origin on public.crm_leads;
create trigger normalize_crm_lead_origin
before insert or update of origem on public.crm_leads
for each row execute function public.crm_set_normalized_lead_origin();

grant execute on function public.crm_normalize_lead_origin(text, text)
to anon, authenticated, service_role;

comment on function public.crm_normalize_lead_origin(text, text) is
'Resolve a origem do lead usando origem, depois modulo e, por fim, ND.';
