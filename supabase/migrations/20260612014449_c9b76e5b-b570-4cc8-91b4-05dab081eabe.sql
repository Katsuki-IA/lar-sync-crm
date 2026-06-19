
CREATE OR REPLACE FUNCTION public.crm_seed_default_stages(p_id_empresa bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.crm_stages WHERE id_empresa = p_id_empresa) THEN
    RETURN;
  END IF;
  INSERT INTO public.crm_stages (id_empresa, nome, cor, ordem, ativo) VALUES
    (p_id_empresa, 'Base',                '#94a3b8', 1, true),
    (p_id_empresa, 'Contato feito',       '#3b82f6', 2, true),
    (p_id_empresa, 'Em atendimento',      '#f59e0b', 3, true),
    (p_id_empresa, 'Visita agendada',     '#a855f7', 4, true),
    (p_id_empresa, 'Visita realizada',    '#06b6d4', 5, true),
    (p_id_empresa, 'Atendimento Corretor','#f97316', 6, true),
    (p_id_empresa, 'Perdido',             '#ef4444', 7, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_seed_stages_on_credentials()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.default_crm = 'katsuki' AND NEW.id_empresa IS NOT NULL THEN
    PERFORM public.crm_seed_default_stages(NEW.id_empresa);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_crm_seed_stages_on_credentials ON public.credentials;
CREATE TRIGGER trg_crm_seed_stages_on_credentials
AFTER INSERT OR UPDATE OF default_crm, id_empresa ON public.credentials
FOR EACH ROW EXECUTE FUNCTION public.crm_seed_stages_on_credentials();

-- Backfill para empresas Katsuki existentes sem funil
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT id_empresa FROM public.credentials WHERE default_crm='katsuki' AND id_empresa IS NOT NULL LOOP
    PERFORM public.crm_seed_default_stages(r.id_empresa);
  END LOOP;
END $$;
