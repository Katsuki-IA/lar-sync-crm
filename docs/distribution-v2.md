# Filas de distribuição — candidato

Implementação na branch `codex/distribution-workspace`. Instalada somente no Supabase temporário `esdqsdwhhihxmubunwvb` em 2026-10-24, migração `distribution_queue_rules_and_schedule`. Não instalada em produção nem publicada no HUB.

## Comportamento

- Lista de filas, regras da fila selecionada, corretores, aguardando aceite e oportunidades aguardando distribuição.
- Empreendimento específico ou todos. Dentro desse filtro, qualificação IA OU etapa IA selecionada habilita a entrada automática.
- Rodízio entre corretores ativos e não pausados. Pausar na fila não desativa o usuário.
- Dias e horário de Brasília; início inclusivo e fim exclusivo, sem atravessar a meia-noite.
- Fila específica tem preferência sobre geral; depois prioridade crescente e identificador para desempate.
- Sem fila disponível, a oportunidade aguarda. Rodada esgotada tenta novamente após 30 minutos. Cancelamento manual remove a espera.
- Ofertas já enviadas conservam o prazo, inclusive fora do horário. A próxima oferta aguarda a abertura.
- Secretária permanece em Configurações. Não há novos envios, credenciais ou integração n8n nesta alteração.
- Recebidos conta ofertas registradas, não confirmação de entrega WhatsApp. Tempo médio mede aceite. Estatísticas usam histórico completo; lista de espera mostra até 100 registros mais antigos.

## Limite da entrada automática

O motor captura **oportunidades comerciais sem responsável** criadas a partir da instalação e reavalia oportunidades existentes quando qualificação, etapa IA ou empreendimento do lead muda. Não cria oportunidades automaticamente para todo lead IA e não importa retroativamente a base antiga. A passagem de lead IA para oportunidade comercial precisa existir no fluxo usado pela empresa.

## Banco e instalação

`distribution-v2-candidate.sql` contém a transação instalada em homologação; `distribution-v2-original-functions.sql` preserva as definições consultadas do servidor para revisão.

A migração adiciona regras, pausa individual e espera privada, e integra o roteamento ao worker existente. As filas existentes começam sem gatilhos automáticos e sem restrição de horário. Distribuições automáticas recebem `origin=automatic` e autor nulo; manuais continuam exigindo autor. Essa distinção evita atribuir uma ação do servidor a uma pessoa.

Antes de instalar: testar em homologação com o esquema completo, validar concorrência entre workers/aceite/edição e confirmar o agendamento existente. A suíte PGlite testa SQL real em esquema mínimo, mas não substitui essa validação de concorrência no servidor. Aplicar a migração antes de publicar a interface; sem o novo RPC, a interface informa indisponibilidade das novas regras.

Para reverter operação, primeiro desligar os gatilhos automáticos e resolver/cancelar ofertas pendentes. Não executar as funções antigas cegamente: elas não conhecem horários nem pausas. Preparar reversão compatível com os registros existentes antes de remover colunas.

## Verificação local

TypeScript e build passaram. A suíte inclui cenários de horários, isolamento de empresa, pausa, espera, cancelamento, concorrência lógica por revisão, idempotência, falha isolada e autoria automática. O build local de validação usa chave fictícia e não é artefato para deploy.

Prévia com dados fictícios: executar `node node_modules/vite/bin/vite.js --config scripts/queue-preview.vite.ts` e abrir `/scripts/queue-preview.html`. Não conecta ao banco nem envia WhatsApp.

## Validação remota em 2026-10-24

Ensaio transacional com ROLLBACK na empresa fictícia 5 (Ensaio navegador IA + CRM): criação via RPC de fila com gatilho de etapa IA, criação de oportunidade via RPC, entrada na espera, ausência de distribuição fora do horário, oferta automática ao abrir o horário, autoria automática e ausência de duplicação após segunda execução. O RPC de visão geral também executou sem erro. Nenhum registro do ensaio foi persistido; nenhuma mensagem foi enviada.

A instalação teve uma primeira resposta de conector inválida/expirada. A consulta confirmou ausência dos novos objetos antes da repetição; a segunda aplicação retornou sucesso.

Bloqueios de publicação identificados:

- Produção não tem agendamento cron encontrado para o worker e `private.sales_worker_runs` está vazio. Não assumir que existe execução recorrente externa.
- O destino comercial precisa ser definido para criar oportunidades a partir dos gatilhos IA. Foi solicitada a preferência entre seleção de funil por fila e funil padrão da empresa.
- O ensaio de duas chamadas MCP concorrentes não provou sobreposição das sessões: a segunda completou após a primeira. Portanto concorrência real ainda não foi validada.

Não publicar como fluxo automático completo até resolver esses pontos. A autorização do usuário para publicar foi condicionada à validação bem-sucedida.
