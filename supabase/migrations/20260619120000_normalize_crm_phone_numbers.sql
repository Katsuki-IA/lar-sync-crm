-- Phone numbers are stored as DDI + national number, using digits only.
update public.crm_leads
set telefone = regexp_replace(telefone, '[^0-9]', '', 'g')
where telefone is not null
  and telefone <> regexp_replace(telefone, '[^0-9]', '', 'g');

update public.crm_meta_leads
set telefone = regexp_replace(telefone, '[^0-9]', '', 'g')
where telefone is not null
  and telefone <> regexp_replace(telefone, '[^0-9]', '', 'g');
