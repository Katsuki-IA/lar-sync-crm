# Diagnóstico: chat web público /chat da Clara (Katsuki, empresa 38)

Somente diagnóstico. Nada foi editado.

## O que existe hoje (confirmado nesta inspeção)

- **Banco:** um único projeto, `tswdxgefmhjvjwafaxjl` (`supabase/config.toml`). O modo é `external_unmanaged`, então não consigo testar com um usuário logado.
- **Prompts da Clara:** os ids 55 e 56 estão em `prompt_especifico`, não em `prompt`.
  - 55 é o node "Atendimento", com cerca de 58 mil caracteres.
  - 56 é o node "Agendamento", com cerca de 11 mil caracteres.
  - Os dois pertencem à empresa 38.
- **Conhecimento:** `empresa_conhecimento` da empresa 38 tem 7 itens (ids 8 a 14): grupo, cases, solução WhatsApp, planos e preços, implantação, reunião e objeções. As colunas são `titulo`, `categoria`, `conteudo` e `ordem`.
- **Backend comercial (funções RPC já existentes):**
  - Qualificação: `commercial_qualification_context` e `commercial_qualification_apply`.
  - Agenda: `commercial_schedule_options`, `commercial_schedule_context` e `commercial_schedule_manage`.
  - Campos do Hub: `commercial_hub_fields`.
  - Follow-ups: `commercial_followup_block_reason`.
  - Entrada de leads: `crm_ingest_site_lead(p_source_id, p_id_empresa, ..., p_telefone, p_email, p_origem, ...)`.
- **IA no servidor:** só existe `src/lib/secretary-ai.server.ts`, que chama a OpenAI direto com `OPENAI_API_KEY`. Não há chat nem sessão pública.
- **Rotas públicas atuais:** `src/routes/api/public/` tem apenas `gloria-leads.ts`, `pulse-funil-ia.ts` e `secretary/interpret.ts`. Nenhuma delas tem limite de requisições.
- **Avatar da Clara:** não encontrei no projeto nem no storage. Nenhum arquivo com "clara" no nome, e `imagens` não tem registros da empresa 38. Você precisa enviar a imagem.
- **Histórico atual:** fica em `n8n_chat_conversas`, que é ligada ao WhatsApp (número, `wa_*`). Não serve para o chat web.

## Pontos ainda não confirmados (são o primeiro passo da implementação)

1. **Telefone em `crm_ingest_site_lead`:** não sei se a função aceita telefone nulo, nem se ela ou os gatilhos de `crm_leads`/`lead` enfileiram WhatsApp ou follow-up. Os candidatos são `crm_enqueue_new_lead_if_enabled`, `crm_enqueue_fila_lead_if_enabled` e `crm_enqueue_external_dispatch`. A consulta via information_schema não mostrou os gatilhos, então preciso ler `pg_trigger` e o corpo das funções.
2. **Lead sem telefone nas funções comerciais:** não sei se `commercial_qualification_*` e `commercial_schedule_*` funcionam assim, nem se dependem de `wa_*` ou `conversation_key`.
3. **Origem do prompt em produção:** preciso confirmar como o fluxo atual do WhatsApp monta o prompt final. Pode ser 55 mais conhecimento, com 56 entrando na etapa de agendamento. A ideia é reproduzir a mesma montagem, não aproximar.

## Caminho de implementação proposto

```text
/chat (página pública) -> POST /api/public/clara-chat (servidor)
   -> valida a sessão (token opaco em cookie httpOnly)
   -> limite de requisições (por sessão + IP com hash)
   -> lê prompt_especifico 55/56 + empresa_conhecimento 38 (do banco, sem cópia no código)
   -> IA no servidor, com ferramentas que chamam as RPCs commercial_* da empresa 38
   -> grava as mensagens no histórico web e devolve a resposta em streaming
```

1. **Banco (SQL candidato, aplicado por você):**
   - `private.web_chat_sessions`: id, empresa 38 fixa, hash do token, `crm_lead_id` nulo até identificar o visitante, `greeted_at`, datas e IP com hash.
   - `private.web_chat_messages`: sessão, papel, partes da mensagem e data.
   - `private.web_chat_rate`: janela de requisições.
   - RLS ligado, permissões revogadas e acesso só pelo `service_role`, através de funções `security definer` com `search_path=''`. O mesmo padrão da Secretária.
2. **Sessão isolada:** o servidor gera o token e o salva no cookie `httpOnly; Secure; SameSite=Lax`. O banco guarda só o hash, e uma sessão nunca lê outra.
3. **Histórico persistente:** formato "uma conversa por visitante". Ao recarregar, a conversa é restaurada do banco.
4. **Abertura automática uma vez:** na primeira carga sem `greeted_at`, o servidor gera a apresentação da Clara, grava `greeted_at` e não repete.
5. **Limite de requisições:** por exemplo, 20 mensagens a cada 10 minutos por sessão e 60 por IP por hora, mais um limite de tamanho por mensagem. Ao estourar, responde 429 com aviso claro. Os números são sugestões para você ajustar.
6. **Lead de origem web:**
   - Só é criado quando o visitante informa nome e e-mail ou telefone de verdade. Nunca inventar telefone.
   - Passa por `crm_ingest_site_lead`, com `p_origem='site'` e uma fonte própria "Chat web".
   - Se a função ou um gatilho disparar WhatsApp ou follow-up, a escolha é entre duas saídas:
     - uma flag `origem=web_chat` que os gatilhos ignoram;
     - uma RPC dedicada que insere sem enfileirar.
   - A decisão depende do ponto não confirmado 1.
7. **IA:**
   - Usa o mesmo provedor de IA que já está configurado (`OPENAI_API_KEY`), só no servidor. A alternativa é o Lovable AI, se você preferir.
   - O texto de sistema vem sempre do banco (55, 56 e o conhecimento). Não haverá prompt paralelo no código.
   - As ferramentas limitadas são: consultar horários, agendar ou cancelar e registrar qualificação, sempre com a empresa 38 fixa no servidor.
8. **Visual inspirado na lp.squad.com:**
   - Página clara e centralizada, com o avatar e o nome da Clara no cabeçalho.
   - A apresentação aparece em balões.
   - Campo de mensagem fixo embaixo, pensado para o celular.
   - Usa os componentes de chat do AI Elements e a identidade visual atual.

## Limites

- Não haverá WhatsApp, follow-up nem n8n. Também não serão alterados credenciais, publicação ou dados reais sem a sua aplicação do SQL.
- O chat atende só a empresa 38. O id da empresa nunca vem do navegador.
- Sem o avatar, uso as iniciais "C" até você enviar a imagem.

## Arquivos previstos

- `src/routes/chat.tsx`
- `src/routes/api/public/clara-chat.ts`
- `src/lib/clara-chat.server.ts` (sessão, limite de requisições, montagem do prompt e ferramentas)
- `src/components/clara-chat/*`
- `docs/clara-chat-candidato.sql`
- testes PGlite e unitários de sessão, limite e lead sem telefone
