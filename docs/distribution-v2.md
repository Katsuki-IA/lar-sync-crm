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

## Entrada automática e funil de destino

O usuário escolheu funil comercial por fila. `distribution-v3-intake.sql` captura novos leads e mudanças de qualificação, etapa IA ou empreendimento, somente com CRM habilitado. Uma fila ativa compatível cria a oportunidade na primeira etapa ativa do funil escolhido; horário e corretores disponíveis controlam a oferta. Sem fila compatível, o lead aguarda. A unicidade por empresa, lead e funil preserva oportunidades existentes, inclusive seus responsáveis. Não há importação retroativa da base antiga. A autoria de criação automática é registrada como `creation_origin=queue`, sem atribuição a usuário humano.

## Banco e instalação

`distribution-v2-candidate.sql` contém a transação instalada em homologação; `distribution-v2-original-functions.sql` preserva as definições consultadas do servidor para revisão.

A migração adiciona regras, pausa individual e espera privada, e integra o roteamento ao worker existente. As filas existentes começam sem gatilhos automáticos e sem restrição de horário. Distribuições automáticas recebem `origin=automatic` e autor nulo; manuais continuam exigindo autor. Essa distinção evita atribuir uma ação do servidor a uma pessoa.

Aplicar v2, v3 e o agendamento antes de publicar a interface. `distribution-v3-schedule.sql` agenda o worker a cada minuto. A suíte PGlite testa SQL real; o ensaio remoto valida o esquema completo. As regras existentes começam sem gatilhos automáticos. Não ativar regras reais durante a instalação.

Para reverter operação, primeiro desligar os gatilhos automáticos e resolver/cancelar ofertas pendentes. Não executar as funções antigas cegamente: elas não conhecem horários nem pausas. Preparar reversão compatível com os registros existentes antes de remover colunas.

## Verificação local

TypeScript e build passaram. A suíte inclui cenários de horários, isolamento de empresa, pausa, espera, cancelamento, concorrência lógica por revisão, idempotência, falha isolada e autoria automática. O build local de validação usa chave fictícia e não é artefato para deploy.

Prévia com dados fictícios: executar `node node_modules/vite/bin/vite.js --config scripts/queue-preview.vite.ts` e abrir `/scripts/queue-preview.html`. Não conecta ao banco nem envia WhatsApp.

## Validação remota em 2026-10-24

Ensaio transacional com ROLLBACK na empresa fictícia 5 (Ensaio navegador IA + CRM): criação via RPC de fila com gatilho de etapa IA, criação de oportunidade via RPC, entrada na espera, ausência de distribuição fora do horário, oferta automática ao abrir o horário, autoria automática e ausência de duplicação após segunda execução. O RPC de visão geral também executou sem erro. Nenhum registro do ensaio foi persistido; nenhuma mensagem foi enviada.

A instalação teve uma primeira resposta de conector inválida/expirada. A consulta confirmou ausência dos novos objetos antes da repetição; a segunda aplicação retornou sucesso.

Resultado da complementação:

- Confirmada ausência de agendamento e histórico do worker em produção. Novo cron instalado em homologação; execução observada com status `succeeded`.
- Seleção de funil por fila implementada conforme escolha do usuário. Ensaio transacional no esquema completo confirmou mudança de etapa do lead → oportunidade no funil 7/etapa 25 → oferta única; segunda execução não duplicou. ROLLBACK desfez os dados de teste.
- TypeScript e build passaram; 224 testes passaram em 22 arquivos.
- O ensaio de duas chamadas MCP concorrentes não provou sobreposição das sessões: a segunda completou após a primeira. Portanto concorrência real ainda não foi validada.

## Instalação em produção pendente de aprovação específica

A chamada de instalação em produção foi rejeitada pela revisão automática: a autorização para publicar após validação não foi considerada suficiente para alterações compartilhadas no banco de todos os tenants e ativação do worker. Não houve contorno do bloqueio nem publicação da interface. A instalação proposta aplica v2 + v3 + agendamento em uma transação, sem ativar gatilhos das filas existentes, importar leads antigos, trocar credenciais ou alterar n8n. Exige confirmação explícita desse alcance pelo usuário.
