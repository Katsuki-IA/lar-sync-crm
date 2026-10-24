-- ============================================================================
-- SQL CANDIDATO — Secretária, fase 1 (interpretação de texto) — REVISADO
-- NÃO APLICADO. Revisar e aplicar manualmente quando autorizado.
--
-- Correções desta revisão:
--  1. Privilégios mínimos explícitos: funções internas no schema private
--     (security definer, search_path=''), wrappers públicos security invoker
--     com REVOKE de public/anon e GRANT apenas ao papel necessário
--     (authenticated para settings de UI; service_role para operações
--     internas). Tabela de configuração com RLS habilitado e sem políticas
--     (acesso direto negado; somente via funções).
--  2. Atomicidade: UMA função transacional (private.hub_secretary_finalize)
--     trava o evento ANTES de executar, verifica corpo/remetente, revalida
--     canal/membro ativo/módulo/configuração e oferta, executa a operação,
--     registra o evento e enfileira a resposta na MESMA transação. A IA roda
--     fora da transação e só interpreta; o banco revalida tudo.
--  3. Respostas livres NÃO usam hub_secretary_notices/hub_whatsapp_outbox
--     (code exige '^[A-F0-9]{12}$', offer_id é único e NOT NULL, e o worker
--     cancela jobs sem oferta pendente). Criado outbox próprio
--     (private.hub_secretary_replies) com claim/finish espelhando o worker
--     real. O worker (n8n) precisa passar a chamar também
--     public.hub_secretary_claim_reply/finish_reply — integração explícita,
--     nada aqui promete envio sem essa alteração do worker.
--  4. Nomes reais de colunas confirmados no banco: crm_stages.nome,
--     crm_opportunities.stage_id/assigned_to/lead_id, hub_sales_offers
--     .distribution_id/member_id/status/expires_at. O nome exibido é o nome
--     do LEAD (distribution -> opportunity -> crm_leads.nome), não
--     opportunity_title. Listagem de leads deduplicada por lead e com
--     paginação real (limite + deslocamento).
--  5. Contrato do desvio corrigido: o endpoint espera "eventId" (camelCase);
--     o patch de encaminhamento envia "eventId". Patch completo e verificável
--     ao final, com rollback (texto original da função).
--  6. Settings: leitura de UI (authenticated, auth.uid()) separada da leitura
--     de runtime (service_role, sem auth.uid()). O caminho de execução não
--     chama função que exige auth.uid() com o client de serviço.
--
-- O comando legado ACEITAR/RECUSAR+código segue intacto no receiver atual;
-- o desvio abaixo só encaminha mensagens que NÃO são o comando legado.
-- ============================================================================

-- === pglite-core-begin ===
-- (trecho carregado e testado offline em src/lib/secretary-sql.test.ts)

