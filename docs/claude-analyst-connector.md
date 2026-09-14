# Conector Claude para analistas

Endpoint MCP remoto:

```text
https://hub.katsuki.com.br/api/mcp/analyst?token=TOKEN_INDIVIDUAL
```

## Instalação no Claude

1. Abra **Settings > Connectors**.
2. Escolha **Add custom connector**.
3. Use o nome `Katsuki - Análise de Conversas`.
4. Cole a URL individual recebida do administrador.
5. Ative o conector em **Search and tools** na conversa.

Planos Claude Pro, Max, Team e Enterprise aceitam conectores MCP remotos. Em contas Team ou Enterprise, um Owner pode precisar habilitar o conector para a organização.

## Ferramentas disponíveis

- `listar_empresas`: empresas autorizadas para o analista.
- `listar_conversas`: conversas por empresa e intervalo de datas.
- `obter_conversa`: mensagens de uma conversa selecionada.
- `listar_analises`: análises já processadas por empresa e período.

Exemplo de solicitação:

> Use o conector Katsuki. Liste minhas empresas e analise as conversas da empresa escolhida entre 01/09/2026 e 14/09/2026. Identifique objeções recorrentes, intenção de compra, qualidade do atendimento e oportunidades de follow-up. Gere um relatório executivo sem expor números de telefone.

## Segurança

- Cada URL é individual, expira e pode ser revogada.
- O banco armazena somente o hash do token.
- O conector rejeita usuários inativos ou que deixaram de ser Analistas.
- Todas as consultas repetem a validação das empresas autorizadas.
- Não compartilhe a URL em mensagens, documentos ou grupos.
- Nunca forneça chaves do Supabase ou `service_role` ao analista.
