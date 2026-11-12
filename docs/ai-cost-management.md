# Custos de IA por empresa

Implementado em 12/11/2026. Banco: `tswdxgefmhjvjwafaxjl`. Coletor n8n: `x0h7YZwyyx5Ofdkn` (Custos IA - Coleta por empresa).

## Funcionamento

O coletor roda a cada minuto. Inventaria uma das 18 fontes cadastradas por rodada, paginando todo o histórico disponível. Com 18 fontes, cada fluxo é revisitado aproximadamente a cada 18 minutos. Uma fila persistente reserva lotes de 50 execuções, lê seus detalhes e grava os eventos em uma transação. Reservas expiradas são tentadas novamente; IDs estáveis evitam duplicação. Não realiza novas chamadas de IA nem envia mensagens aos clientes. Os fluxos de atendimento não foram alterados.

A tela `/admin/custos-ia` exige usuário ativo com papel `super_admin`, conferido no servidor. Tabelas e RPCs não são acessíveis a `anon` ou `authenticated`. O servidor consulta usando service_role. O n8n usa sua credencial Postgres já existente e uma credencial n8nApi criptografada no cofre do n8n. O coletor não persiste os dados brutos das execuções no próprio histórico.

## Precisão e escopo

- `complete`: tokens reportados, inclusive cache. `cache_unknown`: tokens reportados sem cache. `estimated`: estimativa de tokens do n8n, não medição do provedor. `missing`/`invalid`: custo não calculável.
- Custos são calculados em USD com tarifas versionadas. Sem cache, mostra-se o intervalo entre toda entrada em cache e nenhuma entrada em cache. Isso **não** é intervalo estatístico nem cobre erro na estimativa de tokens, ferramentas extras ou consumo ausente.
- A quantidade de eventos representa saídas observadas dos nós, não necessariamente todas as requisições físicas. Retentativas internas do SDK sem telemetria e chamadas HTTP/Code fora dos tipos monitorados não ficam demonstradas por esse método.
- Somente IDs estruturados explícitos identificam empresas. Execuções que contêm várias empresas ficam não atribuídas. Não há rateio. A fonte DEV/QAS é marcada como teste.
- Áudio sem duração/usage e modelos sem tarifa ficam sem custo calculado. DeepSeek v1 sem modelo explícito registra o padrão `deepseek-chat`, conforme o código do nó, mas **não recebe tarifa de outro modelo por suposição**. O administrador técnico deve confirmar o modelo efetivo e sua tarifa antes de adicionar uma vigência para esse alias. Horários de pico e feriados também precisam ser contemplados ao precificar os modelos atuais da DeepSeek.
- Tarifas OpenAI foram conferidas em 12/11 e têm vigência a partir dessa data. A recuperação dos dias anteriores preserva tokens, mas não aplica preços atuais retroativamente.
- Outubro contém apenas os totais reais importados (OpenAI UTC, DeepSeek GMT-3). O histórico por empresa de outubro não foi recuperado. Esses totais não são somados aos eventos nem automaticamente distribuídos.

## Operação

Verificar a saúde da coleta no painel: última gravação, pendências, execuções indisponíveis e última varredura por fonte. Caso o coletor fique parado além da retenção do n8n, pode haver perda irrecuperável: a fila não substitui um backup do histórico. Novos workflows de IA precisam ser cadastrados em `ai_cost_sources` após verificação do tipo de nó e da origem do ID de empresa.

Tarifas ficam em `ai_cost_rates`. Usar vigência, fonte oficial e modelo exato; encerrar a vigência anterior ao incluir a próxima. Exportações reais ficam em `ai_provider_cost_periods` com escopo, início/fim exclusivos e arquivo de origem. A conciliação é explícita: comparar apenas períodos e escopos compatíveis. Os totais importados atualmente são de outubro; não existe integração automática de faturamento dos provedores nesta versão.

Para pausar, desativar apenas o workflow coletor. Os registros e a tela permanecem. As migrações são aditivas e não alteram tabelas de atendimento.

## Validação

`node --test mcp/ai-cost-normalize.test.mjs`; `supabase/tests/ai_cost_ledger.sql` (transacional, rollback); build Vite; coleta real e consulta ao banco. O gerador `mcp/build-ai-cost-collector.mjs` recebe arquivo local com URL e ID da credencial, nunca a chave. **A ferramenta MCP n8n filtra opções de settings**: aplicar/reler o JSON completo pela API pública para preservar `saveDataSuccessExecution:none`, `saveDataErrorExecution:none`, `saveManualExecutions:false` e `executionTimeout:600`.

Fontes: [OpenAI GPT-4.1](https://developers.openai.com/api/docs/models/gpt-4.1), [GPT-4.1 mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini), [GPT-4o mini](https://developers.openai.com/api/docs/models/gpt-4o-mini), [GPT-5 mini](https://developers.openai.com/api/docs/models/gpt-5-mini), [DeepSeek preços](https://api-docs.deepseek.com/quick_start/pricing/).
