
create schema private;create role anon;create role authenticated;
create schema auth;create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
create schema vault;create table vault.decrypted_secrets(id uuid,decrypted_secret text);
create table empresa_dados(id bigint primary key,nome text default 'Katsuki teste');
create table crm_users(id uuid primary key,auth_user_id uuid,active boolean default true);
create table crm_stages(id bigint primary key,id_empresa bigint,ativo boolean default true);
create table crm_leads(id bigint primary key,id_empresa bigint,telefone text,id_empreendimento bigint,crm_stage_id bigint);
create table lead(id bigint primary key,id_empresa bigint,id_crm text,numero text,id_empreendimento bigint,atendimento_humano boolean default false,wa_conversation_assigned_to uuid,atendimento_humano_desde timestamptz,status text);
create table credentials(id_empresa bigint,whatsapp_business_id text,whatsapp_access_token text);
create table wa_messages(id uuid primary key default gen_random_uuid(),phone_number_id text,client_message_id text unique,direction text,to_wa_id text,from_wa_id text,type text,text_body text,template_name text,template_language text,status_current text,tenant_id bigint,crm_entity_id text,crm_entity_type text,crm_provider text,crm_sync_status text,raw jsonb,message_id text,sent_at timestamptz,timestamp_meta timestamptz,created_at timestamptz default clock_timestamp());
create table suppressed(phone text);
create table hub_whatsapp_channels(id_empresa bigint,provider text,instance text,enabled boolean,auto_send boolean);
create table hub_company_modules(id_empresa bigint,crm boolean);
create table private.hub_whatsapp_transport(id_empresa bigint,base_url text,api_key_secret uuid);
create table private.hub_whatsapp_recipients(id_empresa bigint,member_id uuid,phone text,enabled boolean);
create function public.wa_marketing_send_guard(text,text,bigint) returns boolean language sql as $$select not exists(select 1 from public.suppressed where phone=$2)$$;
-- Candidate only: private campaign subsystem, no existing functions replaced.
-- Apply after reviewing Hub adapters and provisioning the two companies.
begin;
create table private.kp_companies (
 id_empresa bigint primary key references public.empresa_dados(id),
 operation smallint not null unique check(operation in (1,2)),
 phone_number_id text not null unique,
 waba_id text not null,
 enabled boolean not null default false,
 daily_limit integer not null default 10 check(daily_limit between 1 and 20),
 recipient_id uuid not null references public.crm_users(id),
 recipient_phone text not null,
 interested_stage_id bigint references public.crm_stages(id),
 last_opening_reserved_at timestamptz,
 check((operation=1 and phone_number_id='1436339762890531' and waba_id='1356280729669671')
    or (operation=2 and phone_number_id='1464731120047687' and waba_id='2068502413844099'))
);
create table private.kp_templates (
 id_empresa bigint not null references private.kp_companies(id_empresa),
 step smallint not null check(step between 0 and 3),
 name text not null check(name ~ '^[a-z0-9_]+$'),
 approved boolean not null default false,
 body text not null,
 variables text[] not null default '{}',
 media_type text check(media_type in ('image','video')),
 media_id text,
 primary key(id_empresa,step),
 check((step=0 and media_type is null) or (step in (1,3) and media_type='image') or (step=2 and media_type='video')),
 check(not approved or media_type is null or nullif(media_id,'') is not null)
);
create table private.kp_contacts (
 id uuid primary key default gen_random_uuid(),
 id_empresa bigint not null references private.kp_companies(id_empresa),
 crm_lead_id bigint not null references public.crm_leads(id),
 legacy_lead_id bigint not null references public.lead(id),
 company_key text not null unique,
 phone text not null unique check(phone ~ '^55[0-9]{10,11}$'),
 name text not null,
 status text not null default 'active' check(status in ('active','answered','interested','declined','stopped','review','human','complete')),
 phase text not null check(phase in ('identity','offer')),
 generation integer not null default 0,
 first_sent_at timestamptz,
 last_sent_at timestamptz,
 last_outbound text,
 last_reply_id text,
 last_reply_at timestamptz,
 unique(id_empresa,crm_lead_id), unique(id_empresa,legacy_lead_id)
);
create table private.kp_jobs (
 id uuid primary key default gen_random_uuid(),
 contact_id uuid not null references private.kp_contacts(id),
 step smallint not null check(step between 0 and 5),
 due_at timestamptz not null,
 generation integer not null default 0,
 status text not null default 'pending' check(status in ('pending','sending','accepted','cancelled','review')),
 token uuid,
 reserved_at timestamptz,
 booked_day date,
 accepted_at timestamptz,
 message_id text unique,
 body text,
 error text,
 unique(contact_id,step)
);
create table private.kp_replies (
 id text primary key,
 contact_id uuid not null references private.kp_contacts(id),
 generation integer not null,
 body text not null,
 status text not null default 'pending' check(status in ('pending','processing','done','stale','review')),
 token uuid,
 decision text,
 created_at timestamptz not null default clock_timestamp()
);
create table private.kp_handoffs (
 id uuid primary key default gen_random_uuid(),
 contact_id uuid not null unique references private.kp_contacts(id),
 reply_id text not null references private.kp_replies(id),
 status text not null default 'pending' check(status in ('pending','notified','assumed','review')),
 created_at timestamptz not null default clock_timestamp()
);
create index kp_jobs_pending on private.kp_jobs(due_at) where status='pending';
create index kp_replies_pending on private.kp_replies(created_at) where status='pending';
alter table private.kp_companies enable row level security;
alter table private.kp_templates enable row level security;
alter table private.kp_contacts enable row level security;
alter table private.kp_jobs enable row level security;
alter table private.kp_replies enable row level security;
alter table private.kp_handoffs enable row level security;
revoke all on private.kp_companies,private.kp_templates,private.kp_contacts,private.kp_jobs,private.kp_replies,private.kp_handoffs from public,anon,authenticated;

create function private.kp_business_time(t timestamptz) returns boolean language sql stable as $$
 select extract(isodow from t at time zone 'America/Sao_Paulo') between 1 and 5
 and (t at time zone 'America/Sao_Paulo')::time >= time '08:00'
 and (t at time zone 'America/Sao_Paulo')::time < time '18:50';
$$;
create function private.kp_enrollment_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if not exists(select 1 from public.crm_leads c join public.lead l on l.id_empresa=c.id_empresa and l.id_crm=c.id::text
  where c.id=new.crm_lead_id and l.id=new.legacy_lead_id and c.id_empresa=new.id_empresa
  and c.telefone=new.phone and l.numero=new.phone and c.id_empreendimento is null and l.id_empreendimento is null) then
  raise exception 'Lead/empresa/telefone não correspondem ou empreendimento preenchido';
 end if;
 return new;
end $$;
create trigger kp_enrollment_guard before insert or update of id_empresa,crm_lead_id,legacy_lead_id,phone on private.kp_contacts
 for each row execute function private.kp_enrollment_guard();


commit;
alter table private.kp_templates add column media_url text;
alter table private.kp_contacts add column whatsapp_check text default 'confirmado';
alter table private.kp_contacts add column whatsapp_check_at timestamptz;
alter table private.kp_jobs add column reply_id text references private.kp_replies(id);
alter table private.kp_handoffs add column seen_at timestamptz;
