# Funil da jornada nos relatórios

## Objetivo

Substituir os painéis de Funil de Conversão entre Estágios, Qual canal converte mais e Tempo Médio de Fechamento por um único painel `Funil da jornada` na página de Relatórios.

O painel mostra a jornada dos leads da empresa ativa no período selecionado e usa `Leads recebidos` como base de 100%.

## Escopo visual

- Manter o cabeçalho da página e o filtro de período atuais.
- Remover os três painéis substituídos.
- Manter o painel `Leads por empreendimento` abaixo do novo funil.
- Mostrar cinco linhas, na ordem: Leads recebidos, Engajaram com a IA, Leads quentes, Enviados ao corretor / CRM e Visitas agendadas.
- Cada linha terá nome, quantidade, percentual sobre os leads recebidos e uma barra proporcional. A barra da base terá 100% de largura.

## Coorte e filtros

Todos os números pertencem à empresa ativa e respeitam o período selecionado.

`Leads recebidos` define a coorte: são os registros de `crm_leads` criados entre o início e o fim do período. Para usuários corretores, a coorte continua limitada aos leads atribuídos ao usuário, como já ocorre nos relatórios atuais.

As quatro etapas seguintes são verificadas exclusivamente dentro dessa coorte. Um envio ao CRM ou visita posterior ao final do período ainda conta, desde que o lead tenha sido recebido dentro do período selecionado.

## Critérios das etapas

| Etapa | Fonte e regra |
| --- | --- |
| Leads recebidos | Total da coorte. |
| Engajaram com a IA | Lead da coorte com ao menos uma mensagem `human` em `n8n_chat_conversas`, associada à sessão formada pelo telefone normalizado e `id_empresa`. A primeira mensagem do cliente vinda de anúncio para WhatsApp conta como engajamento. |
| Leads quentes | Lead da coorte marcado como quente/qualificado no CRM. O campo operacional usado será `lead_quente` em `crm_leads`. |
| Enviados ao corretor / CRM | Lead da coorte com atividade de CRM que registre o evento `external_crm_sent` ou a descrição legada de envio bem-sucedido ao CRM. |
| Visitas agendadas | Lead da coorte com ao menos um registro ativo em `agendamento` (`deleted_at` nulo). |

As etapas são indicadores sobre a mesma coorte; não são mutuamente exclusivas. O percentual de cada uma usa sempre `Leads recebidos` como denominador.

## Dados e desempenho

A consulta existente de leads receberá os campos necessários. As mensagens, atividades e agendamentos serão buscados em lotes pelos IDs dos leads ou sessões da coorte, com conjuntos (`Set`) para impedir dupla contagem.

Consultas de dados não usados pelos painéis removidos serão eliminadas. A chave do React Query continuará contendo empresa ativa, usuário e período para evitar mistura de resultados após troca de empresa.

## Erros e estados vazios

Enquanto carrega, a página mantém o esqueleto existente. Sem leads no período, o painel mostra as cinco linhas com zero e percentuais de 0%, sem divisão por zero.

## Verificação

- Testar um período sem leads.
- Testar uma coorte com lead de anúncio que envia a primeira mensagem e, portanto, engaja.
- Testar disparo ativo sem resposta: recebido, mas não engajado.
- Testar envio registrado ao CRM e agendamento ativo em leads da coorte.
- Executar build de produção antes do commit.
