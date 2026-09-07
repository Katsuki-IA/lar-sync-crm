# Follow-ups V2

## Estado atual

- Estrutura criada no projeto Supabase `tswdxgefmhjvjwafaxjl`.
- A infraestrutura real está agendada, mas permanece sem candidatos enquanto todas as empresas estiverem em `legacy`.
- O workflow n8n `Follow-ups V2 - Simulação (INATIVO)` (`16Z2bN0rT36upoP0`) está desativado, sem nós HTTP e sem Schedule Trigger.
- A empresa piloto é Andrade Ribeiro (`id_empresa = 19`).
- As duas configurações atuais foram copiadas como `draft`.
- A cadência `Sem empreendimento` foi criada vazia como `draft` e precisa receber etapas e templates antes de qualquer simulação útil.
- O Painel Katsuki IA ganhou a rota beta `/follow-ups-v2`; ela está disponível somente no preview e o site público não foi republicado.
- A Edge Function `external-db-crud` do painel reconhece explicitamente as seis tabelas V2 com `GENERATED ALWAYS AS IDENTITY`, preservando o comportamento das tabelas legadas.
- A aba `Simulações` possui uma ação autenticada e restrita para executar `simulate_followup_dispatches_v2` para a empresa selecionada. Ela grava apenas `dry_run = true` e não chama Meta, CRM ou n8n.
- `Executar simulação` cria os registros de teste; `Atualizar resultados` apenas recarrega a listagem existente.
- Cada cadência possui uma política de entrada: `after_activation` (padrão seguro) ou `since_date` (recuperação controlada pela data da última interação).
- Enquanto a cadência está em rascunho/simulação, `after_activation` usa a criação da cadência como corte. Na primeira transição para `active`, `activated_at` é preenchido automaticamente.
- Candidatos já simulados são excluídos da próxima seleção pela chave de idempotência, permitindo revisar o histórico em lotes sucessivos.
- O roteamento por empresa é controlado por `followup_engine_settings_v2`: `legacy`, `shadow`, `v2` ou `paused`.
- Todas as empresas foram inicializadas em `legacy`; a ausência de configuração também resolve para `legacy`.
- A função antiga `send_followup_leads()` agora ignora empresas em `v2`/`paused` e revalida o modo imediatamente antes do `pg_net`.
- A fila real V2 possui funções de seleção, matrícula, enqueue, claim com `FOR UPDATE SKIP LOCKED` e revalidação antes do envio.
- O workflow n8n `Follow-ups V2 - Worker` (`zN7vnZZaFRWpTBIk`) está ativo, roda a cada dois minutos, gera até 50 itens elegíveis, reserva lotes de até 5 e mantém o gatilho manual. A trava interna de envio está liberada; a trava operacional final é o modo da empresa em `followup_engine_settings_v2`.
- Antes de preparar a tentativa Meta, o worker executa um guarda fail-safe para empresas com CRM `cv`: exige o `id_crm` já salvo localmente, consulta o lead atual no CV pelo `idlead` e cancela o disparo quando a situação é `2` ou existe corretor/imobiliária vinculados. ID ausente, credenciais incompletas, erro HTTP ou resposta inválida também bloqueiam o envio.
- A V2 não busca lead no CV por telefone e não atualiza `lead.id_crm`; a recuperação especial que o fluxo legado fazia para a empresa 22 não faz parte do worker V2.
- Nenhuma empresa está em `v2`, portanto o worker agendado não encontra candidatos e não envia mensagens até a liberação individual de uma empresa.
- A ativação de cadência passa por `followup_sequence_readiness_v2` e bloqueia etapas incompletas, timezone/janela inválidos e ausência de credenciais WhatsApp.
- A tentativa é registrada em `wa_messages` e `followup_attempts_v2` antes de qualquer chamada futura à Meta; a matrícula só avança depois da aceitação da API da Meta.
- O cron `followup-v2-confirmation-timeouts` roda a cada cinco minutos. Timeout de confirmação não provoca reenvio cego: ele registra a ausência de confirmação para reconciliação e alerta.
- O trigger `trg_sync_followup_attempt_from_wa_message_v2` espelha `sent`, `delivered`, `read` e `failed` de `wa_messages` para a tentativa e o disparo V2. Assim, o `Webhook Whats` existente continua sendo a única entrada de status da Meta.
- Erros de payload e falhas funcionais da Meta são definitivos. O worker classifica como retentáveis somente HTTP `429`, `500`, `502`, `503` e `504`, falhas temporárias de rede/conexão e respostas com `is_transient = true` da Meta.
- Uma falha classificada como retentável volta à fila após cinco minutos somente quando `Parar em falha` está desligado, ainda há tentativas disponíveis e a empresa continua em modo `v2`. Timeout de confirmação e falhas assíncronas recebidas pelo Webhook Whats não provocam reenvio automático.
- A seleção e a reserva da fila real usam rodízio entre empresas. Primeiro é considerado o item mais antigo de cada empresa, depois o segundo de cada uma, respeitando `live_batch_size`; `last_claimed_at` prioriza empresas que estão há mais tempo sem ocupar uma vaga no lote entre execuções.
- A reserva continua atômica com `FOR UPDATE SKIP LOCKED`, e a fila possui índice parcial por empresa, agendamento e ID para os itens reais em `queued`.
- O workflow ativo `Webhook Whats` identifica `wa_messages.raw.source = followup_v2` depois de persistir o status e impede que essas mensagens entrem nas regras de CRM criadas para a primeira mensagem. Mensagens legadas continuam no caminho anterior.
- `followup_crm_events_v2` guarda, com idempotência por tentativa e tipo, os eventos de mensagem enviada e falha que precisam ser gravados no CRM.
- Um status `sent` cria o registro da mensagem enviada; `delivered` ou `read` também garantem esse evento caso o webhook de `sent` não tenha chegado.
- Um status `failed`, inclusive falha imediata da chamada à Meta, cria um alerta informando que o follow-up não foi entregue e inclui o erro retornado.
- O workflow n8n `Follow-ups V2 - CRM` (`lxmbjkYZiSKfRnHl`) está ativo, com `crm_live_enabled = true`, e processa até 5 eventos a cada dois minutos. Sem empresas em `v2`, nenhum evento novo é produzido.
- O worker de CRM cobre CV, Loft, RD, Hub interno e Kommo. RD e Kommo registram nota/alerta e só aplicam a tag do follow-up quando o envio foi aceito; o Hub registra atividade e só aplica tag ou movimenta etapa em eventos de sucesso. Provedores não suportados falham de forma explícita e não descartam silenciosamente o evento.
- O piloto real pode ser armado com uma autorização descartável vinculada simultaneamente a empresa, lead, telefone, cadência, etapa e variante. Criar a autorização não ativa a cadência, não troca o motor e não enfileira nem envia nada.
- A autorização é revalidada antes do enqueue e deixa de ser reutilizável assim que cria a fila. Mudança de telefone, empresa, empreendimento, contexto, atendimento humano, status ou agendamento bloqueia o teste.

