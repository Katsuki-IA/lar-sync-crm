# Tarefas comerciais — tipos, calendário e lembretes

Publicado em produção em 27/10/2026. Commit `d38c766`, deploy Lovable `f627ffb6-bc45-4622-aedc-9bc0db83be6c`. Domínio `hub.katsuki.com.br` confirmado servindo `index-CjKCSnv3.js` e `tasks-DYgFVjOd.js`, com calendário, RPC v2 e opções de lembrete. Migração `commercial_task_types_and_reminders` aplicada em homologação e produção. Worker e webhook ativos em produção (versão 1), ambos rejeitando chamadas sem token com 401. Endpoint provisionado e cron `hub-task-reminders-v1` ativo a cada minuto, com execução confirmada como succeeded. Nenhum canal ou destinatário foi habilitado; nenhum WhatsApp de teste foi enviado. RLS ativa na fila, sem acesso de leitura para authenticated. Os 27 testes e TypeScript passaram após integrar as atualizações recentes de main.

## Experiência

- Tipos: Ligação, WhatsApp, Visita, Reunião, Follow-up e Outro. Tarefas antigas recebem Outro.
- Alternância entre lista e calendário mensal, com edição pelo evento. Calendário carrega todas as páginas do período visível; filtros são mantidos entre visualizações.
- Ordem padrão por prazo crescente e prioridade como desempate. Alternativa de prioridade alta primeiro. Ordenação feita no banco antes de paginar.
- Lista em aberto identifica Atrasadas, Hoje e Próximas. Datas da interface seguem o fuso do navegador, informado na tela.
- Lembrete opcional ao responsável: 5, 15 (padrão ao marcar), 30, 60 ou 1440 minutos antes. Desligado inicialmente.
- Disponibilidade exige canal habilitado, envio automático, verificação de entrada, credenciais de transporte, endpoint instalado, destinatário habilitado e CRM ativo.
- Se criado após o instante de antecedência, mas antes do prazo, fica disponível para o próximo ciclo. Tarefas já vencidas não geram envio. O scheduler verifica a cada minuto; não promete precisão de segundos.

## Ciclo de envio

`private.hub_task_reminders` é uma fila separada das ofertas. Alterar prazo, responsável ou antecedência reagenda. Concluir, cancelar ou desligar o lembrete cancela o que ainda não foi entregue. Editar apenas texto/tipo não repete um aviso já enviado. Reabrir uma tarefa exige prazo futuro para reativar o lembrete.

O claim revalida usuário ativo, empresa, módulo, canal, número cadastrado e acesso atual ao lead/oportunidade. A mensagem usa dados atuais da tarefa e horário explicitamente em Brasília. O corpo contém título, nome do lead, data/hora e link para Tarefas; não envia descrição nem telefone do lead.

Claim e edição bloqueiam tarefa antes da fila. Durante envio confirmado como em andamento (até dois minutos), a edição pede que o usuário tente novamente. Falha ambígua/timeout vira `uncertain` e não é repetida automaticamente; somente HTTP 429 recebe novas tentativas limitadas. Confirmação exige lease correto e empresa vinculada ao token. Não é possível cancelar uma mensagem já entregue ao provedor.

As funções públicas novas usam invoker; validações privilegiadas ficam em private. A API antiga de tarefas é preservada. Campos novos não podem ser gravados diretamente pelo navegador. O serviço de envio usa o contrato existente claim/finish da Secretária; ofertas mantêm seu comportamento e têm teste de regressão.

## Validações

- 27 testes em quatro arquivos passaram: SQL real em PGlite, calendário e contratos HTTP simulados de Evolution/Uazapi e webhook.
- Ensaio transacional em homologação com usuário corretor autenticado: criação, claim pela ponte com token validado no Vault, confirmação simulada, proteção contra duplicação, reagendamento e conclusão/cancelamento. Tudo desfeito por rollback; nenhuma chamada a provedor nesse ensaio.
- Worker de homologação responde 401 sem token. Os serviços validam token próprio no corpo da função, por isso o gateway usa verify_jwt=false. Credenciais são lidas somente no servidor.
- TypeScript, lint dos arquivos alterados e build passaram. Build local usou chave fictícia de validação e não deve ser implantado.
- Advisors não apontaram os novos objetos; há apontamentos preexistentes fora deste escopo.
- Prévia local com dados fictícios validou calendário, edição de tipo/antecedência e persistência no mock. Nenhum WhatsApp real foi enviado. A entrega real depende da configuração e credenciais do canal da empresa.

## Publicação posterior

1. Conferir drift das funções de tarefas/Secretária contra `task-backend-baseline.sql`; aplicar `task-enhancements-candidate.sql` em produção.
2. Implantar os dois serviços de `supabase/functions/hub-secretary-*` com seus módulos compartilhados. Não habilitar um canal nem cadastrar destinatários por conta dessa publicação.
3. Configurar `private.hub_secretary_endpoints` para a base dos serviços implantados. Em produção, o levantamento de 27/10 encontrou a tabela vazia e o worker ausente; isso precisa ser provisionado antes de oferecer disponibilidade real.
4. Publicar frontend e ativar `task-reminders-schedule.sql`. O scheduler seleciona apenas canais já habilitados e verificados com lembretes pendentes, não habilita o envio de nenhuma empresa.
5. Conferir rejeição sem token, RPCs e assets publicados. Um ensaio de entrega real requer um destinatário de teste escolhido pelo usuário.

Prévia reproduzível: `node node_modules/vite/bin/vite.js --config scripts/tasks-preview.vite.ts`, URL `/scripts/tasks-preview.html`.
