-- Indice de cobertura da FK usado ao remover/desativar usuarios do painel.
create index if not exists lead_wa_conversation_assigned_to_idx
  on public.lead (wa_conversation_assigned_to)
  where wa_conversation_assigned_to is not null;
