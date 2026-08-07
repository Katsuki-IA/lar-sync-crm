# Edge Functions internas do n8n

Estas funções substituem chamadas diretas do n8n ao PostgREST que hoje exigem a
chave `service_role`. A chave administrativa permanece somente nos secrets
gerenciados pelo Supabase.

## Secrets obrigatórios

- `N8N_WHATS_SECRET`: usado exclusivamente pelo workflow de entrada do WhatsApp.
- `N8N_AGENT_SECRET`: usado exclusivamente pelas ferramentas de consulta do agente.

Use valores aleatórios diferentes, com pelo menos 32 bytes, e envie-os no header
`x-n8n-secret`. Não use a chave `service_role` como valor desses secrets.

As funções falham com HTTP 503 enquanto o secret correspondente não estiver
configurado e com HTTP 401 quando o header estiver ausente ou incorreto.

## Contratos

### `n8n-wa-status-event`

Substitui o RPC direto `insert_wa_status_event`. Recebe via `POST` os mesmos campos
`p_*` usados atualmente pelo node `Insert supabase RPC`.

### `n8n-wa-message-upsert`

Substitui o upsert direto em `wa_messages`. Recebe via `POST`:

```json
{
  "phone_number_id": "123",
  "message_id": "wamid...",
  "direction": "inbound",
  "from_wa_id": "5511999999999",
  "raw": {},
  "timestamp_meta": "2026-08-07T12:00:00.000Z"
}
```

### `n8n-agent-empreendimentos`

Recebe `POST` com `p_id_empresa` e retorna o resultado do RPC
`get_empreendimento`.

### `n8n-agent-images`

Recebe `POST` com `id_empresa` e `id_empreendimento`. Retorna somente
`id_imagem`, `nome` e `descricao`.

## Implantação sem interrupção

1. Fazer deploy das quatro funções; elas ainda não recebem tráfego.
2. Configurar os dois secrets no Supabase.
3. Trocar um node do n8n por vez e validar a execução.
4. Depois que todos os nodes forem migrados, rotacionar a chave administrativa
   que estava escrita nos workflows.
