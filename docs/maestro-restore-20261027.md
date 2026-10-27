# Restauração do Maestro — Nature

As funções em produção `external-crms-dispatch` v119 e `external-crms-dispatch-enqueue` v76 perderam o suporte publicado anteriormente nas versões 118/75. O código Git usado na publicação do HUB não continha o adaptador. O botão manual parava na lista de provedores, antes de chamar o Maestro.

Restaurados somente os trechos do Maestro sobre as versões atuais: roteamento, credenciais, autenticação da fila, etapas e adaptador com confirmação por GET. Os demais provedores permanecem nos mesmos ramos. A Nature continua com `credentials.default_crm=hub` e `empresa_dados.default_crm=maestro`.

O adaptador e os testes agora fazem parte do repositório publicado, evitando que uma publicação a partir desse código volte a omiti-los. Nenhum lead real foi reenviado ou criado na validação. Testes simulados cobrem criação/reutilização/reabertura de conversa, configuração incompleta, respostas inválidas, confirmação da etapa e falha parcial de resumo; testes adicionais exercitam o roteamento real da função e sua sintaxe.
