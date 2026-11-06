# Análise de funil da prospecção

Empresas 35 e 36 usam o agregado autenticado `hub_kp_funnel_counts`, aplicado pela migração `prospect_campaign_funnel_counts`. A consulta tradicional continua intacta para as demais empresas.

O denominador é a coorte de leads CRM cadastrados no período, com limites de dia em America/Sao_Paulo. Respostas são comprovadas por `kp_contacts.last_reply_at`; encaminhamentos são comprovados por `kp_handoffs`. Cada contato é contado uma vez, independentemente do número de mensagens. Os indicadores representam a jornada atual da coorte, como no relatório anterior. Um cadastro importado que ainda não virou lead CRM não entra no denominador.

Contatos da campanha são Ativação, inclusive quando o campo legado `lead.ativacao` é nulo. O filtro de empreendimento é preservado. A tela e a imagem do relatório mostram recebidos, interação e enviados à Ana/CRM. Qualificação imobiliária e visitas não são etapas destas campanhas.

O endpoint retorna somente totais. A implementação privilegiada fica no schema privado e valida auth.uid, usuário ativo, perfil de relatório, acesso à empresa, módulo e escopo das duas campanhas. O wrapper público é SECURITY INVOKER; anon não pode executar nenhum dos dois.

Validação: 8 testes SQL em PGlite, 8 testes de funil, TypeScript e build. Consulta real sob o papel authenticated da destinatária confirmou, em 06/11/2026 para 07/10 a 06/11: Prospect 1 = 21 recebidos, 17 respostas, 5 encaminhados; Prospect 2 = 20, 4, 2. Os totais variam com novas entradas. Nenhum relatório foi enviado a grupos durante a validação.

Testes SQL: `node --test docs/prospect-funnel-counts.test.mjs`.
