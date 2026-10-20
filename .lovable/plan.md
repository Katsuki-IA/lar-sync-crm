Consulta só de leitura (SELECT) no banco do Hub. Nenhuma alteração de código, dados, memória ou roadmap. Sem dados pessoais.

1. Mapear etapas
- Listar crm_stages (por empresa) e valores de lead.status/agendamento ligados a visita agendada, visita realizada e venda/ganho. Dizer qual etapa/campo foi usado para cada uma.

2. Funil por empresa e total (do primeiro ao último lead)
- Nome da empresa (empresa_dados), primeira e última data de lead (America/Sao_Paulo).
- Leads criados (lead e crm_leads, dizendo qual fonte é usada).
- Visita agendada (estágio "Visita Agendada", status 'Visita Agendada'/'agendando'/'Pos-Agendamento', ou registro em agendamento), visita realizada e venda/ganho, se existirem.
- Taxas: agendada/leads, realizada/leads, venda/realizada, venda/leads.

3. Recortes
- Por origem (crm_leads.origem e crm_lead_attribution.source_type: Meta, Google, site etc.).
- Faixa de renda / Minha Casa Minha Vida, se houver coluna ou campo personalizado (crm_lead_custom_values, empreendimento).
- Indicar claramente quando um dado não existe no banco.

Entrega: tabelas curtas com os resultados e as etapas usadas.
