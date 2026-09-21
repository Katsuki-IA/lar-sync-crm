# Alerta de lead qualificado após envio ao CRM

Publicado em 18/09/2026. Workflow n8n: `evy0eBHNq7pbLVwv`
(`Qualificados - Alerta WhatsApp após envio CRM`).

- Somente novas transições da fila CRM para `sent`, com
  `payload.enforceQualificationRule=true`, geram alerta. Não há backfill.
- O envio por qualificação aguarda 24 horas contínuas, registradas em
  `crm_leads.qualification_dispatch_started_at`. O worker confere novamente o
  estado e a opção da empresa antes de enviar. Perder a qualificação encerra a
  janela; requalificar inicia outra. Repetir a mesma qualificação não reinicia.
- O alerta vem após esse envio confirmado, sem mais 24 horas adicionais.
  A janela fixa de qualificação independe do atraso configurado para follow-up.
- Usa `empresa_dados.id_group` e a mesma chamada Evolution do fluxo
  `Service Agent -> Schedule`, sem alterar o fluxo de visitas.
- O agendador consulta a outbox privada a cada minuto, até 10 alertas por lote.
  `FOR UPDATE SKIP LOCKED` e token de reserva impedem dois consumidores de
  enviarem o mesmo alerta. A unicidade é por empresa/lead.
- Mensagem: nome, telefone, empreendimento, motivo breve, confirmação do envio CRM e link Hub.
  O motivo vem da última atividade de qualificação registrada antes do alerta,
  limitado a 220 caracteres, sem outra chamada de IA e sem enviar o histórico.
  Se não houver motivo salvo, a ausência é informada. A prévia do link fica desligada.
- A fila de alertas é independente: falha no WhatsApp não reenvia o lead ao CRM.
- `sent` significa aceite da Evolution com ID da mensagem; não comprova leitura.
  HTTP 4xx registra `failed`; timeout, 5xx ou resposta sem recibo registra
  `uncertain`. Reservas interrompidas há mais de 10 minutos também ficam
  `uncertain`, sem reenvio automático. Conferir a Evolution antes de qualquer
  reprocessamento. Falhas detectadas pelo fluxo são encaminhadas ao Error Handling.
- Grupo ausente/inválido registra `skipped`, sem fallback para número do cliente.
- A tabela `private.qualified_whatsapp_alerts` não é exposta aos usuários.
  RLS sem política é intencional (deny-by-default), junto com revogação dos grants;
  o aviso [RLS enabled without policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
  é informativo nesse caso. O consumidor usa a conexão Postgres interna já existente.
- Nenhuma opção de envio por qualificação foi ativada automaticamente.

## Validação

`node --test mcp/qualified-whatsapp-alert.test.mjs`: 4 testes.
`mcp/qualified-whatsapp-alert-db-tests.sql`: executar somente em BEGIN/ROLLBACK.
`mcp/qualification-24h-db-tests.sql`: testes da janela, também em BEGIN/ROLLBACK.
`node mcp/test-qualified-whatsapp-alert-live.mjs`: replica a cadeia n8n e substitui
o destino Evolution por webhook simulado. Nenhuma mensagem WhatsApp real.

Credenciais não estão nestes arquivos; o publicador copia a configuração existente
do backup ignorado pelo Git. Não recriar o workflow se já existir o arquivo local
`mcp/backups/qualified-whatsapp-alert-workflow.json`; usar seu ID para manutenção.
