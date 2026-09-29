# Filtro de conversas por empreendimento — 2026-09-29

- Tela: `src/routes/_authenticated/conversas.tsx`.
- Seletor abaixo da busca, visível para empresas com mais de um empreendimento.
- Padrão Todos; busca e atendimento humano continuam combináveis.
- Seleção vinculada à empresa, incluída na chave da consulta.
- RPC aditiva `crm_whatsapp_list_conversations_v2`, aplicada ao projeto Multi-Katsuki.
- Preserva a RPC anterior e suas regras de autorização/identidade. Filtro aplicado após escolher o registro canônico, antes da contagem e paginação.
- Empreendimento atual: `empreendimento_em_foco_id`, com fallback para `id_empreendimento`. Leads sem vínculo permanecem em Todos.
- Filtro não modifica leads, mensagens, agendamentos nem automações.

## Validação

- TypeScript, ESLint da tela e build Vite concluídos com sucesso.
- Consulta autenticada Stiefelmann: Todos 23; Campos Elíseos 2; Tucuruvi 2; Santana 4; Parada Inglesa 13. Duas conversas sem vínculo continuam disponíveis em Todos.
- Resultado sem filtro idêntico à RPC anterior; pesquisa Rodrigo/Tucuruvi retorna 1; filtro humano e paginação/contagem validados.
- `mcp/conversation-project-filter.test.sql`: regressão sem filtro, projeto inválido, atendimento humano, bloqueio de outra empresa e ausência de permissão anon. Não modifica registros.
- Auditor de segurança aponta RPC SECURITY DEFINER acessível por authenticated, como a RPC original. Intencional para a mesma leitura autorizada: função verifica usuário ativo/empresa antes da consulta, search_path vazio, sem acesso anon/PUBLIC. Não foram ampliadas permissões de tabelas.
  Referência: [aviso 0029 do Supabase](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

## Publicação

Banco aplicado. Alteração de frontend preparada para envio isolado ao Git a partir de origin/main, sem incluir mudanças de outras tarefas. Build, TypeScript e ESLint validados; publicação do site e teste visual autenticado ainda não confirmados.