-- ----------------------------------------------------------------------------
-- Tabela de configuração por empresa: tom, regras (prompt base) e ativação.
-- ----------------------------------------------------------------------------
create table if not exists public.hub_secretary_ai_settings (
  id_empresa bigint primary key references public.empresa_dados(id),
  enabled boolean not null default false,
  tone text not null default 'cordial' check (tone in ('cordial','objetivo','formal')),
  base_prompt text check (base_prompt is null or length(base_prompt) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.hub_secretary_ai_settings enable row level security;
-- Sem políticas: acesso direto negado a todos; somente via funções abaixo.
revoke all on public.hub_secretary_ai_settings from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Outbox de respostas livres (schema private: inacessível via Data API).
-- Espelha o ciclo de vida de public.hub_whatsapp_outbox, sem depender de
-- aviso/oferta. claim/finish são chamados pelo worker via wrappers públicos
-- restritos a service_role.
-- ----------------------------------------------------------------------------
create table if not exists private.hub_secretary_replies (
  id uuid primary key default gen_random_uuid(),
  id_empresa bigint not null references public.hub_whatsapp_channels(id_empresa),
  member_id uuid not null references public.crm_users(id),
  body text not null check (length(body) between 1 and 1000),
  status text not null default 'pending'
    check (status in ('pending','sending','sent','uncertain','failed','cancelled')),
  attempts integer not null default 0,
  lease uuid,
  claimed_at timestamptz,
  available_at timestamptz not null default clock_timestamp(),
  provider_id text,
  reason text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create index if not exists hub_secretary_replies_pending
  on private.hub_secretary_replies (id_empresa, available_at)
  where status = 'pending';

-- ----------------------------------------------------------------------------
-- Mensagens ao corretor, por tom. Espelha src/lib/secretary-interpreter.ts
-- (teste de paridade garante que os textos não divergem).
-- ----------------------------------------------------------------------------
create or replace function private.hub_secretary_msg(
  p_kind text, p_tone text, p_count integer default null,
  p_lines text[] default null, p_title text default null
) returns text language plpgsql immutable set search_path = '' as $$
begin
  case p_kind
    when 'help' then return case p_tone
      when 'objetivo' then 'Comandos disponíveis: "meus leads", "aceitar Nome ou código", "recusar Nome ou código".'
      when 'formal' then 'Prezado(a), os comandos disponíveis são: listagem de leads e aceite ou recusa de ofertas, informando o nome do lead ou o código do aviso.'
      else 'Olá! Posso ajudar com: ver seus leads, aceitar ou recusar uma oferta. Responda, por exemplo, "meus leads" ou "aceitar Nome do Lead".' end;
    when 'list_empty' then return case when p_tone = 'formal'
      then 'No momento não há leads atribuídos a você.'
      else 'Você não tem leads atribuídos no momento.' end;
    when 'list' then return (case p_tone
      when 'objetivo' then 'Seus leads (' || p_count || '):'
      when 'formal' then 'Segue a relação dos seus leads (' || p_count || '):'
      else 'Aqui estão seus leads (' || p_count || '):' end)
      || E'\n' || array_to_string(p_lines, E'\n');
    when 'accepted' then return case when p_tone = 'formal'
      then 'Oferta "' || p_title || '" aceita com sucesso.'
      else 'Oferta "' || p_title || '" aceita! Bom atendimento.' end;
    when 'declined' then return case when p_tone = 'formal'
      then 'Oferta "' || p_title || '" recusada.'
      else 'Oferta "' || p_title || '" recusada, sem problemas.' end;
    when 'expired' then return case when p_tone = 'formal'
      then 'O prazo desta oferta encerrou; a resposta não atribuiu a oportunidade.'
      else 'O prazo dessa oferta já encerrou.' end;
    when 'closed' then return case when p_tone = 'formal'
      then 'Esta oferta já foi encerrada.'
      else 'Essa oferta já foi encerrada.' end;
    when 'not_found' then return case when p_tone = 'formal'
      then 'Não localizei uma oferta pendente com essa referência. Confira o nome ou o código do aviso.'
      else 'Não encontrei uma oferta pendente com esse nome ou código. Confira e tente de novo.' end;
    when 'ambiguous' then return (case when p_tone = 'formal'
      then 'Há mais de uma oferta pendente com essa referência. Responda com o código do aviso:'
      else 'Encontrei mais de uma oferta com esse nome. Me diga o código do aviso:' end)
      || E'\n' || array_to_string(p_lines, E'\n');
    else raise exception 'Invalid message kind' using errcode = '22023';
  end case;
end $$;

-- ----------------------------------------------------------------------------
-- Settings — leitura de UI (gestor da empresa ou super_admin; auth.uid()).
-- ----------------------------------------------------------------------------
create or replace function private.hub_secretary_ai_get(p_company_id bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor public.crm_users;
begin
  select * into actor from public.crm_users where auth_user_id = auth.uid() and active;
  if actor.id is null or actor.role not in ('manager','gestor','super_admin')
     or (actor.role <> 'super_admin' and actor.id_empresa is distinct from p_company_id) then
    raise exception 'Configuração restrita ao gestor da empresa' using errcode = '42501';
  end if;
  return (select jsonb_build_object('enabled', s.enabled, 'tone', s.tone, 'base_prompt', s.base_prompt)
            from public.hub_secretary_ai_settings s where s.id_empresa = p_company_id);
end $$;

-- Settings — escrita de UI: somente super_admin.
create or replace function private.hub_secretary_ai_save(
  p_company_id bigint, p_enabled boolean, p_tone text, p_base_prompt text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor public.crm_users;
begin
  select * into actor from public.crm_users where auth_user_id = auth.uid() and active;
  if actor.id is null or actor.role is distinct from 'super_admin' then
    raise exception 'Somente super_admin pode configurar a interpretação de texto' using errcode = '42501';
  end if;
  if p_tone is null or p_tone not in ('cordial','objetivo','formal') then
    raise exception 'Tom inválido' using errcode = '22023';
  end if;
  insert into public.hub_secretary_ai_settings (id_empresa, enabled, tone, base_prompt)
  values (p_company_id, p_enabled, p_tone, nullif(btrim(p_base_prompt), ''))
  on conflict (id_empresa) do update
    set enabled = excluded.enabled, tone = excluded.tone,
        base_prompt = excluded.base_prompt, updated_at = now();
  return '{}'::jsonb;
end $$;

-- Settings — leitura de RUNTIME (uso interno, service_role; sem auth.uid()).
create or replace function private.hub_secretary_ai_runtime(p_company_id bigint)
returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object('enabled', s.enabled, 'tone', s.tone, 'base_prompt', s.base_prompt)
    from public.hub_secretary_ai_settings s where s.id_empresa = p_company_id;
$$;

-- ----------------------------------------------------------------------------
-- Resolve empresa + membro pelo canal (instância) e telefone do remetente.
-- Mesma regra do webhook atual: destinatário habilitado, membro ativo,
-- papel de corretor e CRM habilitado. Uso interno (service_role).
-- ----------------------------------------------------------------------------
create or replace function private.hub_secretary_resolve_sender(p_instance text, p_phone text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare row record;
begin
  select c.id_empresa as company_id, r.member_id, u.active as member_active, m.crm as crm_enabled
    into row
    from public.hub_whatsapp_channels c
    join private.hub_whatsapp_recipients r on r.id_empresa = c.id_empresa and r.enabled
    join public.crm_users u on u.id = r.member_id and u.id_empresa = r.id_empresa
       and u.role in ('agent','corretor')
    join public.hub_company_modules m on m.id_empresa = c.id_empresa
   where c.instance = p_instance and c.enabled and r.phone = p_phone;
  if row is null then return null; end if;
  return jsonb_build_object('company_id', row.company_id, 'member_id', row.member_id,
                            'member_active', row.member_active, 'crm_enabled', row.crm_enabled);
end $$;

-- ----------------------------------------------------------------------------
-- NÚCLEO TRANSACIONAL — executa um comando já interpretado.
-- Trava o evento ANTES de executar; replay devolve o resultado original;
-- revalida remetente (canal+telefone, membro ativo, CRM), configuração e
-- oferta no momento da execução; operação + registro + resposta enfileirada
-- na mesma transação (falha em qualquer etapa desfaz tudo).
-- p_command: {"kind":"legacy","action":"accept|decline","code":"ABCDEF012345"}
--          | {"kind":"list","limit":1..50,"offset":0..}
--          | {"kind":"respond","action":"accept|decline","reference":"..."|null}
--          | {"kind":"help"}
-- ----------------------------------------------------------------------------
create or replace function private.hub_secretary_finalize(
  p_instance text, p_phone text, p_event_id text, p_body text, p_command jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  company bigint; actor uuid;
  previous private.hub_whatsapp_incoming;
  settings record; tone text;
  kind text; action text; ref text; code text;
  lim integer; off integer;
  result_status text; message text;
  offer record; matches record; match_count integer; match_lines text[];
  respond jsonb; notice_id uuid;
  lead_lines text[]; lead_count integer;
begin
  -- Validação de entrada (mesmas regras do receiver atual).
  if p_event_id is null or length(p_event_id) not between 1 and 200
     or p_body is null or length(p_body) not between 1 and 500 then
    raise exception 'Invalid event' using errcode = '22023';
  end if;
  kind := p_command ->> 'kind';
  if kind is null or kind not in ('legacy','list','respond','help') then
    raise exception 'Invalid command' using errcode = '22023';
  end if;

  -- Revalida o remetente no momento da execução (membro pode ter sido
  -- desativado entre a interpretação e esta chamada).
  select c.id_empresa, r.member_id into company, actor
    from public.hub_whatsapp_channels c
    join private.hub_whatsapp_recipients r on r.id_empresa = c.id_empresa and r.enabled
    join public.crm_users u on u.id = r.member_id and u.id_empresa = r.id_empresa
       and u.active and u.role in ('agent','corretor')
    join public.hub_company_modules m on m.id_empresa = c.id_empresa and m.crm
   where c.instance = p_instance and c.enabled and r.phone = p_phone;
  if actor is null then
    return jsonb_build_object('status', 'ignored', 'message', '');
  end if;

  -- Trava o evento ANTES de qualquer execução; replay devolve o original.
  perform pg_advisory_xact_lock(hashtextextended(company::text || p_event_id, 44));
  select * into previous from private.hub_whatsapp_incoming
   where id_empresa = company and event_id = p_event_id;
  if found then
    if previous.member_id <> actor or previous.body <> p_body then
      raise exception 'Event reused' using errcode = '22023';
    end if;
    return previous.result || jsonb_build_object('status', 'replayed');
  end if;

  -- Configuração lida dentro da transação; ausência = desativada.
  select s.enabled, s.tone into settings
    from public.hub_secretary_ai_settings s where s.id_empresa = company;
  tone := coalesce(settings.tone, 'cordial');

  if kind = 'help' then
    if coalesce(settings.enabled, false) then
      result_status := 'help';
    else
      result_status := 'unavailable';
    end if;
    message := private.hub_secretary_msg('help', tone);

  elsif kind = 'list' then
    if not coalesce(settings.enabled, false) then
      result_status := 'unavailable';
      message := private.hub_secretary_msg('help', tone);
    else
      lim := least(greatest(coalesce((p_command ->> 'limit')::integer, 10), 1), 50);
      off := greatest(coalesce((p_command ->> 'offset')::integer, 0), 0);
      -- Leads próprios, deduplicados por lead, com nome real do lead e etapa.
      select count(*), array_agg(line order by recent desc) into lead_count, lead_lines
        from (
          select distinct on (l.id)
                 l.id, op.created_at as recent,
                 '• ' || l.nome || case when st.nome is not null then ' — ' || st.nome else '' end as line
            from public.crm_opportunities op
            join public.crm_leads l on l.id = op.lead_id and l.id_empresa = op.id_empresa
            left join public.crm_stages st on st.id = op.stage_id
           where op.id_empresa = company and op.assigned_to = actor
           order by l.id, op.created_at desc
        ) t;
      if lead_count = 0 then
        result_status := 'listed';
        message := private.hub_secretary_msg('list_empty', tone);
      else
        select array_agg(line order by recent desc) into lead_lines from (
          select line, recent from (
            select distinct on (l.id)
                   l.id, op.created_at as recent,
                   '• ' || l.nome || case when st.nome is not null then ' — ' || st.nome else '' end as line
              from public.crm_opportunities op
              join public.crm_leads l on l.id = op.lead_id and l.id_empresa = op.id_empresa
              left join public.crm_stages st on st.id = op.stage_id
             where op.id_empresa = company and op.assigned_to = actor
             order by l.id, op.created_at desc
          ) d order by recent desc limit lim offset off
        ) p;
        result_status := 'listed';
        message := private.hub_secretary_msg('list', tone, coalesce(array_length(lead_lines, 1), 0), lead_lines);
      end if;
    end if;

  else
    -- legacy ou respond: resolve a oferta própria pendente dentro da transação.
    if kind = 'legacy' then
      action := p_command ->> 'action';
      code := upper(coalesce(p_command ->> 'code', ''));
      if action is null or action not in ('accept','decline')
         or code !~ '^[A-F0-9]{12}$' then
        raise exception 'Invalid command' using errcode = '22023';
      end if;
      select o.id, n.code, l.nome as lead_name, n.id as n_id into offer
        from public.hub_secretary_notices n
        join public.hub_sales_offers o on o.id = n.offer_id
        join public.hub_whatsapp_outbox ob on ob.notice_id = n.id
        join public.hub_sales_distributions d on d.id = o.distribution_id
        join public.crm_opportunities op on op.id = d.opportunity_id
        join public.crm_leads l on l.id = op.lead_id
       where n.code = code and n.id_empresa = company and n.member_id = actor
         and ob.attempts > 0 and ob.status in ('sending','sent','uncertain')
       limit 1;
      if offer.id is null then
        result_status := 'not_found';
        message := private.hub_secretary_msg('not_found', tone);
      end if;
    else
      action := p_command ->> 'action';
      ref := nullif(btrim(coalesce(p_command ->> 'reference', '')), '');
      if action is null or action not in ('accept','decline')
         or (ref is not null and length(ref) > 120) then
        raise exception 'Invalid command' using errcode = '22023';
      end if;
      -- Ofertas próprias pendentes e não expiradas; nome = nome do lead.
      create temporary table if not exists hub_secretary_match
        (id uuid, code text, lead_name text) on commit drop;
      delete from hub_secretary_match;
      insert into hub_secretary_match
        select o.id, n.code, l.nome
          from public.hub_sales_offers o
          join public.hub_secretary_notices n on n.offer_id = o.id
          join public.hub_sales_distributions d on d.id = o.distribution_id
          join public.crm_opportunities op on op.id = d.opportunity_id
          join public.crm_leads l on l.id = op.lead_id
         where o.id_empresa = company and o.member_id = actor
           and o.status = 'pending' and o.expires_at > clock_timestamp();
      if ref is null then
        select count(*) into match_count from hub_secretary_match;
        if match_count = 1 then
          select * into offer from hub_secretary_match limit 1;
        elsif match_count = 0 then
          result_status := 'not_found';
          message := private.hub_secretary_msg('not_found', tone);
        else
          select array_agg('• ' || m.lead_name || ' — código ' || m.code order by m.lead_name)
            into match_lines from hub_secretary_match m;
          result_status := 'ambiguous';
          message := private.hub_secretary_msg('ambiguous', tone, null, match_lines);
        end if;
      else
        -- Código tem precedência; depois nome exato (case/espaços), depois parcial.
        select * into offer from hub_secretary_match where code = upper(ref) limit 1;
        if offer.id is null then
          select count(*), array_agg('• ' || m.lead_name || ' — código ' || m.code order by m.lead_name)
            into match_count, match_lines
            from hub_secretary_match m
           where lower(regexp_replace(btrim(m.lead_name), '\s+', ' ', 'g'))
                 = lower(regexp_replace(btrim(ref), '\s+', ' ', 'g'));
          if match_count = 1 then
            select * into offer from hub_secretary_match m
             where lower(regexp_replace(btrim(m.lead_name), '\s+', ' ', 'g'))
                   = lower(regexp_replace(btrim(ref), '\s+', ' ', 'g')) limit 1;
          elsif match_count > 1 then
            result_status := 'ambiguous';
            message := private.hub_secretary_msg('ambiguous', tone, null, match_lines);
          else
            select count(*), array_agg('• ' || m.lead_name || ' — código ' || m.code order by m.lead_name)
              into match_count, match_lines
              from hub_secretary_match m
             where position(lower(regexp_replace(btrim(ref), '\s+', ' ', 'g'))
                            in lower(regexp_replace(btrim(m.lead_name), '\s+', ' ', 'g'))) > 0;
            if match_count = 1 then
              select * into offer from hub_secretary_match m
               where position(lower(regexp_replace(btrim(ref), '\s+', ' ', 'g'))
                              in lower(regexp_replace(btrim(m.lead_name), '\s+', ' ', 'g'))) > 0
               limit 1;
            elsif match_count > 1 then
              result_status := 'ambiguous';
              message := private.hub_secretary_msg('ambiguous', tone, null, match_lines);
            else
              result_status := 'not_found';
              message := private.hub_secretary_msg('not_found', tone);
            end if;
          end if;
        end if;
      end if;
    end if;

    -- Executa a operação atômica existente, que revalida propriedade,
    -- expiração, fila e módulo no momento da execução.
    if result_status is null then
      notice_id := offer.n_id;
      respond := private.hub_respond_sales_offer_as(offer.id, action, actor);
      case respond ->> 'status'
        when 'accepted' then
          result_status := 'accepted';
          message := private.hub_secretary_msg('accepted', tone, null, null, offer.lead_name);
        when 'declined' then
          result_status := 'declined';
          message := private.hub_secretary_msg('declined', tone, null, null, offer.lead_name);
        when 'expired' then
          result_status := 'expired';
          message := private.hub_secretary_msg('expired', tone);
        else
          result_status := 'closed';
          message := private.hub_secretary_msg('closed', tone);
      end case;
    end if;
  end if;

  -- Registro do evento + histórico + resposta enfileirada: mesma transação.
  -- Se qualquer insert falhar, tudo acima é desfeito (inclusive o aceite).
  insert into private.hub_whatsapp_incoming (id_empresa, event_id, member_id, body, result)
  values (company, p_event_id, actor, p_body,
          jsonb_build_object('status', result_status, 'message', message));
  insert into public.hub_secretary_responses (id_empresa, member_id, request_id, body, notice_id, result, channel)
  values (company, actor, gen_random_uuid(), p_body, notice_id,
          jsonb_build_object('status', result_status, 'message', message),
          (select provider from public.hub_whatsapp_channels where id_empresa = company));
  if message is not null and message <> '' then
    insert into private.hub_secretary_replies (id_empresa, member_id, body)
    values (company, actor, message);
  end if;
  return jsonb_build_object('status', result_status, 'message', message);
end $$;

-- ----------------------------------------------------------------------------
-- claim/finish do outbox de respostas livres — espelham o worker real
-- (private.hub_claim_whatsapp / private.hub_finish_whatsapp), sem validação
-- de oferta. O worker (n8n) deve chamá-los além dos atuais; sem isso as
-- respostas ficam pendentes (nenhum envio é prometido sem essa integração).
-- ----------------------------------------------------------------------------
create or replace function private.hub_secretary_claim_reply(p_instance text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare job private.hub_secretary_replies; target text;
begin
  update private.hub_secretary_replies r set status='uncertain', reason='worker_interrupted',
         updated_at=clock_timestamp()
    from public.hub_whatsapp_channels c
   where c.id_empresa=r.id_empresa and c.instance=p_instance and r.status='sending'
     and r.claimed_at<clock_timestamp()-interval '2 minutes';
  for job in select r.* from private.hub_secretary_replies r
      join public.hub_whatsapp_channels c on c.id_empresa=r.id_empresa
      where c.instance=p_instance and r.status='pending' and r.available_at<=clock_timestamp()
      order by r.available_at, r.id limit 50 for update of r skip locked loop
    select rec.phone into target from private.hub_whatsapp_recipients rec
      join public.crm_users u on u.id=rec.member_id and u.id_empresa=rec.id_empresa and u.active
      join public.hub_company_modules m on m.id_empresa=rec.id_empresa and m.crm
     where rec.id_empresa=job.id_empresa and rec.member_id=job.member_id and rec.enabled;
    if target is null then
      update private.hub_secretary_replies set status='cancelled', reason='recipient_unavailable',
             updated_at=clock_timestamp() where id=job.id;
      continue;
    end if;
    update private.hub_secretary_replies set status='sending', attempts=attempts+1,
           lease=gen_random_uuid(), claimed_at=clock_timestamp(), updated_at=clock_timestamp()
     where id=job.id returning * into job;
    return jsonb_build_object('id',job.id,'lease',job.lease,'phone',target,'body',job.body,'instance',p_instance);
  end loop;
  return null;
end $$;

create or replace function private.hub_secretary_finish_reply(
  p_id uuid, p_lease uuid, p_status text, p_provider_id text
) returns void language plpgsql security definer set search_path = '' as $$
declare job private.hub_secretary_replies;
begin
  if p_status not in ('sent','rate_limited','failed','uncertain') or p_status is null then
    raise exception 'Invalid status' using errcode='22023';
  end if;
  if p_status='sent' and (p_provider_id is null or length(p_provider_id) not between 1 and 200) then
    raise exception 'Provider ID required' using errcode='22023';
  end if;
  select * into job from private.hub_secretary_replies where id=p_id for update;
  if not found or job.lease is distinct from p_lease or job.status<>'sending' then return; end if;
  update private.hub_secretary_replies set
    status=case when p_status='rate_limited' then case when attempts<4 then 'pending' else 'failed' end else p_status end,
    provider_id=case when p_status='sent' then p_provider_id else null end,
    reason=case when p_status='sent' then null else p_status end,
    available_at=clock_timestamp()+make_interval(secs=>60*job.attempts), updated_at=clock_timestamp()
  where id=job.id;
end $$;

-- ----------------------------------------------------------------------------
-- Wrappers públicos (security invoker, como public.hub_secretary_runtime) e
-- privilégios mínimos explícitos.
-- ----------------------------------------------------------------------------
create or replace function public.hub_secretary_ai_get(p_company_id bigint)
returns jsonb language sql security invoker set search_path = '' as
$$ select private.hub_secretary_ai_get(p_company_id) $$;
create or replace function public.hub_secretary_ai_save(
  p_company_id bigint, p_enabled boolean, p_tone text, p_base_prompt text
) returns jsonb language sql security invoker set search_path = '' as
$$ select private.hub_secretary_ai_save(p_company_id, p_enabled, p_tone, p_base_prompt) $$;
create or replace function public.hub_secretary_ai_runtime(p_company_id bigint)
returns jsonb language sql security invoker set search_path = '' as
$$ select private.hub_secretary_ai_runtime(p_company_id) $$;
create or replace function public.hub_secretary_resolve_sender(p_instance text, p_phone text)
returns jsonb language sql security invoker set search_path = '' as
$$ select private.hub_secretary_resolve_sender(p_instance, p_phone) $$;
create or replace function public.hub_secretary_finalize(
  p_instance text, p_phone text, p_event_id text, p_body text, p_command jsonb
) returns jsonb language sql security invoker set search_path = '' as
$$ select private.hub_secretary_finalize(p_instance, p_phone, p_event_id, p_body, p_command) $$;
create or replace function public.hub_secretary_claim_reply(p_instance text)
returns jsonb language sql security invoker set search_path = '' as
$$ select private.hub_secretary_claim_reply(p_instance) $$;
create or replace function public.hub_secretary_finish_reply(
  p_id uuid, p_lease uuid, p_status text, p_provider_id text
) returns void language sql security invoker set search_path = '' as
$$ select private.hub_secretary_finish_reply(p_id, p_lease, p_status, p_provider_id) $$;

-- UI de configuração: somente usuários autenticados (a função valida o papel).
revoke all on function public.hub_secretary_ai_get(bigint) from public, anon;
revoke all on function public.hub_secretary_ai_save(bigint, boolean, text, text) from public, anon;
grant execute on function public.hub_secretary_ai_get(bigint) to authenticated;
grant execute on function public.hub_secretary_ai_save(bigint, boolean, text, text) to authenticated;

-- Operações internas: somente service_role. anon/authenticated NÃO podem
-- resolver remetentes, finalizar eventos nem operar o outbox de respostas.
revoke all on function public.hub_secretary_ai_runtime(bigint) from public, anon, authenticated;
revoke all on function public.hub_secretary_resolve_sender(text, text) from public, anon, authenticated;
revoke all on function public.hub_secretary_finalize(text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.hub_secretary_claim_reply(text) from public, anon, authenticated;
revoke all on function public.hub_secretary_finish_reply(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.hub_secretary_ai_runtime(bigint) to service_role;
grant execute on function public.hub_secretary_resolve_sender(text, text) to service_role;
grant execute on function public.hub_secretary_finalize(text, text, text, text, jsonb) to service_role;
grant execute on function public.hub_secretary_claim_reply(text) to service_role;
grant execute on function public.hub_secretary_finish_reply(uuid, uuid, text, text) to service_role;

-- === pglite-core-end ===

-- ============================================================================
-- PATCH DE ENCAMINHAMENTO (não carregado nos testes offline: usa pg_net/vault)
-- Substitui private.hub_receive_whatsapp adicionando o desvio de mensagens
-- que NÃO são o comando legado para o endpoint do app. O comando legado
-- ACEITAR/RECUSAR+código segue exatamente como hoje.
-- Contrato do endpoint (src/routes/api/public/secretary/interpret.ts):
--   POST /api/public/secretary/interpret
--   headers: content-type: application/json, x-hub-webhook-secret: <segredo>
--   body: {"phone": string, "eventId": string, "body": string}
-- ============================================================================
--
-- create or replace function private.hub_receive_whatsapp(p_instance text, p_phone text, p_event_id text, p_body text)
--  returns jsonb language plpgsql security definer set search_path to '' as $function$
-- declare company bigint; actor uuid; previous private.hub_whatsapp_incoming; n public.hub_secretary_notices; parts text[]; result jsonb;
--   wh_secret text;
-- begin
--  if p_event_id is null or length(p_event_id) not between 1 and 200 or p_body is null or length(p_body) not between 1 and 500 then raise exception 'Invalid event' using errcode='22023';end if;
--  select c.id_empresa,r.member_id into company,actor from public.hub_whatsapp_channels c
--  join private.hub_whatsapp_recipients r on r.id_empresa=c.id_empresa and r.enabled
--  join public.crm_users u on u.id=r.member_id and u.id_empresa=r.id_empresa and u.active and u.role in ('agent','corretor')
--  join public.hub_company_modules m on m.id_empresa=c.id_empresa and m.crm
--  where c.instance=p_instance and c.enabled and r.phone=p_phone;
--  if actor is null then return jsonb_build_object('status','ignored');end if;
--  perform pg_advisory_xact_lock(hashtextextended(company::text||p_event_id,44));
--  select * into previous from private.hub_whatsapp_incoming where id_empresa=company and event_id=p_event_id;
--  if found then
--   if previous.member_id<>actor or previous.body<>p_body then raise exception 'Event reused' using errcode='22023';end if;
--   return previous.result;
--  end if;
--  parts:=regexp_match(upper(btrim(p_body)),'^(ACEITAR|RECUSAR)[[:space:]]+([A-F0-9]{12})$');
--  if parts is null then
--   -- NOVO: mensagem livre -> interpretação de texto no app (fase 1).
--   select h.decrypted_secret into wh_secret
--     from private.hub_whatsapp_transport t
--     join vault.decrypted_secrets h on h.id=t.webhook_secret
--    where t.id_empresa=company;
--   if wh_secret is not null and length(wh_secret) between 32 and 512 then
--     perform net.http_post(
--       url := 'https://hub.katsuki.com.br/api/public/secretary/interpret',
--       headers := jsonb_build_object('content-type','application/json','x-hub-webhook-secret', wh_secret),
--       body := jsonb_build_object('phone', p_phone, 'eventId', p_event_id, 'body', p_body));
--   end if;
--   return jsonb_build_object('status','forwarded');
--  else
--   select n1.* into n from public.hub_secretary_notices n1 join public.hub_whatsapp_outbox o on o.notice_id=n1.id
--   where n1.code=parts[2] and n1.id_empresa=company and n1.member_id=actor and o.attempts>0 and o.status in('sending','sent','uncertain');
--   if not found then result:=jsonb_build_object('status','not_found','message','Aviso indisponível para este remetente.');
--   else
--    result:=private.hub_respond_sales_offer_as(n.offer_id,case when parts[1]='ACEITAR' then 'accept' else 'decline' end,actor);
--    result:=result||jsonb_build_object('message',case result->>'status' when 'accepted' then 'Oferta aceita pelo WhatsApp.' when 'declined' then 'Oferta recusada pelo WhatsApp.' when 'expired' then 'Prazo encerrado; resposta não atribuiu a oportunidade.' else 'Oferta encerrada.' end);
--   end if;
--  end if;
--  insert into private.hub_whatsapp_incoming(id_empresa,event_id,member_id,body,result) values(company,p_event_id,actor,p_body,result);
--  insert into public.hub_secretary_responses(id_empresa,member_id,request_id,body,notice_id,result,channel) values(company,actor,gen_random_uuid(),p_body,n.id,result,(select provider from public.hub_whatsapp_channels where id_empresa=company));
--  return result;
-- end $function$;
--
-- ROLLBACK (texto original, sem o desvio): reaplicar a definição atual de
-- private.hub_receive_whatsapp exatamente como está no banco — o trecho
-- "if parts is null then result:=jsonb_build_object('status','invalid_command',...)
-- ..." sem o bloco "NOVO" acima. A definição original completa está preservada
-- no histórico de revisões do banco e foi lida em 2026-10-24 para conferência.
