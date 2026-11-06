# RD Marketing: migração do aplicativo OAuth para MyHub

Preparado em 06/11/2026. Supabase: `tswdxgefmhjvjwafaxjl`.

## Configuração e ativação

Preservar `RD_CLIENT_ID`, `RD_CLIENT_SECRET` e `RD_REDIRECT_URI`: eles continuam
identificando o aplicativo original e renovando os tokens das conexões existentes.
Não alterar `RD_CRM_*`: esta migração trata do aplicativo RD Marketing.

Cadastrar separadamente nos secrets das Edge Functions:

- `RD_MYHUB_CLIENT_ID`: Client ID do aplicativo “HUB Katsuki MY HUB”.
- `RD_MYHUB_CLIENT_SECRET`: Client Secret desse mesmo aplicativo.
- `RD_MYHUB_REDIRECT_URI`: `https://myhub.katsuki.com.br/integracoes/rd`.
- `RD_MYHUB_ENABLED`: manter ausente ou `false` durante a preparação.

Não gravar os valores secretos no Git, frontend ou documentação.
Depois de confirmar o produto Marketing, as permissões, as credenciais e o domínio
principal no Lovable, definir `RD_MYHUB_ENABLED=true` para os novos fluxos OAuth.
Uma autorização já iniciada mantém o aplicativo identificado em seu state assinado.

## Conexões existentes

`crm_rd_connections.oauth_client_id` registra somente o Client ID público do app
que emitiu os tokens. NULL significa o aplicativo original. A migração não altera
tokens, webhooks, empresas, políticas RLS ou o estado ativo das conexões existentes.
A renovação usa o app registrado na conexão, independentemente da ativação global.
Uma renovação antiga não pode sobrescrever tokens trocados por uma reconexão.

Na reconexão, o Hub obtém o token do app anterior, cria o novo webhook e salva o
novo vínculo antes de remover o webhook anterior. Falha na gravação limpa somente
o webhook novo. Falha na limpeza do webhook antigo é registrada em `last_error`.
O token do webhook antigo deixa de ser aceito após a troca do hash da conexão.
Se o token anterior não puder ser renovado, a reconexão é interrompida sem substituir
o vínculo existente; será necessário tratar essa conexão antes de tentar novamente.

## Validação e sequência operacional

- Testes locais: `node --test mcp/rd-app-migration.test.mjs` (12 cenários).
- Autorização real com a conta da Inocoop e recebimento de leads ainda pendentes.
- Conferir os mapeamentos já existentes, último evento e erros após reconectar.
- Não excluir o aplicativo original enquanto houver conexões antigas ou limpeza pendente.
- Rollback da ativação: `RD_MYHUB_ENABLED=false`. Isso não reverte conexões já migradas;
  elas continuam precisando dos secrets `RD_MYHUB_*` para renovar seus tokens.
- A liberação do host antigo para outro projeto também exige a conclusão dos ajustes
  de Meta, Auth e redirecionamentos históricos descritos em `myhub-domain-migration.md`.

## Estado aplicado em 06/11/2026

- Credenciais novas cadastradas em RD_MYHUB_*; secrets RD_* antigos preservados.
- RD_MYHUB_ENABLED=true; novas autorizações usam o app MyHub.
- myhub.katsuki.com.br definido como domínio principal no Lovable; HTTP 200 verificado.
- APP_ORIGIN e META_REDIRECT_URI atualizados para MyHub.
- Inocoop continua ativa com oauth_client_id NULL (app original), sem erro registrado.
- Reconexão real da Inocoop e validação de leads após essa reconexão ainda pendentes.
- Usar o botão Reconectar no card RD Station Marketing, sem desconectar antes.
- O host antigo permanece no projeto durante a transição; ainda não liberar para outro site.
