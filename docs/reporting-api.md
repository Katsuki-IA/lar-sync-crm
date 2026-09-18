# API de relatórios — versão 1

No Hub, entre em **Super Admin → API de relatórios → Nova integração**. Informe o nome do sistema,
selecione as empresas e a validade. O token completo aparece uma vez. Armazene-o nos segredos do
servidor consumidor. A integração independe da conta da pessoa que a criou.

**Editar acesso** altera nome, empresas e validade sem trocar o token. **Substituir token** invalida
o anterior imediatamente; **Revogar** encerra o acesso e mantém o registro no histórico.

## Requisição

```http
GET /api/integrations/leads?id_empresa=25&data_inicio=2026-09-09&data_fim=2026-09-15&fuso=America%2FSao_Paulo&limite=100
Authorization: Bearer SEU_TOKEN
```

Use o domínio publicado do Hub. A chave só é aceita no header. A empresa precisa constar nas
permissões da integração. O endpoint é de leitura e não permite executar SQL ou alterar leads.

| Parâmetro | Significado |
| --- | --- |
| `id_empresa` | ID da empresa autorizada, obrigatório |
| `data_inicio`, `data_fim` | Dias inclusivos de criação do lead, `YYYY-MM-DD`; máximo 366 dias |
| `fuso` | `America/Sao_Paulo` (padrão, datas desde 2020) ou `UTC` |
| `limite` | 1 a 100; padrão 50 |
| `antes_de_id` | Cursor devolvido em `proximo_antes_de_id` |

Repita a mesma consulta com `antes_de_id` enquanto `tem_mais=true`. Ordenação por ID decrescente.
Guarde os dados por `(id_empresa, crm_lead_id)`; as páginas não são um snapshot transacional do
período inteiro. Para atualizar o relatório de uma semana, consulte novamente a mesma semana.
O período filtra a criação; status, atendimento e classificação são os valores atuais salvos.
O campo `consultado_em` identifica quando ocorreu a consulta.

Há limite de 60 requisições/minuto por integração, compartilhado entre suas empresas. Respostas:
`400` parâmetros inválidos; `401` token inválido, expirado ou revogado; `403` empresa não autorizada;
`429` limite atingido (aguarde `Retry-After`); `503` falha temporária. O retorno não deve ser armazenado
em cache público. Não envie tokens para o navegador.

## Campos e interpretação

Cada item em `leads` contém identificação, nome, origem e descrição (`UK = Desconhecido`), criação,
empreendimento, status, etapa CRM, chave de pessoa, atribuições e contexto de atendimento.

- `tags` é um array de objetos `{ id, nome, cor, global_tag_id }` com as tags atuais do lead,
  restritas à empresa consultada, ordenadas por ID. Sem tags, retorna `[]`.
  Na Inocoop, “Sem Whatsapp” tem `id=48` e `global_tag_id=11`.
  O ID local muda por empresa; `global_tag_id` pode ser nulo em tags próprias.
  A presença da tag é um registro do Hub, não uma checagem em tempo real do WhatsApp;
  sua ausência não comprova que o telefone possui WhatsApp. Não representa a situação histórica
  da tag na semana de criação do lead.

- `source_type`, `meta_ad_id/name`, `meta_adset_id/name`, `meta_campaign_id/name` e `meta_leadgen_id`
  representam a atribuição principal. Priorizamos uma atribuição com ID de anúncio, depois com
  leadgen_id, depois a mais recente. `atribuicoes` preserva todas as entradas e seus horários.
  Uma nova entrada `site` sem anúncio não esconde o anúncio Meta já registrado.
- `meta_leadgen_ids` reúne os IDs de formulários da pessoa associados ao lead. Para conciliar
  captações, use esses IDs antes de recorrer ao telefone. Múltiplos formulários podem corresponder
  a um único lead CRM; não some o array como se fossem pessoas diferentes.
- `cv_lead_ids` usa os IDs explícitos nas respostas salvas de envios bem-sucedidos ao CV.
  O código de sucesso (`codigo: 200`) nunca é usado como ID. `cv_lead_id` só é preenchido quando há
  um único ID distinto; mais de um ativa `cv_vinculo_ambiguo`. Ausência de log não prova inexistência no CV.
- `lead_conversa_ids` informa vínculos dentro da mesma empresa; `lead_conversa_id` só é preenchido
  para vínculo único. `houve_conversa=true` significa mensagem vinculada ou contador de interações
  positivo; `null` significa evidência insuficiente, não falta comprovada de atendimento.
- `ultima_mensagem_em` e `ultimo_autor` vêm da última mensagem útil vinculada à empresa. `human`
  corresponde a **cliente**; `ai`, à **IA**. Isso não identifica mensagens de um corretor humano.
  Mensagens antigas sem empresa não são usadas para afirmar quem falou por último.
- `temperatura` usa a classificação salva com seu `classificado_em`; se não houver, `quente` só
  quando `lead_quente=true`. `false` não é convertido em frio. Classificações podem estar desatualizadas.
- Visita ou venda não são inferidas de uma conversa. A conciliação com o CV deve usar os IDs
  confirmados e a situação registrada lá.

## Chave de pessoa `phone_v1`

O endpoint não retorna o telefone aberto. A chave é reproduzível no servidor consumidor:

1. Retire caracteres que não sejam dígitos; retire um prefixo internacional `00` se houver.
2. Números com 10 ou 11 dígitos são tratados como brasileiros: acrescente `55`.
3. Aceite de 8 a 15 dígitos, sem zero inicial. Números inválidos resultam em `null`.
4. Calcule SHA-256 dos bytes UTF-8 de `phone:v1:<numero>` e devolva `phone_v1_<hexadecimal minúsculo>`.

Não altere o nono dígito. Telefones com e sem nono dígito podem gerar chaves diferentes. Telefones
compartilhados ou reutilizados também exigem interpretação; a chave identifica o telefone registrado.
A regra independe do token e permanece estável quando ele é substituído. Hash de telefone é dado
pseudonimizado, não garantia de anonimato.

```js
const response = await fetch(`${HUB_URL}/api/integrations/leads?${params}`, {
  headers: { Authorization: `Bearer ${HUB_REPORTING_TOKEN}` },
});
if (!response.ok) throw new Error(`Hub retornou ${response.status}`);
const page = await response.json();
// Persistir page.leads e continuar com page.proximo_antes_de_id quando page.tem_mais.
```
