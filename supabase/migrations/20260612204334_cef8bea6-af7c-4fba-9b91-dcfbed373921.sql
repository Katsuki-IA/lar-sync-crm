CREATE TABLE public.crm_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo text NOT NULL,
  mensagem text NOT NULL,
  link text,
  all_empresas boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES public.crm_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.crm_notifications TO authenticated;
GRANT ALL ON public.crm_notifications TO service_role;
ALTER TABLE public.crm_notifications ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.crm_notification_targets (
  notification_id uuid NOT NULL REFERENCES public.crm_notifications(id) ON DELETE CASCADE,
  id_empresa bigint NOT NULL,
  PRIMARY KEY (notification_id, id_empresa)
);
CREATE INDEX idx_crm_notif_targets_empresa ON public.crm_notification_targets(id_empresa);
GRANT SELECT ON public.crm_notification_targets TO authenticated;
GRANT ALL ON public.crm_notification_targets TO service_role;
ALTER TABLE public.crm_notification_targets ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.crm_notification_reads (
  notification_id uuid NOT NULL REFERENCES public.crm_notifications(id) ON DELETE CASCADE,
  crm_user_id uuid NOT NULL REFERENCES public.crm_users(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, crm_user_id)
);
CREATE INDEX idx_crm_notif_reads_user ON public.crm_notification_reads(crm_user_id);
GRANT SELECT, INSERT ON public.crm_notification_reads TO authenticated;
GRANT ALL ON public.crm_notification_reads TO service_role;
ALTER TABLE public.crm_notification_reads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notif_select_by_empresa" ON public.crm_notifications
  FOR SELECT TO authenticated
  USING (
    all_empresas = true
    OR EXISTS (
      SELECT 1 FROM public.crm_notification_targets t
      JOIN public.crm_users u ON u.id_empresa = t.id_empresa
      WHERE t.notification_id = crm_notifications.id
        AND u.auth_user_id = auth.uid()
    )
  );

CREATE POLICY "notif_targets_select" ON public.crm_notification_targets
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.crm_users u
      WHERE u.auth_user_id = auth.uid()
        AND (u.id_empresa = crm_notification_targets.id_empresa OR u.role = 'super_admin')
    )
  );

CREATE POLICY "notif_reads_select_own" ON public.crm_notification_reads
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.crm_users u WHERE u.id = crm_notification_reads.crm_user_id AND u.auth_user_id = auth.uid())
  );

CREATE POLICY "notif_reads_insert_own" ON public.crm_notification_reads
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.crm_users u WHERE u.id = crm_notification_reads.crm_user_id AND u.auth_user_id = auth.uid())
  );