## Modelo

- `followup_sequences_v2`: cadência por empresa e escopo (`project` ou `no_project`).
- `followup_steps_v2`: ordem, delay padrão e situação CRM padrão.
- `followup_variants_v2`: contexto sem A/B/C (`no_reply`, `engaged`, `scheduling`), template Meta, idioma, mapeamento de variáveis, mensagem do CRM e overrides.
- `followup_enrollments_v2`: progresso V2 separado de `lead.etapa_conversa`.
- `followup_dispatches_v2`: decisão lógica e snapshot usado no disparo.
- `followup_attempts_v2`: cada tentativa técnica e seu vínculo com `wa_messages`.
- `followup_engine_settings_v2`: escolha segura do motor por empresa e tamanho do lote real.
- `followup_test_authorizations_v2`: permissão temporária e de uso único para um piloto real com seleção exata.

## Roteamento por empresa

| Modo | Motor legado | Motor V2 |
| --- | --- | --- |
| `legacy` | envia | não envia |
| `shadow` | envia | somente simula |
| `v2` | não envia | autorizado a enfileirar/enviar |
| `paused` | não envia | não envia |

A autorização `v2` não é suficiente, sozinha, para produzir mensagens: também são necessários uma cadência ativa e pronta, um worker ativo e uma revalidação válida imediatamente antes da Meta.

