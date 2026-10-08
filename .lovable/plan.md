Consulta somente leitura (SELECT) — empresa 19 (Andrade Ribeiro), tabela public.lead. Nenhuma alteração de código ou dados.

1. Mapear sinais de "pediu corretor / foi para corretor"
- Listar colunas de public.lead (e crm_leads) com nome contendo corretor, humano, handoff, transfer (information_schema.columns).
- Valores distintos de lead.status na empresa 19 com contagem e menor created_at.
- Estágios de crm_stages da empresa 19 ligados a corretor/CRM/visita e quantos crm_leads em cada.
- Tipos de evento em crm_lead_activities (e tabelas de log relevantes) que indiquem transferência, com contagem e menor data.
- Para cada sinal: quantos leads marca e desde quando é preenchido.

2. Funil por período e empreendimento
- Períodos: 21/09–07/10/2026 e 28/09–04/10/2026, created_at em America/Sao_Paulo.
- Por empreendimento (id_empreendimento → empreendimento.nome, incluindo nulos): entraram; atendimento_humano = true; status 'Enviado CRM'/'Enviado  CRM'; status 'aguardando_corretor'/'Atendimento Humano'; qualquer sinal (sem duplicar); percentuais sobre os que entraram.

3. Leads sem id_empreendimento no período
- Contagem e lista (sem nome/telefone): origem/fonte, campanha/formulário/utm (crm_lead_attribution quando houver), empreendimento_em_foco_id/nome, primeira mensagem (até 60 caracteres, de n8n_chat_conversas/wa_messages), status.
- Explicar no código (edge functions, funções SQL de ingestão como crm_ingest_meta_lead, n8n-wa-message-upsert) onde id_empreendimento é gravado e por que fica nulo.

Entrega: tabelas com os resultados, o SQL executado e os nomes exatos de tabelas/colunas.
