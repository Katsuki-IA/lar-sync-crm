-- Kommo project configuration is server-only. API handlers authorize tenant access.
create table public.crm_kommo_project_settings (
  id_empresa bigint primary key references public.empresa_dados(id) on delete cascade,
  enabled boolean not null default false,
  account_url text not null,
  account_id bigint,
  field_id bigint,
  field_name text not null default 'Empreendimento de interesse',
  mappings jsonb not null default '{}'::jsonb check (jsonb_typeof(mappings) = 'object'),
  unknown_enum_id bigint,
  unknown_policy text not null default 'undefined' check (unknown_policy in ('undefined','block')),
  auto_create_options boolean not null default true,
  sync_interest boolean not null default true,
  last_error text,
  lock_token uuid,
  lock_until timestamptz,
  next_run_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not enabled or (field_id is not null and field_id > 0 and account_id is not null and account_id > 0))
);
create table public.crm_kommo_project_sync (
  id_empresa bigint not null references public.crm_kommo_project_settings(id_empresa) on delete cascade,
  lead_id bigint not null references public.crm_leads(id) on delete cascade,
  external_id bigint not null check (external_id > 0),
  field_id bigint not null check (field_id > 0),
  account_url text not null,
  last_enum_id bigint,
  tracked boolean not null default false,
  status text not null default 'pending' check (status in ('pending','synced','conflict','failed')),
  last_error text,
  next_check_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(id_empresa,lead_id)
);
create index crm_kommo_project_sync_due_idx on public.crm_kommo_project_sync(id_empresa,next_check_at);
alter table public.crm_kommo_project_settings enable row level security;
alter table public.crm_kommo_project_sync enable row level security;
revoke all on public.crm_kommo_project_settings, public.crm_kommo_project_sync from public,anon,authenticated;
grant all on public.crm_kommo_project_settings, public.crm_kommo_project_sync to service_role;

create function public.kommo_project_acquire_lock(p_company bigint,p_token uuid) returns boolean
language sql security invoker set search_path='' as $$
  with acquired as (
    update public.crm_kommo_project_settings set lock_token=p_token,lock_until=now()+interval '5 minutes'
    where id_empresa=p_company and (lock_until is null or lock_until<now()) returning 1
  ) select exists(select 1 from acquired);
$$;
create function public.kommo_project_release_lock(p_company bigint,p_token uuid) returns void
language sql security invoker set search_path='' as $$
  update public.crm_kommo_project_settings set lock_token=null,lock_until=null
  where id_empresa=p_company and lock_token=p_token;
$$;

-- Only confirmed exports to this provider establish an external identity. Never guess by phone.
create function public.kommo_project_seed_sync(p_company bigint) returns void
language sql security invoker set search_path='' as $$
  insert into public.crm_kommo_project_sync(id_empresa,lead_id,external_id,field_id,account_url,last_enum_id,tracked)
  select distinct on(l.lead_id) l.id_empresa,l.lead_id,l.external_id::bigint,s.field_id,s.account_url,
    (cf.value#>>'{values,0,enum_id}')::bigint,
    cf.value is not null
  from public.crm_external_crm_send_logs l
  join public.crm_kommo_project_settings s on s.id_empresa=l.id_empresa and s.enabled
  join public.crm_leads c on c.id=l.lead_id and c.id_empresa=l.id_empresa
  left join lateral (
    select value from jsonb_array_elements(coalesce(l.request_payload#>'{create_lead,0,custom_fields_values}','[]'::jsonb))
    where value->>'field_id'=s.field_id::text limit 1
  ) cf on true
  where l.id_empresa=p_company and l.provider='kommo' and l.status='sent'
    and l.external_id ~ '^[1-9][0-9]{0,14}$'
  order by l.lead_id,l.created_at desc
  on conflict (id_empresa,lead_id) do nothing;
$$;
revoke all on function public.kommo_project_acquire_lock(bigint,uuid), public.kommo_project_release_lock(bigint,uuid), public.kommo_project_seed_sync(bigint) from public,anon,authenticated;
grant execute on function public.kommo_project_acquire_lock(bigint,uuid), public.kommo_project_release_lock(bigint,uuid), public.kommo_project_seed_sync(bigint) to service_role;

select cron.schedule('kommo-project-identification','*/5 * * * *',$cron$
  select net.http_post(
    url := 'https://tswdxgefmhjvjwafaxjl.supabase.co/functions/v1/kommo-project-sync',
    headers := jsonb_build_object('Content-Type','application/json',
      'Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='meta_watchdog_anon_key'),
      'x-meta-health-secret',(select decrypted_secret from vault.decrypted_secrets where name='meta_health_cron_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 55000)
  where exists(select 1 from public.crm_kommo_project_settings where enabled and next_run_at<=now());
$cron$);