## Funções operacionais V2

- `live_followup_candidates_v2`: candidatos reais somente de empresas em `v2` e cadências ativas.
- `enqueue_followup_dispatches_v2`: cria matrícula e fila idempotente; não chama serviço externo.
- `claim_followup_dispatches_v2`: reserva lotes concorrentes com `SKIP LOCKED`; a etapa 1 pode ser enviada a qualquer horário e as etapas seguintes respeitam a janela da cadência.
- `revalidate_followup_dispatch_v2`: cancela o disparo se empresa, lead, contexto, empreendimento, etapa ou agendamento mudaram.
- `followup_sequence_readiness_v2`: valida uma cadência antes da ativação.
- `activate_followup_sequence_v2`: ativa somente uma cadência pronta.
- `set_followup_engine_mode_v2`: troca o motor por empresa e cancela itens ainda na fila ao sair de `v2`.
- `prepare_followup_attempt_v2`: revalida o disparo e cria o registro técnico antes da Meta.
- `accept_followup_attempt_v2`: associa o `message_id` da Meta e somente então avança a matrícula.
- `fail_followup_attempt_v2`: registra a falha e só retorna à fila quando a chamada declara explicitamente que o erro é retentável.
- `mark_followup_confirmation_timeouts_v2`: marca confirmações vencidas sem reenviar automaticamente.
- `enqueue_followup_crm_event_v2`: cria o evento idempotente de CRM para `sent` ou `failed`.
- `claim_followup_crm_events_v2`: reserva um lote de eventos de CRM com `SKIP LOCKED`.
- `complete_followup_crm_event_v2`: conclui ou falha o evento e atualiza o estado de sincronização em `wa_messages` e na tentativa.
- `authorize_followup_test_v2`: confere os vínculos exatos e cria a autorização temporária, sem fila ou envio.
- `preview_followup_test_v2`: mostra a seleção final e todas as travas ainda fechadas.
- `enqueue_authorized_followup_test_v2`: cria exatamente um disparo para a autorização, somente quando todas as revalidações e gates estão válidos.
- `claim_authorized_followup_test_v2`: reserva exclusivamente o disparo ligado à autorização do piloto; não consulta nem reserva a fila geral.
- `claim_authorized_followup_test_crm_event_v2`: reserva exclusivamente um evento de CRM ligado ao dispatch autorizado do piloto.

## Regras de contexto

1. Lead com agendamento não é elegível.
2. Atendimento humano ou status fora de `ativo`/`agendando` não é elegível.
3. `status = agendando` resolve para `scheduling`.
4. `qtd_interacoes >= 2` resolve para `engaged`.
5. Os demais resolvem para `no_reply`.
6. Sem `empreendimento_em_foco_id` e sem `id_empreendimento`, o escopo é `no_project`.

## Segurança da fase 1

- Tabelas públicas têm RLS habilitado.
- `anon` e `authenticated` não possuem acesso direto.
- O painel interno acessa via serviço autenticado já existente.
- Todas as cadências piloto estão em `draft`.
- `simulate_followup_dispatches_v2` grava somente `status = simulated` e `dry_run = true`.
- Nenhuma função V2 chama `pg_net`, Meta, CRM ou n8n.

## Próximos gates

