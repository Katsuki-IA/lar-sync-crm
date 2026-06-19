
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_lead_tags TO authenticated;
GRANT ALL ON public.crm_lead_tags TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_lead_activities TO authenticated;
GRANT ALL ON public.crm_lead_activities TO service_role;

DROP POLICY IF EXISTS crm_lead_tags_all ON public.crm_lead_tags;
CREATE POLICY crm_lead_tags_all ON public.crm_lead_tags
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.lead l WHERE l.id = crm_lead_tags.lead_id AND l.id_empresa = crm_get_my_empresa()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.lead l WHERE l.id = crm_lead_tags.lead_id AND l.id_empresa = crm_get_my_empresa()));

DROP POLICY IF EXISTS crm_lead_activities_all ON public.crm_lead_activities;
CREATE POLICY crm_lead_activities_all ON public.crm_lead_activities
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.lead l WHERE l.id = crm_lead_activities.lead_id AND l.id_empresa = crm_get_my_empresa()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.lead l WHERE l.id = crm_lead_activities.lead_id AND l.id_empresa = crm_get_my_empresa()));
