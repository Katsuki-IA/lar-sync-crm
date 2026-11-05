# Migração do Hub para myhub.katsuki.com.br

Preparação em 05/11/2026. Projeto Lovable: `49e843b7-5b71-4684-91bf-93d45886e53a`.
Supabase: `tswdxgefmhjvjwafaxjl`. A troca do domínio principal ainda depende das verificações abaixo.

## Alterações

- URLs públicas e páginas legais apontam para `https://myhub.katsuki.com.br`.
- `resolveAppBaseUrl` migra o valor legado de `APP_BASE_URL` e o fallback; preserva outras origens e caminhos.
- Funções `external-crms-dispatch` e `external-crms-cv-summary` usam esse resolvedor.
- Funções SQL `private.hub_claim_task_reminder` e `private.kp_claim_notice` geram links no novo domínio, preservando permissões e regras.
- n8n: somente URLs de seis nós em três workflows foram substituídas: `evy0eBHNq7pbLVwv`, `GoWLlhIG9XwxjSWu`, `K6Ra0NieeLWEFi1w`.
- Backups operacionais ficam fora do Git, em `mcp/backups/domain-migration-20261105/`.

## Antes de liberar hub.katsuki.com.br

1. Supabase Auth: conferir o Site URL e a lista de Redirect URLs; adicionar `https://myhub.katsuki.com.br/reset-password` antes da troca e preservar temporariamente URLs anteriores necessárias.
2. Conferir valores efetivos de `META_REDIRECT_URI`, `RD_REDIRECT_URI`, `RD_CRM_REDIRECT_URI` e `APP_ORIGIN`, assim como as URLs permitidas nos aplicativos Meta/RD. Os conectores usados nesta preparação não expõem esses valores/configurações. Não alterar callbacks registrados sem alinhar ambos os lados.
3. Definir `myhub.katsuki.com.br` como principal no Lovable; validar login, recuperação e conexão Meta/RD no novo host. Até isso acontecer, o novo domínio redireciona para o antigo.
4. Ao migrar o antigo host para o novo site, preservar `/historico/*` por redirecionamento específico mantendo o caminho. Considerar também links antigos de `/tarefas` e `/conversas` enviados em notificações.
5. Retirar as URLs de autenticação do host antigo quando ele deixar de hospedar este sistema.

## Validação executada na preparação

- HTTPS e redirecionamentos HTTP de `/`, `/auth`, `/reset-password` e uma rota de histórico sintética.
- Casos de configuração vazia, host antigo, host novo, prefixo de caminho e preservação de localhost/homologação.
- Leitura das versões publicadas das duas Edge Functions e das três automações, sem executar envios de mensagens para testes.
- Conferência das definições SQL publicadas; o papel de SECURITY DEFINER/INVOKER permanece igual.

Os testes completos de login, recuperação de senha e OAuth permanecem pendentes até a conferência das configurações e a mudança do domínio principal.
