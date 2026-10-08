# Enriquecimento automático de Click to WhatsApp

Ativado em 08/10/2026 para todas as empresas, inclusive novas. Exige referral CTWA com ID de anúncio e conexão Meta ativa com acesso à conta de anúncios. Não exige página selecionada nem formulário sincronizado.

- Trigger de atribuição reaproveita nomes completos consultados nas últimas 24 horas para o mesmo anúncio **da mesma empresa**.
- Atribuições incompletas geram uma única tarefa por empresa/anúncio em `private.ctwa_ad_enrichment`.
- Cron `ctwa-ad-attribution-enrichment` roda a cada minuto. Só chama a Edge Function quando há tarefas vencidas com conexão ativa.
- `ctwa-enrich-attribution` consulta anúncio, conjunto e campanha com a credencial OAuth armazenada no servidor. Até três anúncios por execução, timeout de oito segundos por consulta, lease de 90 segundos e recuperação de execuções interrompidas.
- Falhas ou respostas incompletas são reagendadas automaticamente (1 min, 5 min, 25 min, 125 min, até 6 horas). O ID original e o clique são preservados. Conexões inativas aguardam reconexão.
- O resultado preenche todos os leads CTWA incompletos da empresa/anúncio. Não depende do watchdog de saúde de duas horas nem do botão Atualizar anúncios.
- Formulários continuam no enriquecimento automático existente do `meta-webhook`. A nova fila atende CTWA.

A fila tem RLS sem acesso para navegador. RPCs somente `service_role`. Edge exige JWT e `x-meta-health-secret`; cron usa os segredos existentes do Vault. Tokens não aparecem nos URLs, logs ou respostas.

Validação: quatro testes de consulta Meta; testes SQL em rollback para cache, isolamento, deduplicação, leases, retry, preenchimento compartilhado, exclusão de formulários e permissões. Primeira execução real do cron retornou HTTP 200, `checked=1,enriched=1,failed=0` e preencheu uma atribuição pendente da empresa 29.
