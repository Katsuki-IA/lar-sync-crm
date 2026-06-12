
-- Funis: cada empresa pode ter múltiplos funis, com seus próprios estágios
CREATE TABLE public.crm_funnels (
  id BIGSERIAL PRIMARY KEY,
  id_empresa BIGINT NOT NULL,
  nome TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  ativo BOOLEAN NOT NULL DEFAULT true,
  ordem INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX crm_funnels_one_default_per_empresa
  ON public.crm_funnels (id_empresa) WHERE is_default = true;
CREATE INDEX crm_funnels_empresa_idx ON public.crm_funnels(id_empresa);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_funnels TO authenticated;
GRANT ALL ON public.crm_funnels TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.crm_funnels_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.crm_funnels_id_seq TO service_role;

ALTER TABLE public.crm_funnels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "crm_funnels_select" ON public.crm_funnels FOR SELECT TO authenticated
  USING (id_empresa = public.crm_get_my_empresa() OR public.crm_get_my_role() = 'super_admin');
CREATE POLICY "crm_funnels_modify" ON public.crm_funnels FOR ALL TO authenticated
  USING (
    (id_empresa = public.crm_get_my_empresa() AND public.crm_get_my_role() IN ('manager','super_admin'))
    OR public.crm_get_my_role() = 'super_admin'
  )
  WITH CHECK (
    (id_empresa = public.crm_get_my_empresa() AND public.crm_get_my_role() IN ('manager','super_admin'))
    OR public.crm_get_my_role() = 'super_admin'
  );

CREATE TRIGGER crm_funnels_set_updated_at BEFORE UPDATE ON public.crm_funnels
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Adiciona id_funnel em crm_stages
ALTER TABLE public.crm_stages ADD COLUMN id_funnel BIGINT REFERENCES public.crm_funnels(id) ON DELETE CASCADE;
CREATE INDEX crm_stages_funnel_idx ON public.crm_stages(id_funnel);

-- Backfill: cria funil padrão para cada empresa que já tem estágios e vincula
DO $$
DECLARE
  emp RECORD;
  new_funnel_id BIGINT;
BEGIN
  FOR emp IN SELECT DISTINCT id_empresa FROM public.crm_stages WHERE id_empresa IS NOT NULL LOOP
    INSERT INTO public.crm_funnels (id_empresa, nome, is_default, ordem)
    VALUES (emp.id_empresa, 'Funil padrão', true, 1)
    RETURNING id INTO new_funnel_id;
    UPDATE public.crm_stages SET id_funnel = new_funnel_id
      WHERE id_empresa = emp.id_empresa AND id_funnel IS NULL;
  END LOOP;
END $$;

-- Atualiza função de seed para também criar o funil padrão
CREATE OR REPLACE FUNCTION public.crm_seed_default_stages(p_id_empresa bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_funnel_id BIGINT;
BEGIN
  IF EXISTS (SELECT 1 FROM public.crm_stages WHERE id_empresa = p_id_empresa) THEN
    RETURN;
  END IF;

  SELECT id INTO v_funnel_id FROM public.crm_funnels
    WHERE id_empresa = p_id_empresa AND is_default = true LIMIT 1;
  IF v_funnel_id IS NULL THEN
    INSERT INTO public.crm_funnels (id_empresa, nome, is_default, ordem)
    VALUES (p_id_empresa, 'Funil padrão', true, 1)
    RETURNING id INTO v_funnel_id;
  END IF;

  INSERT INTO public.crm_stages (id_empresa, id_funnel, nome, cor, ordem, ativo) VALUES
    (p_id_empresa, v_funnel_id, 'Base',                '#94a3b8', 1, true),
    (p_id_empresa, v_funnel_id, 'Contato feito',       '#3b82f6', 2, true),
    (p_id_empresa, v_funnel_id, 'Em atendimento',      '#f59e0b', 3, true),
    (p_id_empresa, v_funnel_id, 'Visita agendada',     '#a855f7', 4, true),
    (p_id_empresa, v_funnel_id, 'Visita realizada',    '#06b6d4', 5, true),
    (p_id_empresa, v_funnel_id, 'Atendimento Corretor','#f97316', 6, true),
    (p_id_empresa, v_funnel_id, 'Perdido',             '#ef4444', 7, true);
END;
$function$;
