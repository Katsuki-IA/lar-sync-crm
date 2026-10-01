-- Availability configuration only; this is not the customer's intent.
alter table public.empresa_dados add column if not exists modalidade_negociacao text not null default 'venda'
  check (modalidade_negociacao in ('venda','locacao','ambos'));
alter table public.empreendimento add column if not exists modalidade_negociacao text not null default 'venda'
  check (modalidade_negociacao in ('venda','locacao','ambos'));
alter table public.crm_meta_forms add column if not exists modalidade_negociacao text not null default 'venda'
  check (modalidade_negociacao in ('venda','locacao','ambos'));

comment on column public.empresa_dados.modalidade_negociacao is 'Operações atendidas pela empresa: venda, locacao ou ambos.';
comment on column public.empreendimento.modalidade_negociacao is 'Operações disponíveis neste empreendimento; não representa a intenção do lead.';
comment on column public.crm_meta_forms.modalidade_negociacao is 'Finalidade configurada do formulário Meta: venda, locacao ou ambos. Ambos exige identificar a intenção do lead.';
