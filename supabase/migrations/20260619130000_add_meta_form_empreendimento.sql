alter table public.crm_meta_forms
add column if not exists id_empreendimento bigint
references public.empreendimento(id) on delete set null;

create index if not exists idx_crm_meta_forms_empreendimento
on public.crm_meta_forms (id_empreendimento);
