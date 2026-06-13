
-- Enums
DO $$ BEGIN
  CREATE TYPE public.crm_task_status AS ENUM ('pendente','em_andamento','concluida','vencida','cancelada');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.crm_task_priority AS ENUM ('baixa','normal','alta');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Table
CREATE TABLE IF NOT EXISTS public.crm_lead_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_empresa bigint NOT NULL,
  lead_id bigint NOT NULL REFERENCES public.lead(id) ON DELETE CASCADE,
  titulo text NOT NULL,
  descricao text,
  prioridade public.crm_task_priority NOT NULL DEFAULT 'normal',
  status public.crm_task_status NOT NULL DEFAULT 'pendente',
  prazo timestamptz NOT NULL,
  assigned_to uuid NOT NULL REFERENCES public.crm_users(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES public.crm_users(id) ON DELETE SET NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS crm_lead_tasks_assigned_idx ON public.crm_lead_tasks(assigned_to, status, prazo);
CREATE INDEX IF NOT EXISTS crm_lead_tasks_lead_idx ON public.crm_lead_tasks(lead_id);
CREATE INDEX IF NOT EXISTS crm_lead_tasks_empresa_idx ON public.crm_lead_tasks(id_empresa);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_lead_tasks TO authenticated;
GRANT ALL ON public.crm_lead_tasks TO service_role;

ALTER TABLE public.crm_lead_tasks ENABLE ROW LEVEL SECURITY;

-- SELECT: same empresa
CREATE POLICY "crm_lead_tasks_select" ON public.crm_lead_tasks
FOR SELECT TO authenticated
USING (
  public.crm_get_my_role() = 'super_admin'
  OR id_empresa = public.crm_get_my_empresa()
);

-- INSERT: must be same empresa; if not manager/super_admin then can only assign to self
CREATE POLICY "crm_lead_tasks_insert" ON public.crm_lead_tasks
FOR INSERT TO authenticated
WITH CHECK (
  id_empresa = public.crm_get_my_empresa()
  AND created_by = public.crm_get_my_id()
  AND (
    public.crm_get_my_role() IN ('super_admin','manager')
    OR assigned_to = public.crm_get_my_id()
  )
);

-- UPDATE: manager/super_admin in empresa, or the assignee, or the creator
CREATE POLICY "crm_lead_tasks_update" ON public.crm_lead_tasks
FOR UPDATE TO authenticated
USING (
  (id_empresa = public.crm_get_my_empresa() AND public.crm_get_my_role() IN ('super_admin','manager'))
  OR assigned_to = public.crm_get_my_id()
  OR created_by = public.crm_get_my_id()
)
WITH CHECK (
  id_empresa = public.crm_get_my_empresa()
);

-- DELETE: manager/super_admin or creator
CREATE POLICY "crm_lead_tasks_delete" ON public.crm_lead_tasks
FOR DELETE TO authenticated
USING (
  (id_empresa = public.crm_get_my_empresa() AND public.crm_get_my_role() IN ('super_admin','manager'))
  OR created_by = public.crm_get_my_id()
);

-- updated_at trigger
DROP TRIGGER IF EXISTS crm_lead_tasks_set_updated_at ON public.crm_lead_tasks;
CREATE TRIGGER crm_lead_tasks_set_updated_at
BEFORE UPDATE ON public.crm_lead_tasks
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
