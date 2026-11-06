# Estágios IA das campanhas de prospecção

Migração `prospect_ia_stage_projection`, aplicada em 06/11/2026, somente para empresas 35 e 36.

A projeção privada acompanha o cadastro materializado, alterações do contato, comprovantes de envio e encaminhamentos. Mapeia pelos identificadores globais do estágio IA, sem depender do nome exibido:

- Cadastro no HUB sem contato: Base (1).
- Abertura ou apresentação aceita: Contato Feito (2).
- Último follow-up aceito: Follow Up 1/2/3 (8/9/10).
- Encaminhamento registrado ou conversa efetivamente assumida: Enviado ao CRM (13).
- Recusa: Perdido (7).
- Contato interrompido ou tentativa de transporte em revisão: Bloqueio Envio (12).

Não antecipa a criação dos leads ainda existentes apenas na base de importação. Não cria oportunidades nem altera seu estágio comercial. O estágio é atualizado no cadastro CRM usado pelo Kanban e pela lista de Leads. A atualização remove somente a entrada de distribuição gerada como efeito colateral dessa projeção; o encaminhamento das campanhas continua sob o fluxo de prospecção.

Cada alteração registra atividade `kp_ia_stage_sync`. A automação gerencia apenas estágio nulo ou igual à última projeção registrada. Um estágio escolhido manualmente é preservado. Configuração ausente ou ambígua não interrompe o registro do comprovante de WhatsApp. As funções são privadas e não executáveis por anon/authenticated.

Recuperação inicial: 39 leads corrigidos, dois bloqueios preexistentes preservados, nenhum lead fora das empresas 35/36 alterado. Todos os 41 leads materializados ficaram com estágio IA. Não houve reenvio de mensagens nessa recuperação.

Validação: 14 testes Postgres em PGlite, cobrindo ambas as empresas, escopo, progressão após confirmação, apresentação depois de follow-up, encaminhamento, recusa, bloqueio, idempotência, configuração renomeada/ausente e preservação de alterações manuais. Consulta de produção confirmou a distribuição dos estágios e 39 atividades de projeção.

Executar: `node --test docs/prospect-ia-stage-sync.test.mjs`.
