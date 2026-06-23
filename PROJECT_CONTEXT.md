# Contexto do Projeto - Katsuki CRM

Atualizado em: 23/06/2026

## Visao geral

O Katsuki CRM e um CRM imobiliario multi-tenant para concentrar leads recebidos por cadastro manual, CSV, Meta Lead Ads, RD Station Marketing e futuras APIs externas.

- Repositorio: `Katsuki-IA/lar-sync-crm`
- Branch principal: `main`
- Aplicacao: `https://hub.katsuki.com.br`
- Hospedagem e sincronizacao visual: Lovable
- Banco, autenticacao e backend serverless: Supabase
- Supabase project ref: `tswdxgefmhjvjwafaxjl`
- Ultimo commit conhecido ao criar este documento: `6197227`

O GitHub e a fonte canonica do codigo. Alteracoes enviadas para `main` devem ser sincronizadas pelo Lovable. Edge Functions e migrations precisam ser publicadas separadamente no Supabase.

## Stack

- React 19
- TanStack Start e TanStack Router
- TypeScript
- Vite
- Tailwind CSS
- TanStack Query
- Supabase Auth, Postgres, RLS e Edge Functions
- Radix UI e Lucide Icons

## Modelo multi-tenant

Cada usuario do CRM esta associado a uma empresa por `crm_users.id_empresa`.

Papeis usados atualmente:

- `super_admin`: administra empresas e usuarios.
- `manager`: gestor da empresa e configuracoes.
- `agent`: nivel operacional abaixo do gestor.

Todos os dados sensiveis devem ser filtrados no banco por `id_empresa`. Nao confiar apenas em filtros do frontend. Edge Functions administrativas usam o usuario autenticado para descobrir a empresa e usam `service_role` somente depois dessa validacao.

## Leads

Tabela principal: `public.crm_leads`.

Campos padrao relevantes:

- Nome
- Telefone
- Email
- Empreendimento (`id_empreendimento`)
- Estagio (`crm_stage_id`)
- Responsavel (`crm_assigned_to`)
- Origem
- Status, tags, observacoes e feedback

### Telefone

- Telefones brasileiros sao normalizados para somente digitos no formato `55DDDNUMERO`.
- O valor original vindo da integracao deve permanecer no `raw_data` do evento.
- A deduplicacao considera telefone normalizado dentro da mesma empresa.
- Uma nova conversao de telefone ja existente nao deve apagar o historico: o lead existente e reutilizado e uma nova atividade/evento e registrada.

### Origem

Existe uma lista padronizada de codigos, incluindo `FB`, `IG`, `GO`, `WA`, `MP`, `OU`, `ND` e outros. O valor padrao e `ND` quando nenhuma origem valida e informada.

### Campos personalizados

Migrations e tabelas:

- `crm_lead_custom_fields`: definicao por empresa.
- `crm_lead_custom_values`: valores por lead.

Tipos atuais:

- Texto
- Select
- Checkbox

Cada campo pode ter nome, ordem, obrigatoriedade, opcoes e status ativo. O gestor configura em `Configuracoes > Campos personalizados`. O cadastro e detalhe do lead ja usam esses campos.

## Integracao Meta Lead Ads

Fluxo:

1. Gestor conecta sua conta Meta por OAuth.
2. O CRM lista paginas e formularios acessiveis.
3. O gestor abre um formulario, seleciona o empreendimento e combina os campos Meta com os campos padrao do CRM.
4. A Meta envia eventos `leadgen` ao webhook.
5. A Edge Function busca os dados completos do lead, normaliza telefone e insere ou reaproveita o lead.

Tabelas principais:

- `crm_meta_connections`
- `crm_meta_forms`
- `crm_meta_field_mapping`
- `crm_meta_leads`

Edge Functions:

- `meta-oauth-start`
- `meta-oauth-callback`
- `meta-oauth-exchange`
- `meta-integration-status`
- `meta-forms-sync`
- `meta-form-fields`
- `meta-field-mapping-save`
- `meta-webhook`
- `meta-disconnect`
- `meta-test-lead`

Secrets necessarios no Supabase:

- `META_APP_ID`
- `META_APP_SECRET`
- `META_WEBHOOK_VERIFY_TOKEN`
- `META_REDIRECT_URI`
- `META_GRAPH_VERSION` (opcional)
- `APP_ORIGIN`

Valores de URL esperados em producao:

- `APP_ORIGIN=https://hub.katsuki.com.br`
- `META_REDIRECT_URI=https://hub.katsuki.com.br/`
- Callback do webhook: `https://tswdxgefmhjvjwafaxjl.supabase.co/functions/v1/meta-webhook`

O app Meta precisa das permissoes necessarias para paginas, formularios, leitura de leads e gerenciamento de webhook. Em producao, as permissoes precisam passar pela analise da Meta quando exigido.

O card da Meta mostra quantidade processada e ultimo evento com base em `crm_meta_leads`.

## Integracao RD Station Marketing

Fluxo:

1. Gestor conecta uma conta RD por OAuth.
2. O CRM cria uma assinatura `WEBHOOK.CONVERTED` para contatos.
3. O CRM consulta ativos de conversao recentes da RD e apresenta formularios/LPs para vinculo.
4. Cada `event_identifier` pode ser associado a um empreendimento diferente.
5. Uma conversao sem vinculo fica como `pending_mapping` e e reprocessada depois que o vinculo e salvo.
6. Conversoes sem identificador usam o empreendimento padrao da conexao.

Tabelas principais:

- `crm_rd_connections`
- `crm_rd_events`
- `crm_rd_source_mappings`

Edge Functions:

- `rd-oauth-start`
- `rd-oauth-callback`
- `rd-oauth-exchange`
- `rd-integration-status`
- `rd-assets-sync`
- `rd-settings-save`
- `rd-source-mapping-save`
- `rd-webhook`
- `rd-disconnect`

Secrets necessarios no Supabase:

- `RD_CLIENT_ID`
- `RD_CLIENT_SECRET`
- `RD_REDIRECT_URI`
- `APP_ORIGIN`

Valores de URL esperados em producao:

- `APP_ORIGIN=https://hub.katsuki.com.br`
- `RD_REDIRECT_URI=https://hub.katsuki.com.br/integracoes/rd`

A sincronizacao de ativos consulta a API de estatisticas de conversao dos ultimos 45 dias, limite documentado para contas RD Pro. Ativos nao retornados nessa consulta ainda sao descobertos quando enviam sua primeira conversao.

Pode existir atraso entre o envio de uma LP e a entrega do webhook pela RD. Verificar `crm_rd_events`, o resumo da integracao e os logs de `rd-webhook` antes de concluir que houve falha.

## Seguranca

Regras obrigatorias:

- Nunca colocar app secrets, access tokens ou `service_role` no frontend.
- Secrets ficam somente em Supabase Edge Function Secrets.
- Nunca commitar `.env` com credenciais.
- Todas as operacoes de leads devem respeitar `id_empresa` via RLS ou backend autenticado.
- Webhooks publicos devem validar token, assinatura ou segredo da conexao.
- Tokens de integracao nao devem ser retornados pelas funcoes de status.

Migrations especificas ja endurecem Meta, campos personalizados e partes do CRM. Isso nao significa que todas as tabelas legadas ou buckets estejam auditados. Ainda e necessario executar uma auditoria completa de RLS, grants e Storage, principalmente nas tabelas antigas apontadas pelo scanner do Lovable.

## Deploy

### Frontend

```bash
npm run build
git add <arquivos>
git commit -m "Descricao"
git push origin main
```

Depois confirmar a sincronizacao do Lovable com `origin/main`.

### Supabase

Executar na raiz do repositorio:

```bash
npx supabase login
npx supabase link --project-ref tswdxgefmhjvjwafaxjl
npx supabase db push
npx supabase functions deploy NOME_DA_FUNCAO
```

O aviso `Docker is not running` durante o deploy de uma Edge Function nao impede necessariamente a publicacao remota.

Arquivos em `supabase/.temp/` nao devem ser commitados.

## Validacao antes de concluir alteracoes

```bash
npx eslint <arquivos alterados>
npx tsc --noEmit
npm run build
git diff --check
git status --short
```

Em alteracoes de Edge Functions, publicar a funcao alterada e validar os logs no Supabase Dashboard.

## Pontos de atencao atuais

1. As URLs antigas `lar-sync-crm.lovable.app` ainda existem em algumas Edge Functions como fallback de codigo. Os secrets de producao devem prevalecer, mas o ideal e substituir esses fallbacks por `hub.katsuki.com.br`.
2. A auditoria RLS completa de todas as tabelas legadas e buckets ainda precisa ser feita.
3. O botao de criar lead teste da Meta deve ser removido da interface quando a fase de testes terminar.
4. Campos personalizados ainda nao fazem parte do mapeamento externo Meta/RD; atualmente essas integracoes mapeiam principalmente campos padrao.
5. Antes de liberar o CRM para clientes externos, concluir revisao/permissoes de producao dos aplicativos Meta e RD.
6. Manter testes de deduplicacao por empresa e telefone para todas as novas fontes de lead.

## Estado funcional conhecido

- Cadastro manual de leads funcionando.
- Importacao e exportacao CSV existentes.
- Lista, filtros, Kanban e detalhes de lead existentes.
- Empresas e usuarios multi-tenant existentes.
- Campos personalizados implementados.
- Origem padronizada implementada.
- Meta OAuth, paginas, formularios, mapeamento, webhook e lead teste funcionando.
- RD OAuth, ativos, vinculo por empreendimento, webhook e entrada de lead funcionando.
- Botoes e cards de integracao Meta/RD seguem padrao visual semelhante.

## Como retomar em uma nova sessao

Use uma solicitacao semelhante a:

> Leia `PROJECT_CONTEXT.md`, confirme o estado atual do `main`, verifique `git status` e continue o desenvolvimento sem expor secrets nem quebrar o isolamento multi-tenant.

Antes de editar, comparar este documento com o codigo e com as migrations mais recentes, pois o codigo sempre prevalece quando houver divergencia.
