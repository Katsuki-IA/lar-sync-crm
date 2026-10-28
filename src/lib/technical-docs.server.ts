import type { TechnicalDocs } from "./technical-docs.types";

// Curated documentation only. Never read env values, credentials or tenant records here.
// Kept out of public assets; loaded only after the server checks the current CRM role.
export const technicalDocs: TechnicalDocs = {
  reviewedAt: "28/10/2026",
  scope:
    "Inventário do código do HUB e das referências operacionais disponíveis. Não é monitoramento em tempo real. Recursos presentes no código não comprovam ativação em todas as empresas; confira os pontos pendentes antes de uma transferência técnica.",
  maps: [
    {
      title: "Arquitetura da plataforma",
      description:
        "O navegador usa o cliente Supabase com as permissões do usuário; operações privilegiadas passam pelo servidor.",
      steps: [
        {
          title: "Usuário • HUB",
          text: "React + TanStack Router: leads, conversas, funis, tarefas e relatórios.",
        },
        {
          title: "Camada de acesso",
          text: "Supabase Auth + RLS para acesso direto; funções TanStack e Edge Functions para operações de backend.",
        },
        {
          title: "Supabase • PostgreSQL",
          text: "Dados por empresa, funções SQL, histórico, filas, Storage e Realtime.",
        },
        {
          title: "Serviços externos",
          text: "n8n, Meta/WhatsApp, RD e CRMs conectados processam eventos e retornam resultados.",
        },
      ],
    },
    {
      title: "Do lead ao atendimento",
      description:
        "Mapa conceitual. A rota efetiva depende dos módulos e configurações da empresa.",
      steps: [
        {
          title: "Captação",
          text: "Meta Lead Ads, RD Marketing, formulário externo, cadastro manual ou CSV.",
        },
        {
          title: "Identificação",
          text: "Empresa + telefone normalizado; vínculo com empreendimento e origem; reaproveitamento de lead existente.",
        },
        {
          title: "Atendimento e histórico",
          text: "WhatsApp e automações; mensagens, atividades, qualificação e eventos de entrega.",
        },
        {
          title: "Destino comercial",
          text: "CRM externo ou funil interno configurado; filas, corretor e acompanhamento da oportunidade.",
        },
      ],
    },
    {
      title: "Como uma alteração chega à produção",
      description: "Frontend, banco e automações têm ciclos de publicação separados.",
      steps: [
        {
          title: "Código + revisão",
          text: "Alteração isolada no GitHub, testes e revisão de diferenças.",
        },
        {
          title: "Homologação",
          text: "Validar interface, permissões e SQL com dados fictícios e serviços de teste.",
        },
        {
          title: "Publicação coordenada",
          text: "Main sincronizada no Lovable; publicar o site. Aplicar migrations e Edge Functions quando necessárias.",
        },
        {
          title: "Verificação",
          text: "Conferir domínio, versão, login, isolamento por empresa e logs. n8n é publicado separadamente.",
        },
      ],
    },
  ],
  sections: [
    {
      id: "ambientes",
      title: "Projetos, endereços e ambientes",
      summary: "Onde ficam o sistema, o código e as ferramentas de operação.",
      entries: [
        {
          title: "HUB • produção",
          text: "Aplicação utilizada pelas empresas. O domínio público exige autenticação para as áreas internas.",
          href: "https://hub.katsuki.com.br",
          source: "PROJECT_CONTEXT.md; docs/commercial-settings.md",
        },
        {
          title: "GitHub • código canônico",
          text: "Katsuki-IA/lar-sync-crm · branch principal: main. Inclui interface, funções de servidor, Edge Functions, migrations e documentação. Credenciais e workflows ativos do n8n não devem ser presumidos como versionados aqui.",
          href: "https://github.com/Katsuki-IA/lar-sync-crm",
          source: "Git remote; PROJECT_CONTEXT.md",
        },
        {
          title: "Lovable • Hub | Katsuki IA",
          text: "Projeto 49e843b7-5b71-4684-91bf-93d45886e53a. Editor e publicação do HUB. Metadados consultados em 28/10/2026: projeto publicado; revisão sincronizada 96aca941c12bcbfd68bec340e409e91dca362422. Esta revisão é uma referência da consulta, não um indicador da versão atual.",
          href: "https://lovable.dev/projects/49e843b7-5b71-4684-91bf-93d45886e53a",
          source: "Metadados do projeto Lovable",
        },
        {
          title: "Supabase • Multi-Katsuki",
          text: "Projeto de produção: tswdxgefmhjvjwafaxjl. API: https://tswdxgefmhjvjwafaxjl.supabase.co. Banco, Auth, Storage, Realtime, funções e logs ficam neste projeto.",
          href: "https://supabase.com/dashboard/project/tswdxgefmhjvjwafaxjl",
          source: "supabase/config.toml; docs/commercial-settings.md",
        },
        {
          title: "Homologação",
          text: "Referência de banco de ensaio: esdqsdwhhihxmubunwvb. Confirmar disponibilidade e configuração antes de usar. Preview do Lovable não garante isolamento: conferir sempre a URL do Supabase e os destinos dos webhooks.",
          href: "https://supabase.com/dashboard/project/esdqsdwhhihxmubunwvb",
          source: "docs/distribution-v2.md; docs/commercial-settings.md",
        },
        {
          title: "n8n • automações",
          text: "Há referência a n8n2.katsuki.com.br no envio de relatórios. Consultar workflows e credenciais no n8n; a existência de um script no repositório não comprova que seja o workflow ativo.",
          href: "https://n8n2.katsuki.com.br",
          source: "src/lib/journey-report.functions.ts; docs/n8n-edge-functions.md",
        },
        {
          title: "Painel Katsuki IA • projeto separado",
          text: "Projeto b001a40f-f86d-4283-a1ba-ba1a585d601d, voltado a dados e automações. Não confundir seu editor com o projeto do HUB.",
          href: "https://lovable.dev/projects/b001a40f-f86d-4283-a1ba-ba1a585d601d",
          source: "Metadados Lovable; docs/followups-v2.md",
        },
      ],
    },
    {
      id: "stack",
      title: "Stack e organização do código",
      summary: "Tecnologias declaradas no projeto e responsabilidade de cada camada.",
      entries: [
        {
          title: "Interface",
          text: "React 19 e TypeScript. TanStack Router organiza as rotas em arquivos; TanStack Query administra consultas e cache. Tailwind CSS 4, Radix UI, componentes locais, Lucide e Recharts compõem a apresentação.",
          source: "package.json; src/routes; src/components/ui",
        },
        {
          title: "Servidor e build",
          text: "TanStack Start fornece funções de servidor e renderização. Vite 7 e @lovable.dev/vite-tanstack-config compõem o build; o preset inclui Nitro com alvo Cloudflare. src/server.ts trata falhas SSR. Não adicionar plugins duplicados ao preset.",
          source: "vite.config.ts; src/start.ts; src/server.ts",
        },
        {
          title: "Backend de dados",
          text: "Supabase com PostgreSQL, Auth, RLS, RPCs SQL, Edge Functions em TypeScript/Deno, Storage e Realtime. As dependências declaradas não substituem as versões resolvidas nos lockfiles; a versão do Postgres em produção deve ser consultada no projeto.",
          source: "package.json; supabase; src/integrations/supabase",
        },
        {
          title: "Mapa de pastas",
          text: "src/routes: páginas e endpoints. src/components: interface. src/lib: regras e funções de servidor. src/integrations/supabase: clientes, autenticação e tipos. supabase/functions: integrações HTTP. supabase/migrations: evolução SQL. docs: contratos e procedimentos. mcp e scripts: utilitários de operação, alguns com efeitos reais.",
          source: "Árvore do repositório",
        },
        {
          title: "Contratos de execução",
          text: "Arquivos .server.ts permanecem no servidor. Arquivos .functions.ts expõem funções TanStack com middleware. Variáveis VITE_* são públicas. Não importar dados administrativos diretamente em componentes; carregar após autorização no backend.",
          source: "src/lib/config.server.ts; src/integrations/supabase/client.server.ts",
        },
      ],
    },
    {
      id: "dados",
      title: "Banco e modelo de dados",
      summary:
        "Mapa dos principais domínios; consulte tipos e migrations para campos, chaves e políticas completas.",
      entries: [
        {
          title: "Empresas e usuários",
          text: "empresa_dados representa empresas; empreendimento pertence ao contexto da empresa. crm_users associa auth_user_id, id_empresa, role e active. crm_user_company_access concede escopos adicionais ao analista. O isolamento deve ser aplicado por RLS ou por autorização explícita no backend.",
          source: "src/integrations/supabase/types.ts; migrations de acesso do analista",
        },
        {
          title: "Leads e informações comerciais",
          text: "crm_leads concentra leads, empreendimento, etapa e responsável. Campos personalizados usam crm_lead_custom_fields e crm_lead_custom_values; definições globais também existem. crm_lead_attribution guarda atribuição. Telefone normalizado + empresa orientam a deduplicação; não deduplicar globalmente entre empresas.",
          source: "PROJECT_CONTEXT.md; supabase/migrations",
        },
        {
          title: "WhatsApp e conversas",
          text: "wa_messages registra mensagens e eventos de status são processados separadamente. wa_contact_identity_aliases mantém aliases de identidade; wa_crm_sync_queue apoia sincronização. Identidade de contato, entrega de mensagem e responsável comercial são conceitos diferentes.",
          source: "docs/n8n-edge-functions.md; supabase/migrations",
        },
        {
          title: "Captação e integrações",
          text: "Meta: crm_meta_connections, crm_meta_forms, crm_meta_field_mapping e crm_meta_leads. RD: crm_rd_connections, crm_rd_events e crm_rd_source_mappings. Eventos e recibos permitem diagnóstico sem depender apenas da tela de leads.",
          source: "PROJECT_CONTEXT.md; supabase/migrations",
        },
        {
          title: "Funil comercial, filas e secretária",
          text: "O domínio hub_* separa oportunidades comerciais do histórico de atendimento IA. Filas selecionam funil de destino, critérios, horários e corretores. Ofertas registram aceite e prazo; espera privada e workers cuidam de reprocessamento. As definições completas estão nos SQLs e RPCs de distribuição.",
          source:
            "docs/distribution-v2.md; docs/distribution-v2-candidate.sql; docs/distribution-v3-intake.sql",
        },
        {
          title: "Follow-ups, alertas e relatórios",
          text: "Follow-up V2 usa enrollments, dispatches, attempts, políticas e eventos de conclusão. Alertas de qualificados usam outbox privada. crm_reporting_integrations armazena escopos, hash e prefixo de token, expiração e revogação; o token completo não é recuperado pela listagem.",
          source:
            "docs/followups-v2.md; docs/qualified-whatsapp-alerts.md; src/lib/reporting.functions.ts",
        },
        {
          title: "Histórico de esquema",
          text: "Nem todo SQL em docs é migration aplicada. Alguns arquivos são candidatos ou ensaios. Antes de executar SQL, comparar o histórico remoto e a definição atual dos objetos; não reaplicar pastas inteiras de scripts operacionais.",
          source: "docs/commercial-settings.md; docs/distribution-v2.md",
        },
      ],
    },
    {
      id: "integracoes",
      title: "Integrações e automações",
      summary: "Entradas, saídas, processamento assíncrono e pontos de diagnóstico.",
      entries: [
        {
          title: "Meta Lead Ads",
          text: "OAuth conecta páginas e formulários; campos são mapeados e associados a empreendimentos. meta-webhook recebe leadgen, busca o lead e normaliza a entrada. meta-forms-sync, meta-form-fields e meta-field-mapping-save dão suporte à configuração; watchdog e recuperação possuem funções próprias.",
          source: "supabase/functions/meta-*; PROJECT_CONTEXT.md",
        },
        {
          title: "RD Station Marketing",
          text: "OAuth e webhook de conversão. O event_identifier pode apontar para um empreendimento. Evento sem vínculo pode ficar pending_mapping para reprocessamento; identificador ausente usa o padrão da conexão. Verificar crm_rd_events e rd-webhook ao investigar atrasos.",
          source: "supabase/functions/rd-*; PROJECT_CONTEXT.md",
        },
        {
          title: "WhatsApp • Meta e Evolution",
          text: "O repositório contém Embedded Signup, envio de conversas e webhooks Meta. Há também referência à Evolution via n8n no envio de imagem de relatório. Conferir o provedor de cada empresa: não assumir que todas usam o mesmo canal. Segredos de token, assinatura e criptografia ficam no backend.",
          source: "supabase/functions/whatsapp-*; src/lib/journey-report.functions.ts",
        },
        {
          title: "Entrada de sites",
          text: "site-lead-capture recebe captação externa. O super admin gerencia formulários em /admin/site-forms. Conferir a configuração da integração e sua empresa antes de testar; usar leads fictícios em homologação.",
          source:
            "supabase/functions/site-lead-capture; src/routes/_authenticated/admin.site-forms.tsx",
        },
        {
          title: "CRMs externos e destino interno",
          text: "external-crms-dispatch centraliza envio; enqueue e worker tratam a fila. Há código e configurações para provedores como CV, RD CRM e Kommo, além de adaptadores externos no dispatcher. O destino interno depende de configuração por empresa. Conferir recibo e histórico antes de repetir um envio, para evitar duplicação no destino.",
          source:
            "supabase/functions/external-crms-*; supabase/functions/kommo-*; docs/commercial-settings.md",
        },
        {
          title: "n8n e contratos internos",
          text: "n8n-wa-message-upsert e n8n-wa-status-event recebem mensagens/status. n8n-agent-empreendimentos e n8n-agent-images fornecem consultas do agente. O contrato documenta x-n8n-secret separado para WhatsApp e ferramentas. Confirmar no n8n quais nodes já adotaram esses endpoints.",
          source: "docs/n8n-edge-functions.md",
        },
        {
          title: "Filas e tarefas agendadas",
          text: "A distribuição considera empresa, empreendimento, etapa/qualificação, prioridade, horário de Brasília e disponibilidade do corretor. Oferta existente conserva seu prazo; nova tentativa respeita janela e pausa. O cron do worker está documentado a cada minuto. Conferir cron e execução remotos ao diagnosticar uma espera.",
          source:
            "docs/distribution-v2.md; docs/distribution-v3-schedule.sql; docs/task-reminders-schedule.sql",
        },
        {
          title: "API de relatórios",
          text: "Integrações têm empresas autorizadas, token com hash, expiração, revogação e controle de requisições. Criar/rotacionar no super admin e compartilhar o token somente com o consumidor autorizado. Contrato completo em docs/reporting-api.md.",
          source: "src/lib/reporting.functions.ts; src/lib/reporting-api.server.ts",
        },
      ],
    },
    {
      id: "ia",
      title: "Inteligência artificial",
      summary:
        "O que está identificado no código; modelos efetivos dependem da configuração do ambiente.",
      entries: [
        {
          title: "DeepSeek • análise de conversas",
          text: "conversation-analysis-classify lê DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL e DEEPSEEK_MODEL. O fallback presente no código é deepseek-v4-flash. Isso descreve a implementação; não comprova o modelo configurado em produção. A referência verbal a “Gipsy” pode ser a este serviço, mas o nome não foi identificado no código consultado.",
          source: "supabase/functions/conversation-analysis-classify/index.ts",
        },
        {
          title: "OpenAI • interpretação da secretária",
          text: "Há implementação server-side com OPENAI_API_KEY, SECRETARY_AI_MODEL e fallback gpt-4o-mini. A saída é limitada a listar, aceitar, recusar ou desconhecido. A execução depende do fluxo transacional e revalida identidade e permissões. O SQL da fase 1 é marcado como candidato: confirmar instalação e ativação antes de tratar como recurso em produção.",
          source: "src/lib/secretary-ai.server.ts; src/lib/secretary-engine.ts; AGENTS.md",
        },
        {
          title: "Agentes de atendimento e prompts",
          text: "Parte da orquestração está no n8n. Modelo, prompt, ferramentas, credenciais e workflow ativo precisam ser conferidos no ambiente de automação. Não deduzir o comportamento ativo apenas de exportações ou scripts locais.",
          source: "docs/n8n-edge-functions.md; diretório mcp",
        },
        {
          title: "Limites das decisões de IA",
          text: "A interpretação de texto não concede permissão nem escolhe identidade do usuário. Autorização, isolamento por empresa, replay, estado da oferta e execução transacional pertencem ao código e ao banco. Novas integrações semânticas devem seguir as instruções do projeto e a skill TypeSafe/Jev quando aplicável; sua existência nas instruções não comprova uso em produção.",
          source: "AGENTS.md; src/lib/secretary-engine.ts",
        },
      ],
    },
    {
      id: "acesso",
      title: "Permissões, credenciais e transferência de acesso",
      summary: "Referências para encontrar e administrar acessos, sem publicar senhas ou tokens.",
      entries: [
        {
          title: "Papéis do HUB",
          text: "super_admin administra escopo global; manager administra a empresa; agent opera o atendimento/comercial; analyst possui acesso de análise conforme escopo concedido. O usuário técnico de IA não deve ser tratado como login humano. A documentação técnica exige super_admin ativo validado no servidor a cada carregamento.",
          source:
            "src/lib/admin.functions.ts; src/lib/config-nav.ts; src/lib/technical-docs.functions.ts",
        },
        {
          title: "Supabase • configuração do servidor",
          text: "SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY configuram o cliente autenticado. SUPABASE_SERVICE_ROLE_KEY (ou APP_SUPABASE_SERVICE_ROLE_KEY no servidor HUB) é privilegiada e não deve aparecer em VITE_*, componentes, HTML, links, capturas ou logs. Revisar secrets do runtime Lovable e das Edge Functions separadamente.",
          source:
            "src/integrations/supabase/auth-middleware.ts; src/integrations/supabase/client.server.ts",
        },
        {
          title: "Meta e WhatsApp • nomes de secrets",
          text: "META_APP_ID, META_APP_SECRET, META_WEBHOOK_VERIFY_TOKEN, META_REDIRECT_URI, APP_ORIGIN; WhatsApp usa a família META_WHATSAPP_*, incluindo chave de criptografia e verificação. Administrar no painel de secrets do Supabase e no aplicativo Meta. IDs públicos não substituem acesso administrativo ao app.",
          source: "supabase/functions/meta-*; supabase/functions/whatsapp-*",
        },
        {
          title: "RD e CRMs • nomes de secrets",
          text: "RD_CLIENT_ID, RD_CLIENT_SECRET, RD_REDIRECT_URI; RD CRM usa RD_CRM_CLIENT_ID, RD_CRM_CLIENT_SECRET e RD_CRM_REDIRECT_URI. EXTERNAL_CRMS_INTERNAL_SECRET e EXTERNAL_CRMS_WORKER_SECRET protegem processamento interno. Tokens por empresa pertencem às conexões do backend.",
          source: "supabase/functions/rd-*; supabase/functions/external-crms-*",
        },
        {
          title: "IA e n8n • custódia",
          text: "DEEPSEEK_API_KEY fica no ambiente da função; OPENAI_API_KEY no runtime servidor da secretária, quando habilitada. N8N_WHATS_SECRET e N8N_AGENT_SECRET são documentados para os endpoints internos; credenciais dos nodes ficam no n8n. Ao rotacionar, atualizar consumidores e validar uma execução controlada.",
          source: "docs/n8n-edge-functions.md; implementações de IA",
        },
        {
          title: "Senhas e entrega a outra pessoa",
          text: "Convidar a pessoa com conta própria no GitHub, Lovable, Supabase e n8n. Registrar responsável, função e recuperação em um cofre de senhas compartilhado com acesso restrito. Nome/URL do cofre ainda não informado. Senhas de login do HUB devem ser redefinidas pelo fluxo de autenticação, não recuperadas para exibição nesta página.",
          source: "Procedimento recomendado para transferência técnica",
        },
        {
          title: "Limites de segurança conhecidos",
          text: "A documentação histórica registra auditoria completa de RLS, grants e buckets como pendência. Não interpretar a existência de políticas como certificação de toda a base. Revisar também permissões de apps Meta/RD, escopos de tokens e acessos de colaboradores na transferência.",
          source: "PROJECT_CONTEXT.md · Segurança e pontos de atenção",
        },
      ],
    },
    {
      id: "operacao",
      title: "Desenvolvimento, publicação e recuperação",
      summary: "Roteiro para manter o sistema com rastreabilidade e validar cada camada.",
      entries: [
        {
          title: "Preparar o ambiente local",
          text: "Clonar o repositório, ler AGENTS.md e PROJECT_CONTEXT.md e conferir git status. Instalar dependências usando o gerenciador e lockfile adotados pela revisão. Configurar variáveis localmente sem commitar .env. Usar npm run dev para desenvolvimento e uma base de homologação com dados fictícios.",
          source: "package.json; PROJECT_CONTEXT.md",
        },
        {
          title: "Validar uma alteração",
          text: "Executar testes relevantes com npm test, npx tsc --noEmit, lint dos arquivos alterados, npm run build e git diff --check. Testar também usuário sem sessão, gestor, corretor, analista e super admin; verificar duas empresas distintas. Testes unitários não substituem verificação de RLS e integração remota.",
          source: "package.json; vitest.config.ts; PROJECT_CONTEXT.md",
        },
        {
          title: "Publicar frontend",
          text: "Revisar e integrar somente os arquivos da mudança no GitHub. Confirmar que o projeto correto do Lovable sincronizou a revisão esperada; publicar e verificar hub.katsuki.com.br. Um push não comprova publicação. Não subir builds locais com chaves fictícias usados em validação.",
          source: "docs/commercial-settings.md; docs/distribution-v2.md",
        },
        {
          title: "Publicar banco, funções e n8n",
          text: "Comparar migrations aplicadas e preparar mudanças compatíveis com dados existentes. Homologar SQL antes da produção. Edge Functions precisam de deploy próprio e secrets no ambiente correto. Exportar a versão anterior do workflow n8n antes de alterar nodes. Definir a ordem de implantação para que a interface não dependa de RPCs ainda ausentes.",
          source: "PROJECT_CONTEXT.md; docs/n8n-edge-functions.md",
        },
        {
          title: "Investigar um incidente",
          text: "Registrar horário e fuso, empresa, lead/evento, operação e mensagem de erro sem tokens. Captação: consultar recibos Meta/RD e logs do webhook. WhatsApp: conferir status, identidade e erro do provedor. CRM: conferir fila e recibo de envio antes de repetir. Filas: revisar módulo ativo, regra, janela, pausa, cron e oferta pendente. Interface: versão publicada, sessão e resposta da função.",
          source: "Contratos e documentação operacional em docs",
        },
        {
          title: "Rollback e backup",
          text: "Frontend: selecionar uma revisão conhecida e republicar após checar compatibilidade do banco. Banco: preparar reversão ou correção incremental; não apagar colunas com dados em uso. Consultar backups/PITR e retenção no projeto Supabase, com teste de restauração em ambiente separado. Plano, retenção, RPO e RTO não foram confirmados nesta documentação.",
          source:
            "docs/distribution-v2.md; procedimento de recuperação a validar com o responsável",
        },
        {
          title: "Manter este manual",
          text: "Atualizar src/lib/technical-docs.server.ts quando mudar serviço, domínio, fluxo ou processo de publicação; manter referências e data da revisão. Esta página não consulta segredos nem varre dados de clientes. Revisar as pendências com quem assume a manutenção.",
          source: "src/lib/technical-docs.server.ts",
        },
      ],
    },
    {
      id: "pendencias",
      title: "Checklist de transferência e informações pendentes",
      summary:
        "Itens que precisam de confirmação humana ou consulta ao ambiente, sem preencher lacunas com suposições.",
      entries: [
        {
          title: "Propriedade e responsáveis",
          text: "Confirmar responsáveis por GitHub, Lovable, Supabase, n8n, Meta, RD, domínio/DNS e faturamento. Registrar contato de escalonamento e custodiante do cofre. Provedor do DNS e servidor que hospeda n8n não foram confirmados.",
        },
        {
          title: "Estado real de produção",
          text: "Inventariar workflows ativos e IDs, modelos de IA configurados, integrações habilitadas por empresa, cron jobs, Edge Functions implantadas e divergências entre SQL local e remoto. Não usar dados de produção em demos ou fixtures.",
        },
        {
          title: "Continuidade e custos",
          text: "Confirmar planos, limites, renovação, custo mensal, retenção de logs, política de backup, região do banco e procedimento de recuperação. Realizar um ensaio de restauração e registrar RPO/RTO acordados.",
        },
        {
          title: "Aceite da transferência",
          text: "A nova pessoa deve conseguir acessar os quatro ambientes principais, executar localmente, explicar o fluxo de um lead, localizar um evento nos logs, publicar em homologação e demonstrar que outra empresa não acessa dados indevidos. Revogar acessos temporários ao concluir.",
        },
      ],
    },
  ],
};