1. Configurar a cadência sem empreendimento com templates Meta aprovados.
2. Comparar o preview V2 com a seleção da função atual por alguns dias.
3. Testar a gravação no CV e no Loft com empresa e lead autorizados, ainda sem disparar uma mensagem real da Meta.
4. Testar o envio e os retornos `sent`, `delivered`, `read` e `failed` apenas com empresa e número autorizados.
5. Adicionar os demais provedores de CRM antes de liberar empresas que não usam CV ou Loft.
6. Rotacionar qualquer credencial sensível exposta em workflows legados antes do piloto.
7. Somente depois criar um cron V2 pausado e planejar a troca controlada.

## Piloto controlado — Harmonia Viamão

- Em 2026-09-01, a autorização descartável da lead `11123` (Paula Sagini) criou o dispatch real `59` e a tentativa `10`.
- A Meta aceitou o template `followup_1_sem_emp`; o `message_id` foi persistido e o webhook atualizou o status para `sent`.
- O evento CRM `3` foi concluído e marcado como sincronizado no CV.
- O teste identificou que o CV exige o e-mail já associado ao cadastro quando o e-mail local está vazio. Para Paula, o identificador foi confirmado por consulta ao `idlead 37298` antes da repetição; o WhatsApp não foi reenviado.
- Ao final, a Harmonia voltou para `legacy`, a cadência voltou para `shadow`, a janela 10h–19h foi restaurada e todos os workflows temporários foram apagados. Os workers V2 originais continuam inativos.
- A configuração legada da empresa 23 foi importada para três cadências V2 em `draft`: Reserva Harmonia Viamão, Harmoni Vinhedos e Parque Harmonia. Cada cadência possui quatro etapas e três contextos por etapa, totalizando 12 etapas e 36 variantes. A cadência sem empreendimento permaneceu separada e inalterada.
- A importação preservou os delays, nomes de template, parâmetros, mensagens do CRM e URLs de mídia. Os IDs de situação ficaram vazios porque também estão vazios nas 12 etapas legadas dessa empresa.

## Importação completa da configuração legada

- Em 2026-09-01, as configurações de `followup_steps` das 23 empresas que possuíam follow-ups legados foram importadas para a V2.
- O estado final importado contém 52 cadências, 208 etapas e 616 variantes. Todas as 52 cadências permanecem em `draft` e as 24 empresas permanecem em `legacy`; a importação não habilitou o motor V2 nem criou disparos.
- A conversão dos sufixos preserva a regra atual: sem sufixo = `no_reply`, `B` = `engaged` e `C` = `scheduling`. Também foram preservados template Meta, idioma, delay, situação CRM, parâmetros, mensagem registrada no CRM, mídia e status ativo.
- Uma segunda execução da importação nas 23 empresas inseriu zero cadências, etapas ou variantes, confirmando a idempotência e a ausência de duplicatas.
- 50 das 52 cadências passaram na validação de prontidão. `HVM / V1 migrada - geral` ficou incompleta porque o legado só possui as quatro variantes sem sufixo e não possui templates B/C. `Teste CRM / V1 migrada - Teste Empreendimento` possui todas as variantes, mas permanece bloqueada por ausência de credenciais de WhatsApp.
- Nenhuma linha legada contém `template_name_sem_emp`; portanto, a migração não inventou templates para leads sem empreendimento. Esse caso deve ser configurado explicitamente no painel antes da ativação.

## Acessos da fase 1

- Preview do painel: <https://id-preview--b001a40f-f86d-4283-a1ba-ba1a585d601d.lovable.app/follow-ups-v2>
- Editor Lovable: <https://lovable.dev/projects/b001a40f-f86d-4283-a1ba-ba1a585d601d>
- Workflow de simulação n8n: `16Z2bN0rT36upoP0`
- Worker V2 inativo n8n: `zN7vnZZaFRWpTBIk`
- Worker CRM V2 inativo n8n: `lxmbjkYZiSKfRnHl`
