# Diagnóstico do bloqueio do preview (somente leitura)

Nada foi alterado. Verificação feita no **shell** do sandbox; o runtime da requisição **não** pôde ser inspecionado por dentro — só confirmado que o preview local responde HTTP 503.

| Verificação (shell) | Resultado |
|---|---|
| SUPABASE_URL presente | true |
| SUPABASE_URL corresponde à URL compilada (projeto tswdxgefmhjvjwafaxjl) | true |
| SUPABASE_PUBLISHABLE_KEY presente | true |
| SUPABASE_PUBLISHABLE_KEY corresponde à chave pública compilada no vite.config.ts | **false** |
| SUPABASE_SERVICE_ROLE_KEY ou APP_SUPABASE_SERVICE_ROLE_KEY presente | true |
| Preview local (GET /) | HTTP 503 |

## Condição que falha
Em candidateRuntimeReady: `env.SUPABASE_PUBLISHABLE_KEY?.trim() === expectedPublicKey` — a chave pública do ambiente difere da compilada no build.

## Observação sobre runtime
src/server.ts passa `process.env` para a checagem, e não o `env` (bindings Cloudflare) recebido no fetch. Ou seja, mesmo publicado, a checagem lê process.env, não os bindings. Não verifiquei os bindings reais da requisição.

## Versões finais no package-lock
- @supabase/supabase-js: 2.118.0
- @tanstack/zod-adapter: 1.167.0

## Próximo passo (só se autorizado)
Nenhuma ação proposta. Aprovar este plano não altera nada; diga se quer corrigir a chave pública ou o uso de process.env.
